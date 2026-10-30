// 【実PG17用の模型】使い捨てDB（tests/pg/db_setup.js）の上で、サーバー側のハンドラーが使う PostgREST の呼び出しだけを再現する最小の fetchImpl。
//   対応：GET /rest/v1/<table>?select=…&col=eq|neq|in|is.…&order=…&limit=…（埋め込みは diagnosis_answers／diagnosis_results）、
//         POST /rest/v1/rpc/<fn>（名前付き引数）、GET /auth/v1/user（users: トークン→利用者ID の表）。
//   未対応の呼び出しは例外にする（黙って通さない）。既存のDB依存試験（COMPLETE_DB_BACKEND）を動かすには、PATCH・POST（挿入／upsert）・Prefer ヘッダー・
//   範囲指定などの追加が要る（docs/TESTING_PG.md の計画を参照）。
const pg = require('./pg_env');
const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
const ident = (s) => { if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error('bad ident ' + s); return `"${s}"`; };
function splitTop(s) { const out = []; let d = 0, cur = ''; for (const ch of s) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && d === 0) { out.push(cur); cur = ''; } else cur += ch; } if (cur) out.push(cur); return out; }
const EMBED_FK = { diagnosis_answers: 'session_id', diagnosis_results: 'session_id' };
function cond(col, spec) {
  const c = `t.${ident(col)}::text`;
  const [op, ...rest] = spec.split('.'); const val = rest.join('.');
  if (op === 'eq') return `${c} = ${lit(val)}`;
  if (op === 'neq') return `${c} is distinct from ${lit(val)}`;
  if (op === 'is') return `t.${ident(col)} is ${val === 'null' ? 'null' : 'not null'}`;
  if (op === 'in') return `${c} in (${val.replace(/^\(|\)$/g, '').split(',').map(lit).join(',')})`;
  if (op === 'gt' || op === 'gte' || op === 'lt' || op === 'lte') return `t.${ident(col)} ${ { gt: '>', gte: '>=', lt: '<', lte: '<=' }[op] } ${lit(val)}`;
  throw new Error('unsupported filter ' + op);
}
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
const log = [];
// 関数の戻りの形（集合を返すか）を調べて覚える（PostgREST と同じ形で返すため：表を返す関数は配列、スカラーはそのまま）
const fnShape = new Map();
async function shapeOf(sql, fn) {
  if (!fnShape.has(fn)) fnShape.set(fn, await sql(`select proretset::text from pg_proc where pronamespace='public'::regnamespace and proname=${lit(fn)} limit 1`) === 'true');
  return fnShape.get(fn);
}
function makeFetch(db, { users = {}, auth = null, failOn = null, failures = null } = {}) {
  // 画面の裏のサーバーは service_role（サービスキー）として DB を使う。権限の無い操作は、本番と同じように失敗する
  const raw = (q) => pg.sql(db, q);
  const sql = (q) => pg.sqlAsync(db, `set role service_role; ${q}`);
  const bodyHas = (opts) => (opts.body ? JSON.parse(opts.body) : null);
  const f = async (url, opts = {}) => {
    const u = new URL(url);
    const method = opts.method || 'GET';
    log.push(`${method} ${u.pathname.replace('/rest/v1/', '')}`);
    if (failOn && failOn(u, opts)) throw new TypeError('fetch failed (injected network failure)');
    if (u.pathname === '/auth/v1/user') {
      if (failures && failures('auth')) return json(503, {});
      const t = String((opts.headers && opts.headers.Authorization) || '').replace(/^Bearer /, '');
      const user = auth ? auth(t) : (users[t] ? { id: users[t] } : null);
      return user ? json(200, user) : json(401, { msg: 'invalid' });
    }
    const rpc = u.pathname.match(/^\/rest\/v1\/rpc\/([a-z_0-9]+)$/);
    if (rpc) {
      if (failures && failures(`rpc:${rpc[1]}`)) throw new TypeError('fetch failed');
      const args = bodyHas(opts) || {};
      const argList = Object.entries(args).map(([k, v]) => `${ident(k)} => ${v === null ? 'null' : (typeof v === 'object' ? `${lit(JSON.stringify(v))}::jsonb` : lit(v))}`).join(', ');
      const call = `public.${ident(rpc[1])}(${argList})`;
      const q = (await shapeOf(sql, rpc[1])) ? `select coalesce(json_agg(r), '[]'::json) from ${call} r` : `select to_json(${call})`;
      try { return json(200, JSON.parse(await sql(q))); } catch (e) {
        const m = /ERROR:\s+(?:[0-9A-Z]{5}:\s+)?([^\n]*)/.exec(String(e.stderr || e.message)) || [];
        return { ok: false, status: 400, json: async () => ({ code: 'P0001', message: (m[1] || '').trim() }), text: async () => (m[1] || '') };
      }
    }
    const m = u.pathname.match(/^\/rest\/v1\/([a-z_0-9]+)$/);
    if (!m) throw new Error('unsupported ' + url);
    const table = m[1];
    const where = []; let order = '', limit = '', select = '*', onConflict = null;
    for (const [k, v] of u.searchParams) {
      if (k === 'select') select = v; else if (k === 'order') order = ' order by ' + v.split(',').map((o) => { const [c, d] = o.split('.'); return `t.${ident(c)} ${d === 'desc' ? 'desc' : 'asc'}`; }).join(', ');
      else if (k === 'limit') limit = ` limit ${parseInt(v, 10)}`; else if (k === 'on_conflict') onConflict = v; else where.push(cond(k, v));
    }
    const prefer = String((opts.headers && opts.headers.Prefer) || '');
    const wantRows = /return=representation/.test(prefer);
    if (method === 'POST') {
      if (failures && failures(`insert:${table}`)) return json(500, { message: 'boom' });
      const rows = JSON.parse(opts.body || '[]'); const arr = Array.isArray(rows) ? rows : [rows];
      const cols = [...new Set(arr.flatMap((r) => Object.keys(r)))];
      const cl = cols.map(ident).join(', ');
      let conflict = '';
      if (onConflict) {
        const keys = onConflict.split(',').map((x) => ident(x.trim()));
        if (/resolution=ignore-duplicates/.test(prefer)) conflict = ` on conflict (${keys.join(', ')}) do nothing`;
        else if (/resolution=merge-duplicates/.test(prefer)) conflict = ` on conflict (${keys.join(', ')}) do update set ${cols.map(ident).filter((c) => !keys.includes(c)).map((c) => `${c} = excluded.${c}`).join(', ')}`;
        else throw new Error('unsupported on_conflict without resolution');
      }
      try {
        const q = `with ins as (insert into public.${ident(table)} (${cl}) select ${cl} from json_populate_recordset(null::public.${ident(table)}, ${lit(JSON.stringify(arr))}::json)${conflict} returning *) select coalesce(json_agg(ins), '[]'::json) from ins`;
        const out = JSON.parse(await sql(q));
        return json(201, wantRows ? out : []);
      } catch (e) { return { ok: false, status: 409, json: async () => ({ message: String(e.stderr || e.message).slice(0, 200) }), text: async () => String(e.stderr || e.message) }; }
    }
    if (method === 'PATCH') {
      const vals = JSON.parse(opts.body || '{}');
      const sets = Object.entries(vals).map(([k, v]) => `${ident(k)} = ${v === null ? 'null' : lit(typeof v === 'object' ? JSON.stringify(v) : v)}`).join(', ');
      try {
        const out = JSON.parse(await sql(`with up as (update public.${ident(table)} t set ${sets}${where.length ? ' where ' + where.join(' and ') : ''} returning t.*) select coalesce(json_agg(up), '[]'::json) from up`));
        return json(200, wantRows ? out : []);
      } catch (e) { return { ok: false, status: 400, json: async () => ({ message: String(e.stderr || e.message).slice(0, 200) }), text: async () => String(e.stderr || e.message) }; }
    }
    if (method === 'DELETE') {
      if (failures && failures(`delete:${table}`)) return json(500, { message: 'boom' });
      await sql(`delete from public.${ident(table)} t${where.length ? ' where ' + where.join(' and ') : ''}`);
      return json(204, []);
    }
    if (method !== 'GET' && method !== 'HEAD') throw new Error('unsupported method ' + method);
    if (failures && failures(`select:${table}`)) return json(500, { message: 'boom' });
    const cols = splitTop(select).map((it) => {
      const em = it.match(/^([a-z_]+)\((.*)\)$/);
      if (!em) return it === '*' ? 't.*' : `t.${ident(it)}`;
      const fk = EMBED_FK[em[1]]; if (!fk) throw new Error('unsupported embed ' + em[1]);
      return `(select coalesce(json_agg(x), '[]'::json) from (select ${em[2].split(',').map((c) => 'r.' + ident(c.trim())).join(', ')} from public.${ident(em[1])} r where r.${ident(fk)} = t.id) x) as ${ident(em[1])}`;
    });
    const q = `select coalesce(json_agg(z), '[]'::json) from (select ${cols.join(', ')} from public.${ident(table)} t${where.length ? ' where ' + where.join(' and ') : ''}${order}${limit}) z`;
    return json(200, JSON.parse(await sql(q)));
  };
  return f;
}
module.exports = { makeFetch, log, lit, ident };
