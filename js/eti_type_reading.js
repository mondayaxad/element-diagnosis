// eti_type_reading.js
// 100問に答え直さない購入（元素・武器・国家の3つの選択から読むタイプ別のレポート）の計算。
//   ・新しい判定理論は作らない。元素・武器・国家の代表値（js/eti_v2_prototypes.js）と、本番の MIRROR v2.1
//     （js/eti_v2_mirror_resolver.js の computeMirror：重み 4:3:3・同率時の順序も同じ）をそのまま使う。
//   ・代表プロファイル ＝ 母集団の平均 ＋ K ×（タイプの代表値 − 母集団の平均）。20軸すべて。
//     K と母集団の平均は版（TYPE_PROFILE_VERSION）ごとに固定する（購入済みのレポートの表示を後から変えない）。
//     K=0.65：代表プロファイルを判定し直すと 280 タイプすべてで元のタイプに戻る範囲で、実際の診断結果との一致が最も高い値
//     （2026-11-03 の本番 797 件の匿名の集計で検証。docs は QUICK_REPORT の監査報告）。
//   ・代表プロファイルは内部の計算だけに使う。個人の実測値として表示しない。
//   ・ユーザーが選んだキャラクターは表示の補助だけ（順位を動かさない）。
(function (root) {
  'use strict';
  var TYPE_PROFILE_VERSION = 'ETI-TYPE-PROFILE-1.0.0';
  var TYPE_RANK_VERSION = 'ETI-TYPE-RANK-1.0.0';
  var MIRROR_VERSION = 'ETI-MIRROR-2.1.0';
  var K = 0.65;
  // 母集団の平均（本番の ETI-2.0 の診断 797 件。2026-11-03 時点の固定値）
  var POP_MEAN = Object.freeze({
    personality: Object.freeze({ O: 66.0, C: 48.0, E: 37.2, A: 60.9, N: 66.8 }),
    style: Object.freeze({ AGY: 48.0, REL: 63.1, ROL: 62.6, REF: 64.0, AUT: 60.1 }),
    values: Object.freeze({ SD: 68.5, ST: 59.7, HE: 81.4, AC: 65.6, PO: 31.0, SE: 78.7, CO: 70.2, TR: 57.4, BE: 80.5, UN: 70.1 }),
  });
  var AXIS_LABEL = Object.freeze({
    O: '開放性', C: '誠実性', E: '外向性', A: '協調性', N: '感受性の鋭さ',
    AGY: '主導性', REL: '関係調整', ROL: '役割持続', REF: '媒介思考', AUT: '自律距離',
    SD: '自分で選ぶこと', ST: '新しい刺激', HE: '楽しみ', AC: '達成', PO: '影響力', SE: '安定', CO: '節度', TR: '伝統', BE: '身近な人への思いやり', UN: '公正さ',
  });
  var ELEMENTS = ['炎', '水', '氷', '雷', '風', '岩', '草'];
  var WEAPONS = ['片手剣', '両手剣', '長柄', '法器', '弓'];
  var NATIONS = ['モンド', '璃月', '稲妻', 'スメール', 'フォンテーヌ', 'ナタ', 'スネージナヤ', 'ナドクライ'];

  // ブラウザでは、同じページの classic script の const（トップレベルの字句スコープ）を名前で参照する。Node では root（globalThis）から
  function g(name) { return root[name]; }
  function protos() {
    /* global ELEMENT_PROTOTYPES_V2, WEAPON_PROTOTYPES_V2, NATION_PROTOTYPES_V2 */
    return {
      E: typeof ELEMENT_PROTOTYPES_V2 !== 'undefined' ? ELEMENT_PROTOTYPES_V2 : g('ELEMENT_PROTOTYPES_V2'),
      W: typeof WEAPON_PROTOTYPES_V2 !== 'undefined' ? WEAPON_PROTOTYPES_V2 : g('WEAPON_PROTOTYPES_V2'),
      N: typeof NATION_PROTOTYPES_V2 !== 'undefined' ? NATION_PROTOTYPES_V2 : g('NATION_PROTOTYPES_V2'),
    };
  }
  // 国家は「覚えていない」（null）も選べる。その時の価値観は母集団の平均（どの国家にも寄せない）
  function isType(e, w, n) { return ELEMENTS.indexOf(e) >= 0 && WEAPONS.indexOf(w) >= 0 && (n === null || NATIONS.indexOf(n) >= 0); }
  function shrink(proto, mean) {
    var out = {};
    Object.keys(mean).forEach(function (a) { out[a] = mean[a] + K * (proto[a] - mean[a]); });
    return out;
  }
  // タイプの代表プロファイル（20軸）。表示には使わない
  function profileFor(e, w, n) {
    if (!isType(e, w, n)) throw new Error('unknown type');
    var p = protos();
    return { personality: shrink(p.E[e], POP_MEAN.personality), style: shrink(p.W[w], POP_MEAN.style), values: n ? shrink(p.N[n], POP_MEAN.values) : Object.assign({}, POP_MEAN.values) };
  }
  // 共通点：タイプの代表プロファイルとキャラクターが、母集団の平均から同じ向きに強く離れている軸（上位 n 個）
  function sharedAxes(profile, ch, n) {
    var rows = [];
    [['personality', POP_MEAN.personality], ['style', POP_MEAN.style], ['values', POP_MEAN.values]].forEach(function (pair) {
      var dom = pair[0], mean = pair[1];
      Object.keys(mean).forEach(function (a) {
        var u = profile[dom][a] - mean[a], c = ch[dom][a] - mean[a];
        if (u * c > 0) rows.push({ axis: a, label: AXIS_LABEL[a], high: u > 0, weight: u * c });
      });
    });
    rows.sort(function (x, y) { return y.weight - x.weight || (x.axis < y.axis ? -1 : 1); });
    return rows.slice(0, n || 3).map(function (r) { return { axis: r.axis, label: r.label, high: r.high }; });
  }
  // タイプ類似度ランキング（同じタイプなら常に同じ順位。MIRROR v2.1 と同じ式・同じ並び順）
  function rankingFor(e, w, n, limit) {
    var R = g('ETIv2MirrorResolver');
    var profile = profileFor(e, w, n);
    var computed = R.computeMirror(profile, MIRROR_VERSION);
    var chars = R.normalizedCharacters(MIRROR_VERSION);
    var byName = {};
    chars.forEach(function (c) { byName[c.name] = c; });
    var ranked = computed.rankings.slice().sort(function (a, b) {
      return (b.mirrorScoreRaw - a.mirrorScoreRaw) || (a.canonicalIndex - b.canonicalIndex);
    });
    // 1位は MIRROR v2.1 の選び方（同率時：元素→国家→武器→固定の順）に合わせる
    var top = computed.mirror && computed.mirror.name;
    if (top) ranked = [ranked.find(function (r) { return r.name === top; })].concat(ranked.filter(function (r) { return r.name !== top; }));
    return ranked.slice(0, limit || 10).map(function (r, i) {
      var c = byName[r.name] || {};
      return {
        rank: i + 1, name: r.name, element: c.element, weapon: c.weapon, region: c.region,
        same: { element: c.element === e, weapon: c.weapon === w, nation: c.region === n },
        basisTags: (c.basis_tags || []).slice(0, 6),
        shared: sharedAxes(profile, c, 3),
      };
    });
  }
  function rankOf(e, w, n, name) {
    var all = rankingFor(e, w, n, 200);
    var hit = all.find(function (r) { return r.name === name; });
    return hit ? hit.rank : null;
  }
  function characters() {
    var R = g('ETIv2MirrorResolver');
    return R.normalizedCharacters(MIRROR_VERSION).map(function (c) { return { name: c.name, element: c.element, weapon: c.weapon, region: c.region }; });
  }

  function engine() { return typeof ETIv2 !== 'undefined' ? ETIv2 : g('ETIv2'); }
  function meta() { return typeof ETI_V2_META !== 'undefined' ? ETI_V2_META : g('ETI_V2_META'); }
  function mix(a, b, t) { var o = {}; Object.keys(a).forEach(function (k) { o[k] = a[k] + t * (b[k] - a[k]); }); return o; }
  // 3つの判定（元素・武器・国家）を、本番の採点と同じ関数で行う
  function rankAll(profile) {
    var E = engine(), M = meta(), p = protos();
    return {
      element: E.rankByDistance(p.E, profile.personality, M.personalityAxes),
      weapon: E.rankByDistance(p.W, profile.style, M.styleAxes),
      nation: E.rankNationsByCenteredValues(p.N, profile.values, M.valueAxes),
    };
  }
  function keepsType(profile, e, w, n) {
    var r = rankAll(profile);
    return r.element.ranking[0].name === e && r.weapon.ranking[0].name === w && (n === null || r.nation.ranking[0].name === n);
  }
  // 選んだキャラクターが一致度1位になる、タイプの代表プロファイルに最も近い点（そのキャラクターへ寄せる割合 t を 0.01 刻みで最小に）。
  //   元素・武器・国家の判定が選んだタイプのまま保たれる範囲だけ。保てない（1位にならない）キャラクターは null
  function blendFor(e, w, n, name) {
    var R = g('ETIv2MirrorResolver');
    var base = profileFor(e, w, n);
    var c = R.normalizedCharacters(MIRROR_VERSION).find(function (x) { return x.name === name; });
    if (!c) return null;
    for (var i = 0; i <= 100; i++) {
      var t = i / 100;
      // 表示と同じ整数の値で確かめる（丸めで順位・判定が変わらないように）
      var prof = { personality: round(mix(base.personality, c.personality, t)), style: round(mix(base.style, c.style, t)), values: round(mix(base.values, c.values, t)) };
      if (!keepsType(prof, e, w, n)) return null;
      if (R.computeMirror(prof, MIRROR_VERSION).mirror.name === name) return { t: t, profile: prof };
    }
    return null;
  }
  // 選んだタイプで、一致度1位になり得るキャラクター（入力画面の候補）。事前計算した表（js/type_reading_chars.js）があれば使う
  function candidatesFor(e, w, n) {
    var table = typeof EdTypeReadingChars !== 'undefined' ? EdTypeReadingChars : g('EdTypeReadingChars');
    var key = e + '|' + w + '|' + (n || '-');
    if (table && table.TYPES && table.TYPES[key]) return table.TYPES[key].map(function (x) { return x[0]; });
    return characters().filter(function (c) { return !!blendFor(e, w, n, c.name); }).map(function (c) { return c.name; });
  }
  function round(o) { var r = {}; Object.keys(o).forEach(function (k) { r[k] = Math.max(0, Math.min(100, Math.round(o[k]))); }); return r; }
  // 通常のレポートと同じ形の結果（computeResultsV2 の戻り値と同じ形）。数値は選んだタイプ（と選んだキャラクター）から決まる値
  function resultsFor(e, w, n, characterName) {
    var M = meta();
    var picked = characterName ? blendFor(e, w, n, characterName) : null;
    if (characterName && !picked) throw new Error('character cannot be top for this type');
    var prof = picked ? picked.profile : profileFor(e, w, n);
    var personality = round(prof.personality), style = round(prof.style), values = round(prof.values);
    var r = rankAll({ personality: personality, style: style, values: values });
    var vAvg = M.valueAxes.reduce(function (s, a) { return s + values[a]; }, 0) / M.valueAxes.length;
    var raw = {
      personality: personality, style: style, values: values,
      valuesCentered: Object.fromEntries(M.valueAxes.map(function (a) { return [a, (values[a] - vAvg) / 25]; })),
      elementRanking: r.element.ranking, elementTopGap: r.element.topGap,
      weaponRanking: r.weapon.ranking, weaponTopGap: r.weapon.topGap,
      nationRanking: r.nation.ranking, nationTopGap: r.nation.topGap,
      meta: { diagnosisVersion: M.diagnosisVersion, itemSetVersion: M.itemSetVersion, scoringVersion: M.scoringVersion },
      typeReading: { element: e, weapon: w, nation: n, character: characterName || null, blend: picked ? picked.t : 0,
        profileVersion: TYPE_PROFILE_VERSION, rankVersion: TYPE_RANK_VERSION },
    };
    if (r.element.ranking[0].name !== e || r.weapon.ranking[0].name !== w || (n && r.nation.ranking[0].name !== n)) throw new Error('type not preserved');
    return raw;
  }

  var api = {
    TYPE_PROFILE_VERSION: TYPE_PROFILE_VERSION, TYPE_RANK_VERSION: TYPE_RANK_VERSION, MIRROR_VERSION: MIRROR_VERSION,
    K: K, POP_MEAN: POP_MEAN, AXIS_LABEL: AXIS_LABEL, ELEMENTS: ELEMENTS, WEAPONS: WEAPONS, NATIONS: NATIONS,
    isType: isType, profileFor: profileFor, rankingFor: rankingFor, blendFor: blendFor, candidatesFor: candidatesFor, resultsFor: resultsFor, keepsType: keepsType, rankOf: rankOf, sharedAxes: sharedAxes, characters: characters,
  };
  root.EdTypeReading = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
