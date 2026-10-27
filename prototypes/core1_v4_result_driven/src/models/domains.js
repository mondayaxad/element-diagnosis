// CORE1-DOMAIN-EDITORIAL-0.1.0 — 20軸を「貢献の観点」で読む編集用派生指標（確立された心理尺度ではない）。
// 各ドメイン＝採用4軸の単純平均を四捨五入。合計100%へ正規化しない。ST/HE/CO/TR は含めない。
'use strict';
const DOMAIN_MODEL = Object.freeze({
  version: 'CORE1-DOMAIN-EDITORIAL-0.1.0',
  domains: [
    { key: 'understanding', label: '理解・戦略', axes: ['O', 'REF', 'SD', 'UN'] },
    { key: 'integration', label: '関係・統合', axes: ['A', 'N', 'REL', 'BE'] },
    { key: 'sustain', label: '実行・持続', axes: ['C', 'ROL', 'SE', 'AC'] },
    { key: 'expression', label: '発信・拡張', axes: ['E', 'AGY', 'AUT', 'PO'] },
  ],
  excludedAxes: ['ST', 'HE', 'CO', 'TR'],
});

function domains(axisValue) {
  return DOMAIN_MODEL.domains.map((d) => {
    const axes = d.axes.map((ax) => ({ axis: ax, value: axisValue(ax) }));
    const mean = axes.reduce((s, a) => s + a.value, 0) / axes.length;
    return { key: d.key, label: d.label, axes, mean, display: Math.round(mean) };
  });
}
module.exports = { DOMAIN_MODEL, domains };
