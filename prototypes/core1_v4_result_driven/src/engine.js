// engine.js — 正本 ETI v2 エンジン一式を「読み込み専用」で評価して返す。
// 式を写し直さない：js/ 配下の6ファイルをそのまま評価し、関数とデータを受け取るだけ。
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const VENDOR_ROOT = path.join(PROJECT_ROOT, 'vendor', 'eti-js');
// 正本エンジンの場所：環境変数 ETI_ENGINE_ROOT → リポジトリの js/（リポジトリ内で実行した時）→ 同梱の vendor/eti-js（ZIP単体で実行した時）
const REPO_CANDIDATE = path.resolve(PROJECT_ROOT, '..', '..');
const REPO_ROOT = process.env.ETI_ENGINE_ROOT ? path.resolve(process.env.ETI_ENGINE_ROOT)
  : fs.existsSync(path.join(REPO_CANDIDATE, 'js', 'eti_v2_engine.js')) ? REPO_CANDIDATE : VENDOR_ROOT;
const ENGINE_FILES = [
  'js/ETI_v2_QUESTIONS_100.js',
  'js/eti_v2_prototypes.js',
  'js/eti_v2_engine.js',
  'js/characters118_v2_1.js',
  'js/eti_mirror_selection_v21.js',
  'js/eti_v2_mirror_resolver.js',
];
const EXPECTED_VERSIONS = {
  diagnosis: 'ETI-2.0',
  items: 'ETI-ITEM-2.0.0',
  scoring: 'ETI-SCORE-2.0.0',
  translation: 'ETI-TRANS-2.0.0',
  characters: 'ETI-CHAR-2.1.0',
  mirror: 'ETI-MIRROR-2.1.0',
};
// 計算内部の正本キー → 表示名（境界でだけ変換する。内部キーは変えない）
const DISPLAY_NAME = { 'ナドクライ': 'ナド・クライ' };
const displayName = (k) => DISPLAY_NAME[k] || k;

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

let cached = null;
function loadEngine(repoRoot = REPO_ROOT) {
  if (cached && cached.repoRoot === repoRoot) return cached;
  const read = (f) => fs.readFileSync(path.join(repoRoot, f), 'utf8');
  const ctx = new Function(ENGINE_FILES.slice(0, 5).map(read).join('\n') +
    ';return { Q: ETI_V2_QUESTIONS, META: ETI_V2_META, E: ETIv2, CHARS: ETI_V2_CHARACTERS_2_1_0, SEL: ETIMirrorSelectionV21,' +
    ' EP: ELEMENT_PROTOTYPES_V2, WP: WEAPON_PROTOTYPES_V2, NP: NATION_PROTOTYPES_V2, TRANS: TRANSLATION_MODEL_VERSION };')();
  const resolverPath = path.join(repoRoot, 'js/eti_v2_mirror_resolver.js');
  delete require.cache[require.resolve(resolverPath)];
  const resolver = require(resolverPath);
  resolver.configure({ ETI_V2_CHARACTERS_2_1_0: ctx.CHARS, ETI_V2_META: ctx.META, ETIv2: ctx.E, ETIMirrorSelectionV21: ctx.SEL,
    ELEMENT_PROTOTYPES_V2: ctx.EP, WEAPON_PROTOTYPES_V2: ctx.WP, NATION_PROTOTYPES_V2: ctx.NP });
  ctx.resolver = resolver;
  ctx.repoRoot = repoRoot;
  ctx.provenance = ENGINE_FILES.map((f) => ({ file: f, sha256: sha256(fs.readFileSync(path.join(repoRoot, f))) }));
  // 同梱スナップショットのハッシュと一致することを確認（リポジトリの js/ が変わった・同梱物が改変された時は止める）
  const man = JSON.parse(fs.readFileSync(path.join(VENDOR_ROOT, 'MANIFEST.json'), 'utf8'));
  const mismatch = ctx.provenance.filter((p) => man.files[p.file] !== p.sha256).map((p) => p.file);
  if (mismatch.length) { const e = new Error('STOP: canonical engine differs from the pinned snapshot — ' + mismatch.join(', ')); e.stop = 1; throw e; }
  ctx.engineSource = repoRoot === VENDOR_ROOT ? 'vendor/eti-js（同梱スナップショット）' : 'repository js/';
  verifyVersions(ctx);
  cached = ctx;
  return ctx;
}

// 停止条件1・3：正本6ファイルの版が一致しない／118名以外が混在する場合は生成しない。
function verifyVersions(ctx) {
  const errs = [];
  const M = ctx.META;
  if (M.diagnosisVersion !== EXPECTED_VERSIONS.diagnosis) errs.push('diagnosisVersion ' + M.diagnosisVersion);
  if (M.itemSetVersion !== EXPECTED_VERSIONS.items) errs.push('itemSetVersion ' + M.itemSetVersion);
  if (M.scoringVersion !== EXPECTED_VERSIONS.scoring) errs.push('scoringVersion ' + M.scoringVersion);
  if (M.translationModelVersion !== EXPECTED_VERSIONS.translation || ctx.TRANS !== EXPECTED_VERSIONS.translation) errs.push('translation ' + ctx.TRANS);
  if (M.characterProfileVersion !== EXPECTED_VERSIONS.characters) errs.push('characterProfileVersion ' + M.characterProfileVersion);
  if (M.mirrorModelVersion !== EXPECTED_VERSIONS.mirror || ctx.SEL.MIRROR_VERSION !== EXPECTED_VERSIONS.mirror) errs.push('mirror ' + ctx.SEL.MIRROR_VERSION);
  if (ctx.Q.length !== 100) errs.push('questions ' + ctx.Q.length);
  if (ctx.CHARS.length !== 118) errs.push('characters ' + ctx.CHARS.length);
  const badChar = ctx.CHARS.filter((c) => c.profile_version !== EXPECTED_VERSIONS.characters);
  if (badChar.length) errs.push('character profile_version mismatch: ' + badChar.map((c) => c.name).join(','));
  if (new Set(ctx.CHARS.map((c) => c.name)).size !== 118) errs.push('duplicate character names');
  if (errs.length) { const e = new Error('STOP: canonical version mismatch — ' + errs.join('; ')); e.stop = 1; throw e; }
}

module.exports = { REPO_ROOT, VENDOR_ROOT, PROJECT_ROOT, ENGINE_FILES, EXPECTED_VERSIONS, DISPLAY_NAME, displayName, loadEngine, sha256 };
