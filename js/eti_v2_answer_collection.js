// eti_v2_answer_collection.js
// ETI v2（新100問）の回答収集レイヤー。表示・ページング等のUIには一切触れない。
// 「item_idキーの回答オブジェクトを正しく組み立て、完了時に検証・エンコードする」
// ことだけに責務を絞った、最小の変更単位。
//
// 既存index.htmlの命名パターン（selectAnswer(qIdx, v) が answers[qIdx] を更新し、
// 同じ選択肢を再タップすると解除する、という挙動）を踏襲しつつ、キーを
// 配列位置（qIdx）ではなく item_id（"Q001"等）にしている。
//
// 依存：ETI_v2_QUESTIONS_100.js・eti_v2_engine.js を、このファイルより先に
// <script src="..."> で読み込むこと（既存のQUESTIONS/answersとは完全に別の
// 名前空間で動くため、v1のrenderQuiz/selectAnswer/answersには一切干渉しない）。

// v2回答の保存先。キーは item_id（"Q001".."Q100"）、値は -2..2。
// 既存の answers（v1、配列位置キー）とは別のオブジェクトとして独立させる。
var answersV2 = {};

// 既存の selectAnswer(qIdx, v) と同じ「もう一度押したら解除」の挙動を、
// item_idキーで再現する。
function selectAnswerV2(itemId, v) {
  if (answersV2[itemId] === v) {
    delete answersV2[itemId];
    return { changed: true, action: 'deselected', itemId: itemId };
  }
  answersV2[itemId] = v;
  return { changed: true, action: 'selected', itemId: itemId, value: v };
}

function getAnsweredCountV2() {
  return Object.keys(answersV2).length;
}

// canonicalOrder（ETIv2.getCanonicalOrder(ETI_V2_QUESTIONS)）を渡すことで、
// 「まだ答えていない最初のitem_id」を返す。既存のgetFirstUnansweredIdx()と同じ考え方。
function getFirstUnansweredItemIdV2(canonicalOrder) {
  for (var i = 0; i < canonicalOrder.length; i++) {
    if (answersV2[canonicalOrder[i]] === undefined) return canonicalOrder[i];
  }
  return null; // 全問回答済み
}

function isCompleteV2(canonicalOrder) {
  return getFirstUnansweredItemIdV2(canonicalOrder) === null;
}

// 完了時に呼ぶ。検証→エンコードまで一括で行い、結果を返す。
// UI側は、ok:falseの場合にvalidationErrorsを見て「未回答が残っています」等を表示できる。
function finalizeAnswersV2() {
  var validation = ETIv2.validateAnswersV2(answersV2, ETI_V2_QUESTIONS);
  if (!validation.valid) {
    return { ok: false, validationErrors: validation.errors };
  }
  var code = ETIv2.encodeAnswersV2(answersV2, ETI_V2_QUESTIONS);
  return { ok: true, code: code, answers: answersV2 };
}

// テスト・デバッグ用に、途中状態をリセットする（実運用では診断やり直し時に使う想定）。
function resetAnswersV2() {
  answersV2 = {};
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    selectAnswerV2: selectAnswerV2,
    getAnsweredCountV2: getAnsweredCountV2,
    getFirstUnansweredItemIdV2: getFirstUnansweredItemIdV2,
    isCompleteV2: isCompleteV2,
    finalizeAnswersV2: finalizeAnswersV2,
    resetAnswersV2: resetAnswersV2,
    // テストから answersV2 の中身を覗けるようにする
    _getAnswersV2: function () { return answersV2; },
  };
}
