// 合成入力から下書き（FutureSelfProfile）の例を書き出す。再現性の確認にも使う。
//   実行: node alpha/ideal-self/scripts/export-samples.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { etiCurrent, quickCurrent, answerAll, QUIET_CHARISMA, WARM_DRIVE, S } from '../tests/helpers.js';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../docs/samples');
fs.mkdirSync(OUT, { recursive: true });
const cases = {
  'eti_introvert__quiet_charisma': answerAll(etiCurrent(), QUIET_CHARISMA),
  'eti_introvert__warm_drive': answerAll(etiCurrent(), WARM_DRIVE),
  'quick_introvert__quiet_charisma': answerAll(quickCurrent(), QUIET_CHARISMA),
  'eti_introvert__radiance_unresolved': answerAll(etiCurrent(), { ...QUIET_CHARISMA, E1: ['radiance'], G1: ['social_ease'], G2: ['crowd'] }),
};
for (const [name, s] of Object.entries(cases)) {
  const p = S.buildDraft(s).profile;
  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(p, null, 2) + '\n');
  console.log(`${name}: ${p.persona_version}  ${p.summary.text}`);
}
