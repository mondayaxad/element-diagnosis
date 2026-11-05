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
  throw new Error('unsupported filter ' + op);
}
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
const log = [];
function makeFetch(db, { users = {}, failOn = null } = {}) {
  const sql = (q) => pg.sql(db, q);
  const f = async (url, opts = {}) => {
    const u = new URL(url);
    log.push(`${opts.method || 'GET'} ${u.pathname.replace('/rest/v1/', '')}`);
    if (failOn && failOn(u, opts)) throw new TypeError('fetch failed (injected network failure)');
    if (u.pathname === '/auth/v1/user') {
      const t = (opts.headers.Authorization || '').replace('Bearer ', '');
      return users[t] ? json(200, { id: users[t] }) : json(401, {});
    }
    const rpc = u.pathname.match(/^\/rest\/v1\/rpc\/([a-z_0-9]+)$/);
    if (rpc) {
      const args = JSON.parse(opts.body || '{}');
      const q = `select to_json(public.${ident(rpc[1])}(${Object.entries(args).map(([k, v]) => `${ident(k)} => ${v === null ? 'null' : lit(v)}`).join(', ')}))`;
      try { return json(200, JSON.parse(sql(q))); } catch (e) { return { ok: false, status: 400, json: async () => ({}), text: async () => String(e.stderr || e.message) }; }
    }
    const m = u.pathname.match(/^\/rest\/v1\/([a-z_0-9]+)$/);
    if (!m) throw new Error('unsupported ' + url);
    if ((opts.method || 'GET') === 'POST') {
      // 挿入（?on_conflict=<列>＋Prefer: resolution=ignore-duplicates のときは重複を無視）。応答は return=minimal 相当（本文なし）
      const rows = JSON.parse(opts.body || '[]');
      const oc = u.searchParams.get('on_conflict');
      const ignore = /resolution=ignore-duplicates/.test((opts.headers && opts.headers.Prefer) || '');
      if (oc && !ignore) throw new Error('unsupported upsert (merge-duplicates)');
      if (oc && !/^[a-z_0-9]+$/.test(oc)) throw new Error('bad on_conflict');
      try {
        const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))].map(ident).join(', '); // 指定された列だけ（残りは列の既定値）
        sql(`insert into public.${ident(m[1])} (${cols}) select ${cols} from json_populate_recordset(null::public.${ident(m[1])}, ${lit(JSON.stringify(rows))}::json)${oc ? ` on conflict (${ident(oc)}) do nothing` : ''}`);
        return json(201, []);
      } catch (e) { return { ok: false, status: 409, json: async () => ({}), text: async () => String(e.stderr || e.message) }; }
    }
    if ((opts.method || 'GET') !== 'GET') throw new Error('unsupported method ' + opts.method);
    const table = m[1]; const where = []; let order = '', limit = '', select = '*';
    for (const [k, v] of u.searchParams) {
      if (k === 'select') select = v; else if (k === 'order') order = ' order by ' + v.split(',').map((o) => { const [c, d] = o.split('.'); return `t.${ident(c)} ${d === 'desc' ? 'desc' : 'asc'}`; }).join(', ');
      else if (k === 'limit') limit = ` limit ${parseInt(v, 10)}`; else where.push(cond(k, v));
    }
    const cols = splitTop(select).map((it) => {
      const em = it.match(/^([a-z_]+)\((.*)\)$/);
      if (!em) return it === '*' ? 't.*' : `t.${ident(it)}`;
      const fk = EMBED_FK[em[1]]; if (!fk) throw new Error('unsupported embed ' + em[1]);
      return `(select coalesce(json_agg(x), '[]'::json) from (select ${em[2].split(',').map((c) => 'r.' + ident(c.trim())).join(', ')} from public.${ident(em[1])} r where r.${ident(fk)} = t.id) x) as ${ident(em[1])}`;
    });
    const q = `select coalesce(json_agg(z), '[]'::json) from (select ${cols.join(', ')} from public.${ident(table)} t${where.length ? ' where ' + where.join(' and ') : ''}${order}${limit}) z`;
    return json(200, JSON.parse(sql(q)));
  };
  return f;
}
module.exports = { makeFetch, log, lit };
