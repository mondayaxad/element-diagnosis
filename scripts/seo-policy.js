// 検索エンジン向けのインデックス方針（一か所で管理する一覧）。
//   ・公開する HTML（scripts/build-public.js が dist に出すもの）と、rewrite・API が返す HTML の全ルートについて、
//     「index（検索に出す）」「allow（出してもよい・sitemap には載せない）」「noindex（出さない）」を決める。
//   ・tests/seo_indexing.test.js がこの一覧と dist・vercel.json・sitemap.xml を突き合わせる。
//     一覧に無い HTML や rewrite が増えると失敗する（新しいページを足した時に、方針を決め忘れないため）。
//   ・新しいページを足す時は：①build-public.js の公開リスト ②ここに方針 ③index なら canonical・title・description・sitemap、
//     noindex なら vercel.json の X-Robots-Tag（source は末尾スラッシュも含む「/path{/}?」）とページ内の meta robots。
'use strict';

const ORIGIN = 'https://element-diagnosis-five.vercel.app';

// 公開 HTML（dist のファイル → 正規の URL パスと方針）
const PAGES = {
  'index.html':                 { path: '/',                       policy: 'index' },
  'jagan/index.html':           { path: '/jagan/',                 policy: 'index' },
  'jagan/about.html':           { path: '/jagan/about',            policy: 'index' },
  // type/*.html（35件）は下の TYPE_CODES から作る（index）
  'privacy.html':               { path: '/privacy',                policy: 'allow' },
  'terms.html':                 { path: '/terms',                  policy: 'allow' },
  'tokushoho.html':             { path: '/tokushoho',              policy: 'allow' },
  'google4a667902d1176c3c.html':{ path: '/google4a667902d1176c3c', policy: 'allow', plain: true }, // Search Console の所有権確認（HTML ではない1行）
  'mypage.html':                { path: '/mypage',                 policy: 'noindex' },
  'report.html':                { path: '/report',                 policy: 'noindex' },
  'report-link.html':           { path: '/report-link',            policy: 'noindex' },
  'purchase-complete.html':     { path: '/purchase-complete',      policy: 'noindex' },
  'complete-sample.html':       { path: '/complete-sample',        policy: 'noindex' },
  'report_sample.html':         { path: '/report_sample',          policy: 'noindex' },
  'jagan/sample.html':          { path: '/jagan/sample',           policy: 'noindex' },
  'jagan/complete-sample.html': { path: '/jagan/complete-sample',  policy: 'noindex' },
  'jagan/dipper.html':          { path: '/jagan/dipper',           policy: 'noindex' },
  'jagan/report.html':          { path: '/jagan/report',           policy: 'noindex' },
};
const ELEMENTS = ['py', 'hy', 'cr', 'el', 'an', 'ge', 'de'];
const WEAPONS = ['sw', 'cm', 'pl', 'ct', 'bw'];
const TYPE_CODES = ELEMENTS.flatMap((e) => WEAPONS.map((w) => e + w));
for (const c of TYPE_CODES) PAGES[`type/${c}.html`] = { path: `/type/${c}`, policy: 'index' };

// rewrite・API が返す HTML（ルートのパターン → 方針と、テストで使う具体例）
const DYNAMIC = [
  { pattern: '/result',            policy: 'noindex', samples: ['/result'] },                         // index.html への rewrite（結果画面）
  { pattern: '/jagan/s/:id',       policy: 'noindex', samples: ['/jagan/s/AUDIT0000'] },              // 邪眼の共有ページ（rewrite → /api/jagan-share-page）
  { pattern: '/jagan/share',       policy: 'noindex', samples: ['/jagan/share'] },
  { pattern: '/j/:k',              policy: 'noindex', samples: ['/j/AUDIT000'] },
  { pattern: '/api/share',         policy: 'noindex', samples: ['/api/share'], header: 'function' },  // 元素診断の共有ページ（api/share.js が X-Robots-Tag を返す）
  { pattern: '/api/jagan-share-page', policy: 'noindex', samples: ['/api/jagan-share-page'], header: 'function' }, // lib/jagan-api.mjs が返す
];

const indexUrls = () => Object.values(PAGES).filter((p) => p.policy === 'index').map((p) => ORIGIN + p.path);

module.exports = { ORIGIN, PAGES, DYNAMIC, TYPE_CODES, indexUrls };
