// eti_mini_core.js — 元素診断 Mini の結果を決める層（画面・保存・決済は持たない）。
//
// 方針（docs/eti-mini/handoff_v1/README_Claude_実装指示書.md）
//   ・キャラクター未選択：固定割当表（js/eti_mini_auto_map_v1.js）を key「元素|武器|国家の内部キー」で引くだけ。再抽選しない。
//   ・キャラクター手動選択：js/eti_mini_manual_v1.js（ETI-MINI-MANUAL-1.0.0）が setManualCombiner() で計算を差し込む。
//     差し込まれていなければ manualResult() は結果を仮計算せず MANUAL_SELECTION_NOT_CONFIGURED を投げる。
//   ・結果の ETI（元素・武器・国家）とキャラクターのゲーム内属性は一致しなくてよい。キャラクター側へ寄せない。
//   ・点数・一致率・順位は扱わない（表示しない）。
//   ・下の表示用の辞書は index.html の正本（TYPE_NAME・*_CODE・ELEMENTS.keyword・WEAPONS.style・NATION_MEANING）の写し。
//     tests/eti_mini.test.js が index.html と一致することを確かめる（黙って上書きしない）。
(function (root) {
  'use strict';

  var CORE_VERSION = 'ETI-MINI-CORE-0.2.0';
  var ELEMENT_KEYS = ['炎', '水', '氷', '雷', '風', '岩', '草'];
  var WEAPON_KEYS = ['片手剣', '両手剣', '長柄', '法器', '弓'];
  var NATION_KEYS = ['モンド', '璃月', '稲妻', 'スメール', 'フォンテーヌ', 'ナタ', 'スネージナヤ', 'ナドクライ'];
  // 画面の表記（内部キーはそのまま。ナドクライの意味は「月光」のまま変えない）
  var NATION_DISPLAY = { 'ナドクライ': 'ナド・クライ' };

  var ELEMENT_CODE = { '炎': 'PY', '水': 'HY', '氷': 'CR', '雷': 'EL', '風': 'AN', '岩': 'GE', '草': 'DE' };
  var WEAPON_CODE = { '片手剣': 'SW', '両手剣': 'CM', '長柄': 'PL', '法器': 'CT', '弓': 'BW' };
  var NATION_CODE = { 'モンド': 'M', '璃月': 'L', '稲妻': 'I', 'スメール': 'S', 'フォンテーヌ': 'F', 'ナタ': 'N', 'スネージナヤ': 'Z', 'ナドクライ': 'D' };
  var TYPE_NAME = {
    '炎': { '片手剣': '殉愛者', '両手剣': '猛進者', '長柄': '殉衛者', '法器': '信奉者', '弓': '貫徹者' },
    '水': { '片手剣': '同調者', '両手剣': '孤淵者', '長柄': '静衛者', '法器': '深識者', '弓': '静観者' },
    '氷': { '片手剣': '宿縁者', '両手剣': '破氷者', '長柄': '氷壁者', '法器': '透徹者', '弓': '凍眼者' },
    '雷': { '片手剣': '共鳴者', '両手剣': '破天者', '長柄': '雷衛者', '法器': '電導者', '弓': '疾光者' },
    '風': { '片手剣': '随風者', '両手剣': '疾風者', '長柄': '客衛者', '法器': '漂識者', '弓': '追風者' },
    '岩': { '片手剣': '包容者', '両手剣': '破岩者', '長柄': '護衛者', '法器': '礎識者', '弓': '遠護者' },
    '草': { '片手剣': '縁結者', '両手剣': '芽吹者', '長柄': '育衛者', '法器': '叡結者', '弓': '見守者' },
  };
  var ELEMENT_KEYWORD = { '炎': '情熱を義務が統べる', '水': '底を見せず流れる', '氷': '感情を封じ宿命を負う', '雷': '信念を貫き二極を走る', '風': '形なく流れ昇華する', '岩': '動かず他者を支える', '草': '知り感じ繋がり続ける' };
  var WEAPON_STYLE = { '片手剣': '関係依存型', '両手剣': '自己駆動型', '長柄': '役割献身型', '法器': '媒介思考型', '弓': '距離保持型' };
  var NATION_MEANING = { 'モンド': '自由', '璃月': '契約', '稲妻': '永遠', 'スメール': '知恵', 'フォンテーヌ': '正義', 'ナタ': '戦争', 'スネージナヤ': '慈愛', 'ナドクライ': '月光' };
  // ふつうの言葉での一文（index.html の ELEMENT_DESC・WEAPON_DESC の最初の一文、NATION_DESC の二文目の写し。tests/eti_mini.test.js が一致を確かめる）
  var ELEMENT_PLAIN = {
    '炎': '炎は、義務感と情熱がせめぎ合う元素です。', '水': '水は、周囲との調和を保ちながら、内側に見せない部分を抱える元素です。',
    '氷': '氷は、外への発信を抑え、内側の解像度を高める元素です。', '雷': '雷は、信念を貫く強さと、型を破る衝動がせめぎ合う元素です。',
    '風': '風は、七元素の中でもっとも定まった形を持たない元素です。', '岩': '岩は、誠実さと協調性を土台に、守り支える性質を持つ元素です。',
    '草': '草は、知性と共生が結びつく元素です。',
  };
  var WEAPON_PLAIN = {
    '片手剣': '片手剣は、他者との関わりの中で力を発揮する武器です。', '両手剣': '両手剣は、独力で道を切り拓く武器です。',
    '長柄': '長柄は、間合いを保ちながら集団を守る武器です。', '法器': '法器は、術式という抽象を介して世界と接続する武器です。',
    '弓': '弓は、距離を取りながら精密に狙いを定める武器です。',
  };
  var NATION_PLAIN = {
    'モンド': '誰にも縛られず、自分の意志で選び取ることに、何よりの価値を置きます。', '璃月': '交わした約束を守り、目に見える成果を積み上げることに、価値を置きます。',
    '稲妻': '変わらないものを守り、受け継がれる伝統に、価値を置きます。', 'スメール': '物事の真実を追い求め、知識を分かち合うことに、価値を置きます。',
    'フォンテーヌ': '公正さと調和を重んじ、誰に対しても等しくあることに、価値を置きます。', 'ナタ': '真っ向からぶつかり合う戦いの中でこそ、生きる実感を得ることに、価値を置きます。',
    'スネージナヤ': '大切なものを守るためなら、厳しい現実にも立ち向かい、自らが痛みを引き受けることに価値を置きます。',
    'ナドクライ': '表舞台の喧騒から離れ、静かな場所で自分の価値観を保つことに、価値を置きます。',
  };

  function MiniError(code, message) {
    var e = new Error(message || code);
    e.name = 'EtiMiniError';
    e.code = code;
    return e;
  }

  function autoMap() {
    var m = root.ETI_MINI_AUTO_MAP_V1 || (typeof ETI_MINI_AUTO_MAP_V1 !== 'undefined' ? ETI_MINI_AUTO_MAP_V1 : null); // eslint-disable-line no-undef
    if (!m || !m.rows) throw MiniError('AUTO_MAP_MISSING', '固定割当表が読み込まれていません');
    return m;
  }

  // 3問すべてが内部キーで答えられているか。足りない・辞書に無い値は結果を出さずに止める。
  function validateAnswers(answers) {
    var a = answers || {};
    var problems = [];
    if (ELEMENT_KEYS.indexOf(a.element) < 0) problems.push('element');
    if (WEAPON_KEYS.indexOf(a.weapon) < 0) problems.push('weapon');
    if (NATION_KEYS.indexOf(a.nation) < 0) problems.push('nation');
    if (problems.length) throw MiniError('INVALID_ANSWERS', '未回答または不明な回答: ' + problems.join(', '));
    return { element: a.element, weapon: a.weapon, nation: a.nation };
  }

  function keyOf(answers) { var a = validateAnswers(answers); return a.element + '|' + a.weapon + '|' + a.nation; }
  function displayNation(key) { return NATION_DISPLAY[key] || key; }
  function typeCode4(el, w) { return ELEMENT_CODE[el] + WEAPON_CODE[w]; }

  // ETI（元素・武器・国家）から表示用のタイプ情報を組み立てる
  function describeType(el, w, n) {
    return {
      element: el,
      weapon: w,
      nation: n,
      nationDisplay: displayNation(n),
      typeCode4: typeCode4(el, w),
      typeCode: typeCode4(el, w) + '-' + NATION_CODE[n],
      typeName: TYPE_NAME[el][w],
      typePage: '/type/' + typeCode4(el, w).toLowerCase(),
      // 既存の結果画面の一文（index.html の「この4文字の意味するところ」）と同じ素材
      words: { elementKeyword: ELEMENT_KEYWORD[el], weaponStyle: WEAPON_STYLE[w], nationMeaning: NATION_MEANING[n],
        elementPlain: ELEMENT_PLAIN[el], weaponPlain: WEAPON_PLAIN[w], nationPlain: NATION_PLAIN[n] },
    };
  }

  // キャラクター未選択の結果（固定割当表を引くだけ）
  function autoResult(answers) {
    var a = validateAnswers(answers);
    var map = autoMap();
    var key = a.element + '|' + a.weapon + '|' + a.nation;
    var name = Object.prototype.hasOwnProperty.call(map.rows, key) ? map.rows[key] : null;
    if (!name) throw MiniError('AUTO_MAP_KEY_MISSING', '固定割当表に無い組み合わせ: ' + key);
    var t = describeType(a.element, a.weapon, a.nation);
    t.answers = a;
    t.character = { name: name, selectedBy: 'auto' };
    t.versions = { core: CORE_VERSION, autoMap: map.version, autoMapSha256: map.sourceSha256 };
    return t;
  }

  // キャラクター手動選択の結合（未確定）。差し込まれるまで計算しない。
  //   combiner({ answers, character }) → { element, weapon, nation, version }
  //   character は ETI-CHAR-2.1.0 の1件（personality・style・values を含む）。
  var manualCombiner = null;
  function setManualCombiner(fn) { manualCombiner = typeof fn === 'function' ? fn : null; }
  function isManualSelectionReady() { return !!manualCombiner; }

  function manualResult(answers, character) {
    var a = validateAnswers(answers);
    if (!character || typeof character.name !== 'string') throw MiniError('INVALID_CHARACTER', 'キャラクターが不明です');
    if (!manualCombiner) throw MiniError('MANUAL_SELECTION_NOT_CONFIGURED', 'キャラクター指定の判定は準備中です');
    var r = manualCombiner({ answers: a, character: character });
    var e = validateAnswers(r);
    if (typeof r.version !== 'string' || !r.version) throw MiniError('MANUAL_COMBINER_INVALID', '結合の版がありません');
    var t = describeType(e.element, e.weapon, e.nation);
    t.answers = a;
    t.character = { name: character.name, selectedBy: 'user' };
    t.versions = { core: CORE_VERSION, manualCombiner: r.version };
    if (typeof r.weight === 'number') t.versions.manualWeight = r.weight;
    return t;
  }

  // 共鳴診断の結果：758 は3問だけで決まり、回答に映る人物（MIRROR）は固定割当表。
  // 本人が選んだ人物（SELF IMAGE）は自己認識の申告として並べて表示するだけで、758・MIRROR を変えない（50:50 の結合は使わない）
  var RESONANCE_VERSION = 'RESONANCE-C0';
  function resonanceResult(answers, selfCharacter) {
    var r = autoResult(answers);
    if (selfCharacter !== null && selfCharacter !== undefined && (typeof selfCharacter.name !== 'string' || !selfCharacter.name)) {
      throw MiniError('INVALID_CHARACTER', 'キャラクターが不明です');
    }
    r.mirror = { name: r.character.name, role: 'mirror' };
    r.self = selfCharacter ? { name: selfCharacter.name, role: 'self' } : null;
    delete r.character;
    r.versions.resonance = RESONANCE_VERSION;
    return r;
  }

  var api = {
    CORE_VERSION: CORE_VERSION, RESONANCE_VERSION: RESONANCE_VERSION, resonanceResult: resonanceResult,
    ELEMENT_KEYS: ELEMENT_KEYS, WEAPON_KEYS: WEAPON_KEYS, NATION_KEYS: NATION_KEYS,
    ELEMENT_CODE: ELEMENT_CODE, WEAPON_CODE: WEAPON_CODE, NATION_CODE: NATION_CODE, TYPE_NAME: TYPE_NAME,
    ELEMENT_KEYWORD: ELEMENT_KEYWORD, WEAPON_STYLE: WEAPON_STYLE, NATION_MEANING: NATION_MEANING,
    ELEMENT_PLAIN: ELEMENT_PLAIN, WEAPON_PLAIN: WEAPON_PLAIN, NATION_PLAIN: NATION_PLAIN,
    validateAnswers: validateAnswers, keyOf: keyOf, displayNation: displayNation, describeType: describeType,
    autoResult: autoResult, manualResult: manualResult, setManualCombiner: setManualCombiner, isManualSelectionReady: isManualSelectionReady,
  };
  root.ETIMini = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
