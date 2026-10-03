// eti_v2_mirror_resolver.js
// ETI v2 の MIRROR を「版ごと」に計算する入口。index / report / mypage はここだけを呼ぶ。
//
// 版ごとの違い（設問・採点・翻訳＝ETI-ITEM/SCORE/TRANS-2.0.0 は共通で変えない）：
//   ETI-MIRROR-2.0.2 … キャラクター座標 ETI-CHAR-2.0.1（js/characters118_v2.js）。MIRROR = 生スコア順位の1位。
//   ETI-MIRROR-2.1.0 … キャラクター座標 ETI-CHAR-2.1.0（js/characters118_v2_1.js）。MIRROR は
//                      js/eti_mirror_selection_v21.js（生スコア最大から 1e-10pt 以内の同率集合 →
//                      元素 → 国家 → 武器 → canonical 番号）で1人を選ぶ。
// どちらの版でも、一致率ランキング（rankings）は ETIv2.computeMirrorV2 の生スコア順のまま返す。
// rankings[0] が MIRROR とは限らない（2.1.0 の同率時）。MIRROR 表示・保存には必ず .mirror を使う。
//
// 版の扱い（2026-10-03 決定）：
//   - ETI v2 の結果・記録は Preview にしか存在しないため、保存済みの記録・mv の無い旧URL・レポートとも
//     最新版（CURRENT）で表示する（displayVersionForSaved / versionFromUrlParam）。DB の保存行は書き換えない。
//   - 旧版（ETI-MIRROR-2.0.2 / ETI-CHAR-2.0.1）の座標と計算はそのまま残し、computeMirror(…, 'ETI-MIRROR-2.0.2') で使える。
//   - 新しい結果URL・共有URLには mv（例 mv=2.1.0）を付ける。将来の版で、mv 付きURLはその版のまま表示できる。
//
// 依存：ETI_v2_QUESTIONS_100.js（ETI_V2_META）, eti_v2_prototypes.js, eti_v2_engine.js（ETIv2）,
//       characters118_v2.js（ETI_V2_CHARACTERS）, characters118_v2_1.js（ETI_V2_CHARACTERS_2_1_0）,
//       eti_mirror_selection_v21.js（ETIMirrorSelectionV21）
(function (root) {
  'use strict';

  var CURRENT = 'ETI-MIRROR-2.1.0';
  var LEGACY_V2 = 'ETI-MIRROR-2.0.2';
  // URL の mv パラメータ（短い表記）⇔ mirror_model_version
  var URL_TOKEN = { '2.1.0': 'ETI-MIRROR-2.1.0', '2.0.2': 'ETI-MIRROR-2.0.2' };
  // 表示・辞書照合用の地域名の別表記（index.html / report.html の NATION_REGION_ALIAS_V2 と同じ既存の対応）
  var REGION_ALIAS = { 'ナド・クライ': 'ナドクライ' };

  // classic script の top-level const（ETI_V2_CHARACTERS 等）は window のプロパティにならないため、
  // 素の識別子で参照する。Node のテストでは configure() で差し込む。
  var injected = {};
  var cache = {};
  function g(name) {
    if (injected[name] !== undefined) return injected[name];
    switch (name) {
      case 'ETI_V2_CHARACTERS': return typeof ETI_V2_CHARACTERS !== 'undefined' ? ETI_V2_CHARACTERS : undefined;
      case 'ETI_V2_CHARACTERS_2_1_0': return typeof ETI_V2_CHARACTERS_2_1_0 !== 'undefined' ? ETI_V2_CHARACTERS_2_1_0 : undefined;
      case 'ETI_V2_META': return typeof ETI_V2_META !== 'undefined' ? ETI_V2_META : undefined;
      case 'ETIv2': return typeof ETIv2 !== 'undefined' ? ETIv2 : undefined;
      case 'ETIMirrorSelectionV21': return typeof ETIMirrorSelectionV21 !== 'undefined' ? ETIMirrorSelectionV21 : undefined;
      case 'ELEMENT_PROTOTYPES_V2': return typeof ELEMENT_PROTOTYPES_V2 !== 'undefined' ? ELEMENT_PROTOTYPES_V2 : undefined;
      case 'WEAPON_PROTOTYPES_V2': return typeof WEAPON_PROTOTYPES_V2 !== 'undefined' ? WEAPON_PROTOTYPES_V2 : undefined;
      case 'NATION_PROTOTYPES_V2': return typeof NATION_PROTOTYPES_V2 !== 'undefined' ? NATION_PROTOTYPES_V2 : undefined;
    }
    return undefined;
  }
  function configure(deps) { Object.keys(deps || {}).forEach(function (k) { injected[k] = deps[k]; }); cache = {}; }

  function models() {
    return {
      'ETI-MIRROR-2.0.2': { characterProfileVersion: 'ETI-CHAR-2.0.1', characters: g('ETI_V2_CHARACTERS'), selector: 'raw_top' },
      'ETI-MIRROR-2.1.0': { characterProfileVersion: 'ETI-CHAR-2.1.0', characters: g('ETI_V2_CHARACTERS_2_1_0'), selector: 'v21' },
    };
  }

  // 保存済み・URL の版文字列を、計算できる版へ解決する。
  // 2.1.0 以外（2.0.2 や、2.0.1 座標で表示していた過去の 2.0.0 等）は、これまでどおり ETI-CHAR-2.0.1 で計算する。
  function resolveVersion(mirrorModelVersion) {
    return mirrorModelVersion === CURRENT ? CURRENT : LEGACY_V2;
  }

  function versionFromUrlParam(mv) {
    if (mv && URL_TOKEN[mv]) return URL_TOKEN[mv];
    return CURRENT; // mv 無し（または不明）のURLは最新版で表示する（Preview のデータは最新版へ更新する決定）
  }

  // 保存済みの記録を表示するときの版。Preview の v2 記録は保存時の版にかかわらず最新版で表示する。
  function displayVersionForSaved(savedMirrorModelVersion) { // eslint-disable-line no-unused-vars
    return CURRENT;
  }

  function urlParamFor(mirrorModelVersion) {
    var v = resolveVersion(mirrorModelVersion);
    return v === CURRENT ? '2.1.0' : '2.0.2';
  }

  // 表示用：region が null の3名は表示だけ legacy.old_nation_field を使い、別表記を揃える（既存仕様と同じ）
  function displayRegion(c) {
    var r = c.region || (c.legacy && c.legacy.old_nation_field) || null;
    return REGION_ALIAS[r] || r;
  }
  // 選択用：事実データの region だけを使う（null は国家一致なし）。別表記のみ既存の対応で揃える。
  function factualRegion(c) {
    var r = c.region || null;
    return r ? (REGION_ALIAS[r] || r) : null;
  }

  function normalizedCharacters(version) {
    if (!cache[version]) {
      var src = models()[version].characters;
      cache[version] = src.map(function (c) { return Object.assign({}, c, { region: displayRegion(c) }); });
    }
    return cache[version];
  }

  // results: ETIv2.computeResultsV2 の戻り値
  // 戻り値：{ mirrorModelVersion, characterProfileVersion, rankings, mirror, selectionMeta }
  function computeMirror(results, mirrorModelVersion, deps) {
    deps = deps || {};
    var engine = deps.engine || g('ETIv2');
    var meta = deps.meta || g('ETI_V2_META');
    var version = resolveVersion(mirrorModelVersion);
    var model = models()[version];
    var chars = normalizedCharacters(version);
    var rankings = engine.computeMirrorV2(results, chars, meta);
    var mirror, selectionMeta;
    if (model.selector === 'v21') {
      var factual = model.characters;
      // 選択だけは事実データの region で判定する（ランキング行の region は表示用のまま）
      var forSelection = rankings.map(function (r) {
        return Object.assign({}, r, { region: factualRegion(factual[r.canonicalIndex]) });
      });
      var sel = (deps.selector || g('ETIMirrorSelectionV21')).selectMirrorV21(results, forSelection, {
        engine: engine,
        meta: meta,
        elementPrototypes: deps.elementPrototypes || g('ELEMENT_PROTOTYPES_V2'),
        nationPrototypes: deps.nationPrototypes || g('NATION_PROTOTYPES_V2'),
        weaponPrototypes: deps.weaponPrototypes || g('WEAPON_PROTOTYPES_V2'),
      });
      mirror = rankings.find(function (r) { return r.canonicalIndex === sel.mirror.canonicalIndex; });
      selectionMeta = sel.selectionMeta;
    } else {
      mirror = rankings[0];
      selectionMeta = { mirrorModelVersion: version, characterProfileVersion: model.characterProfileVersion, selectedBy: 'highest_raw_score' };
    }
    return {
      mirrorModelVersion: version,
      characterProfileVersion: model.characterProfileVersion,
      rankings: rankings,
      mirror: mirror,
      selectionMeta: selectionMeta,
    };
  }


  // 保存用 mirror_snapshot（既存の形＝一致率上位4名の配列を保つ）。
  //   - 並びは生スコア順位のまま（一致率順位は偽らない）
  //   - 選ばれた MIRROR の行に selected:true と選択根拠（selection）を付ける
  //   - 選ばれた MIRROR が上位4名に入らない場合（5名以上が完全同率のときだけ起こり得る）は5件目に足す
  // 読む側は「selected:true の行 → 無ければ先頭」を MIRROR とする。
  function buildMirrorSnapshot(computed) {
    var mirror = computed.mirror;
    var row = function (r) {
      return { name: r.name, match: r.mirrorScore, el: r.element, w: r.weapon, nation: r.region };
    };
    var top = computed.rankings.slice(0, 4).map(row);
    var idx = computed.rankings.slice(0, 4).findIndex(function (r) { return r.canonicalIndex === mirror.canonicalIndex; });
    if (idx < 0) { top.push(row(mirror)); idx = top.length - 1; }
    var meta = computed.selectionMeta || {};
    top[idx].selected = true;
    top[idx].selection = {
      mirror_model_version: computed.mirrorModelVersion,
      character_profile_version: computed.characterProfileVersion,
      selected_by: meta.selectedBy || 'highest_raw_score',
      tied_at_top: typeof meta.tiedAtTopCount === 'number' ? meta.tiedAtTopCount : 1,
    };
    return top;
  }

  // 保存済み snapshot から MIRROR の行を取り出す（selected:true → 無ければ先頭）
  function mirrorFromSnapshot(snapshot) {
    if (!Array.isArray(snapshot) || !snapshot.length) return null;
    return snapshot.find(function (r) { return r && r.selected; }) || snapshot[0];
  }

  var api = {
    CURRENT: CURRENT,
    LEGACY_V2: LEGACY_V2,
    resolveVersion: resolveVersion,
    versionFromUrlParam: versionFromUrlParam,
    displayVersionForSaved: displayVersionForSaved,
    urlParamFor: urlParamFor,
    normalizedCharacters: normalizedCharacters,
    computeMirror: computeMirror,
    configure: configure,
    buildMirrorSnapshot: buildMirrorSnapshot,
    mirrorFromSnapshot: mirrorFromSnapshot,
  };
  root.ETIv2MirrorResolver = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
