// 200件の無作為な回答で：ロック解除の背景（モザイク）が本人の得点に左右されないこと、
// 有料部分の表示（rp-bar・レーダー・「あなた NN／参照 NN」）がモザイクの外に出ないことを確かめる
import { computeDiagnosis } from '/home/user/element-diagnosis/jagan/engine/runtime.mjs';
import { BUNDLE } from '/home/user/element-diagnosis/jagan/engine/data.mjs';
import { renderResultPage } from '/home/user/element-diagnosis/jagan/view.mjs';
const ids = BUNDLE.items.items.map(i => i.id);
let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const groupMosaic = new Set(), charMosaic = new Map(); let outside = 0, n = 0, chars = 0;
for (let k = 0; k < 200; k++) {
  const answers = Object.fromEntries(ids.map(id => [id, 1 + Math.floor(rnd() * 5)]));
  const r = computeDiagnosis({ answers, itemSetVersion: BUNDLE.items.item_set_version }, BUNDLE);
  const html = renderResultPage(r, BUNDLE);
  const re = /<div class="rx-mosaic"[^>]*>([\s\S]*?)<\/div>\s*<button type="button" class="rx-preview-btn"/g;
  const mos = [...html.matchAll(re)].map(m => m[1]);
  const rest = html.replace(re, '');
  if (/class="rp-bar"|class="rp-radar"|あなた \d+／参照/.test(rest)) outside++;
  if (r.character.status === 'available') { chars++; const m = mos.shift(); const prev = charMosaic.get(r.character.id); if (prev && prev !== m) outside++; charMosaic.set(r.character.id, m); }
  groupMosaic.add(mos.join('|')); n++;
}
console.log({ results: n, withCharacter: chars, distinctGroupMosaics: groupMosaic.size, distinctCharMosaicsPerCharacter: charMosaic.size, paidPartsOutsideMosaicOrVarying: outside });
