// 既存のタイプ解説35ページ（type/<code>.html）から、本文と SEO の head をそのまま取り出して
// scripts/type-pages-data.json に保存する（一度だけ実行。以後は JSON を唯一の元データにする）。
//   ・title・description・canonical・OGP・JSON-LD は head の該当行を文字どおり保存する（SEO Phase 2 の内容を変えない）
//   ・本文（導入・元素・武器種・組み合わせ・タグ・軸）も文字どおり保存する（文言は書き換えない）
//   実行: node scripts/extract-type-pages-data.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const one = (re, s, label, code) => { const m = re.exec(s); if (!m) throw new Error(`${code}: ${label} が見つかりません`); return m[1]; };
const out = {};
for (const f of fs.readdirSync(path.join(ROOT, 'type')).filter((x) => /^[a-z]{4}\.html$/.test(x)).sort()) {
  const code = f.slice(0, 4).toUpperCase();
  const h = fs.readFileSync(path.join(ROOT, 'type', f), 'utf8');
  if (h.includes('data-template="type-v2"')) throw new Error(`${code}: すでに新しいテンプレートです（元データは JSON から取る）`);
  const head = one(/(<title>[\s\S]*?<\/script>)\n<style>/, h, 'head', code);
  const desc = one(/<div class="desc">([\s\S]*?)<\/div>/, h, 'desc', code).split('<br><br>');
  if (desc.length !== 3) throw new Error(`${code}: 本文の段落が3つではありません`);
  out[code] = {
    head,
    h1: one(/<h1>([^<]+)<\/h1>/, h, 'h1', code),
    lead: (/<p class="lead">([\s\S]*?)<\/p>/.exec(h) || [null, null])[1], // 導入文は一部のタイプだけ
    elementText: desc[0], weaponText: desc[1], combineText: desc[2],
    tags: [...h.matchAll(/<span class="tag">([^<]+)<\/span>/g)].map((m) => m[1]),
    axis: one(/<div class="axis">([^<]+)<\/div>/, h, 'axis', code),
  };
}
fs.writeFileSync(path.join(ROOT, 'scripts/type-pages-data.json'), JSON.stringify(out, null, 1) + '\n');
console.log('types', Object.keys(out).length);
