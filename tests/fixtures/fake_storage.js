// テスト用の偽の Supabase Storage（REST の形だけを解釈する。外部へは接続しない）。
//   wrap(fetchImpl) で /storage/v1/ の要求だけをここで処理し、それ以外は元の fetchImpl へ渡す。
//   failNext('upload' | 'list' | 'remove' | 'download') で次の1回を失敗させる（503）。
'use strict';
const res = (status, body, raw) => ({
  ok: status >= 200 && status < 300, status,
  json: async () => JSON.parse(JSON.stringify(body)),
  arrayBuffer: async () => { const b = raw || Buffer.from(JSON.stringify(body || {})); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); },
});

function createFakeStorage({ bucket = 'complete-reports' } = {}) {
  const objects = new Map();
  const failures = [];
  const calls = [];
  const take = (k) => { const i = failures.indexOf(k); if (i < 0) return false; failures.splice(i, 1); return true; };
  const keyOf = (path, prefix) => decodeURIComponent(path.slice(prefix.length)).split('/').map(decodeURIComponent).join('/');
  function wrap(fetchImpl) {
    return async (url, opts = {}) => {
      const u = new URL(url);
      if (!u.pathname.startsWith('/storage/v1/')) return fetchImpl(url, opts);
      const method = opts.method || 'GET';
      calls.push({ method, path: u.pathname });
      const auth = opts.headers && (opts.headers.apikey || opts.headers.Authorization);
      if (!auth) return res(401, { message: 'unauthorized' });
      const objPrefix = `/storage/v1/object/${bucket}/`;
      if (method === 'POST' && u.pathname === `/storage/v1/object/list/${bucket}`) {
        if (take('list')) return res(503, {});
        const { prefix } = JSON.parse(opts.body);
        const names = [...objects.keys()].filter((k) => k.startsWith(`${prefix}/`)).map((k) => k.slice(prefix.length + 1)).filter((n) => !n.includes('/'));
        return res(200, names.map((name) => ({ name })));
      }
      if (method === 'POST' && u.pathname.startsWith(objPrefix)) {
        if (take('upload')) return res(503, {});
        const key = keyOf(u.pathname, objPrefix);
        if (objects.has(key) && opts.headers['x-upsert'] !== 'true') return res(409, { message: 'exists' });
        objects.set(key, { body: Buffer.from(opts.body), contentType: opts.headers['Content-Type'] });
        return res(200, { Key: `${bucket}/${key}` });
      }
      if (method === 'DELETE' && u.pathname === `/storage/v1/object/${bucket}`) {
        if (take('remove')) return res(503, {});
        const { prefixes } = JSON.parse(opts.body);
        prefixes.forEach((k) => objects.delete(k));
        return res(200, prefixes.map((name) => ({ name })));
      }
      const dl = `/storage/v1/object/authenticated/${bucket}/`;
      if (method === 'GET' && u.pathname.startsWith(dl)) {
        if (take('download')) return res(503, {});
        const o = objects.get(keyOf(u.pathname, dl));
        return o ? res(200, null, o.body) : res(400, { message: 'not found' });
      }
      return res(404, { message: 'unknown storage route' });
    };
  }
  return { objects, calls, wrap, failNext: (k) => failures.push(k) };
}

module.exports = { createFakeStorage };
