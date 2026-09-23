// eti_v2_quiz_ui.js
// ETI v2（新100問）の画面表示・ページング。
// legacy-v1の renderQuiz / selectAnswer / answers / currentIdx / quizFocusIdx には
// 一切触れない。すべて別名の新規変数・新規関数として追加する。
//
// 依存（このファイルより先に読み込むこと）：
//   ETI_v2_QUESTIONS_100.js（ETI_V2_QUESTIONS, ETI_V2_META）
//   eti_v2_engine.js（ETIv2）
//   eti_v2_answer_collection.js（answersV2, selectAnswerV2, getAnsweredCountV2,
//     getFirstUnansweredItemIdV2, isCompleteV2, finalizeAnswersV2, resetAnswersV2）
//
// 採点キーの原則：表示順・ページ位置（pageStart, canonicalIdx等）は
// 「今どの画面を出すか」の制御にのみ使い、selectAnswerV2()には必ずq.id（item_id）を渡す。
// ページを戻って回答を変えても、キーはitem_idのまま変わらないため、正しく上書きされる。

// ---- v2専用の回答ラベル（設計書§2.1/§2.2そのまま） ----
var SCALE_SELF_V2 = [
  { v: -2, label: '全くあてはまらない' },
  { v: -1, label: 'あまりあてはまらない' },
  { v: 0,  label: 'どちらともいえない' },
  { v: +1, label: 'ややあてはまる' },
  { v: +2, label: 'とてもあてはまる' },
];
var SCALE_PORTRAIT_V2 = [
  { v: -2, label: '全く自分に近くない' },
  { v: -1, label: 'あまり自分に近くない' },
  { v: 0,  label: 'どちらともいえない' },
  { v: +1, label: 'やや自分に近い' },
  { v: +2, label: 'とても自分に近い' },
];
function scaleForItemV2(item) {
  return item.responseMode === 'portrait' ? SCALE_PORTRAIT_V2 : SCALE_SELF_V2;
}

// ---- v2専用のページング状態（legacy-v1のcurrentIdx/quizFocusIdxとは別変数） ----
var PAGE_SIZE_V2 = 5;
var currentPageV2 = 0;      // ページ番号（0始まり。legacy-v1のcurrentIdxのような「絶対index」ではなく
                             // 「canonical order配列における何ページ目か」で持つ＝表示順であって採点キーではない）
var quizFocusItemIdV2 = null; // フォーカス中のitem_id（採点キーそのものを使うので安全）

function getCanonicalOrderedItemsV2() {
  var order = ETIv2.getCanonicalOrder(ETI_V2_QUESTIONS);
  var byId = {};
  ETI_V2_QUESTIONS.forEach(function (q) { byId[q.id] = q; });
  return order.map(function (id) { return byId[id]; });
}

function renderQuizV2(root) {
  var items = getCanonicalOrderedItemsV2();
  var totalPages = Math.ceil(items.length / PAGE_SIZE_V2);
  var pageStart = currentPageV2 * PAGE_SIZE_V2;
  var pageItems = items.slice(pageStart, pageStart + PAGE_SIZE_V2);
  var answeredCount = getAnsweredCountV2();
  var pct = Math.round((answeredCount / items.length) * 100);
  var allAnswered = isCompleteV2(items.map(function (q) { return q.id; }));
  var firstUnansweredId = getFirstUnansweredItemIdV2(items.map(function (q) { return q.id; }));
  var isLastPage = pageStart + PAGE_SIZE_V2 >= items.length;

  // フォーカスがこのページの範囲外なら、ページ内最初の未回答（無ければ先頭）に合わせる
  var pageIds = pageItems.map(function (q) { return q.id; });
  if (quizFocusItemIdV2 === null || pageIds.indexOf(quizFocusItemIdV2) === -1) {
    var firstUnansweredInPage = null;
    for (var k = 0; k < pageItems.length; k++) {
      if (answersV2[pageItems[k].id] === undefined) { firstUnansweredInPage = pageItems[k].id; break; }
    }
    quizFocusItemIdV2 = firstUnansweredInPage !== null ? firstUnansweredInPage : pageIds[0];
  }

  root.innerHTML = '' +
    '<section style="margin-top:32px" data-eti-version="ETI-2.0">' +
      '<div style="margin-bottom:24px">' +
        '<div style="display:flex;justify-content:space-between;margin-bottom:8px">' +
          '<span style="color:#6a90b0;font-size:12px">Q' + (pageStart + 1) + '〜' + Math.min(pageStart + PAGE_SIZE_V2, items.length) + ' / ' + items.length + '</span>' +
          '<span style="color:#6a95b8;font-size:12px">回答済 ' + answeredCount + '</span>' +
        '</div>' +
        '<div style="background:#16121f;height:4px;border-radius:2px;overflow:hidden">' +
          '<div style="background:linear-gradient(90deg,#1a3a5a,#7ab8e8);width:' + pct + '%;height:100%;border-radius:2px"></div>' +
        '</div>' +
      '</div>' +
      pageItems.map(function (q, i) {
        var cur = answersV2[q.id];
        var isFocused = q.id === quizFocusItemIdV2;
        var scale = scaleForItemV2(q);
        return '' +
        '<div class="q-card-v2" data-item-id="' + q.id + '" style="background:#0a1420;border:1px solid ' + (isFocused ? '#1a3a5a' : '#182838') + ';border-radius:12px;padding:20px;margin-bottom:12px;opacity:' + (isFocused ? '1' : '0.4') + ';cursor:pointer">' +
          '<div style="color:' + (isFocused ? '#90c0e0' : '#3a3050') + ';font-size:9px;letter-spacing:1.5px;margin-bottom:10px">Q' + (pageStart + i + 1) + '</div>' +
          '<p style="color:' + (isFocused ? '#e0d4f8' : '#6a90a8') + ';font-size:14.5px;line-height:1.6;margin:0 0 16px;font-weight:500">' + q.text + '</p>' +
          '<div class="scale-dots-v2" data-item-id="' + q.id + '" style="display:flex;justify-content:space-between;align-items:center;padding:0 4px">' +
            scale.map(function (s) {
              return '<button data-v="' + s.v + '" aria-label="' + s.label + '" style="width:30px;height:30px;border-radius:50%;background:' + (cur === s.v ? '#7ab8e8' : 'transparent') + ';border:2px solid ' + (cur === s.v ? '#7ab8e8' : '#2a4058') + ';cursor:pointer;padding:0"></button>';
            }).join('') +
          '</div>' +
          '<div style="display:flex;justify-content:space-between;margin-top:8px">' +
            '<span style="font-size:9.5px;color:#6a95b8">' + scale[0].label + '</span>' +
            '<span style="font-size:9.5px;color:#6a95b8">' + scale[scale.length - 1].label + '</span>' +
          '</div>' +
        '</div>';
      }).join('') +
      '<div style="display:flex;justify-content:space-between;margin-top:8px;gap:8px">' +
        '<button id="prev-btn-v2" ' + (currentPageV2 === 0 ? 'disabled' : '') + ' style="background:transparent;border:1px solid #1e3448;color:' + (currentPageV2 === 0 ? '#2a2440' : '#6a90b0') + ';border-radius:6px;padding:8px 18px;font-size:12px;cursor:pointer">← 前の' + PAGE_SIZE_V2 + '問</button>' +
        (!isLastPage ? '<button id="next-btn-v2" style="background:transparent;border:1px solid #1e3448;color:#6a90b0;border-radius:6px;padding:8px 18px;font-size:12px;cursor:pointer">次の' + PAGE_SIZE_V2 + '問 →</button>' : '<span></span>') +
      '</div>' +
      (allAnswered ? '<button id="result-btn-v2" style="width:100%;margin-top:10px;background:linear-gradient(90deg,#1a3a5a,#2a6a9a);border:none;color:#e0f4ff;border-radius:6px;padding:11px;font-size:12.5px;font-weight:600;cursor:pointer">結果を見る →</button>' : '') +
      (!allAnswered && firstUnansweredId && isLastPage ? '<button id="jump-unanswered-btn-v2" style="width:100%;margin-top:8px;background:transparent;border:1px dashed #2a4a68;color:#6a90b0;border-radius:6px;padding:9px;font-size:11.5px;cursor:pointer">未回答の設問へ →</button>' : '') +
    '</section>';

  // カードクリックでフォーカス移動
  Array.prototype.forEach.call(root.querySelectorAll('.q-card-v2'), function (card) {
    card.addEventListener('click', function () {
      var itemId = card.getAttribute('data-item-id');
      if (itemId !== quizFocusItemIdV2) {
        quizFocusItemIdV2 = itemId;
        renderQuizV2(document.getElementById('diagnosis-root'));
      }
    });
  });

  // 丸ボタンで回答（採点キーは常にitem_id）
  Array.prototype.forEach.call(root.querySelectorAll('.scale-dots-v2'), function (div) {
    var itemId = div.getAttribute('data-item-id');
    Array.prototype.forEach.call(div.querySelectorAll('button'), function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        selectAnswerV2(itemId, Number(btn.getAttribute('data-v')));
        // 元々フォーカスしていた設問に回答した場合、ページ内の次の未回答へ光を進める
        var pageItemIds = pageItems.map(function (q) { return q.id; });
        var wasFocused = itemId === quizFocusItemIdV2;
        if (wasFocused && answersV2[itemId] !== undefined) {
          var startIdx = pageItemIds.indexOf(itemId) + 1;
          var nextUnfocused = null;
          for (var k = startIdx; k < pageItemIds.length; k++) {
            if (answersV2[pageItemIds[k]] === undefined) { nextUnfocused = pageItemIds[k]; break; }
          }
          quizFocusItemIdV2 = nextUnfocused !== null ? nextUnfocused : itemId;
        } else {
          quizFocusItemIdV2 = itemId;
        }
        renderQuizV2(document.getElementById('diagnosis-root'));
      });
    });
  });

  var prevBtn = root.querySelector('#prev-btn-v2');
  if (prevBtn) prevBtn.addEventListener('click', function () { prevQV2(); });
  var nextBtn = root.querySelector('#next-btn-v2');
  if (nextBtn) nextBtn.addEventListener('click', function () { nextQV2(); });
  var resultBtn = root.querySelector('#result-btn-v2');
  if (resultBtn) resultBtn.addEventListener('click', function () { showResultV2(); });
  var jumpBtn = root.querySelector('#jump-unanswered-btn-v2');
  if (jumpBtn) jumpBtn.addEventListener('click', function () {
    var allIds = items.map(function (q) { return q.id; });
    var target = getFirstUnansweredItemIdV2(allIds);
    if (target) {
      currentPageV2 = Math.floor(allIds.indexOf(target) / PAGE_SIZE_V2);
      quizFocusItemIdV2 = target;
      renderQuizV2(document.getElementById('diagnosis-root'));
    }
  });
}

function nextQV2() {
  var items = getCanonicalOrderedItemsV2();
  var totalPages = Math.ceil(items.length / PAGE_SIZE_V2);
  if (currentPageV2 + 1 < totalPages) {
    currentPageV2 += 1;
    quizFocusItemIdV2 = null;
    renderQuizV2(document.getElementById('diagnosis-root'));
  }
}
function prevQV2() {
  if (currentPageV2 > 0) {
    currentPageV2 -= 1;
    quizFocusItemIdV2 = null;
    renderQuizV2(document.getElementById('diagnosis-root'));
  }
}

// 「結果を見る」の唯一の入口。件数の即席チェックではなく、必ずfinalizeAnswersV2()
// （＝validateAnswersV2 → encodeAnswersV2）を通す。
// 【重要】ここでは保存を一切行わない。結果を見ることと保存することを明確に分離する：
//   ・ログイン開始（signInWithGoogle）
//   ・pendingDiagnosis_v2の作成
//   ・save_diagnosis_session_v2の呼び出し
//   ・マイページへの保存
// のいずれも、利用者が明示的に「無料で結果を保存」ボタンを押すまで発生しない。
function showResultV2() {
  var result = finalizeAnswersV2();
  if (!result.ok) {
    console.error('ETIv2: finalize failed', result.validationErrors);
    return;
  }
  if (typeof gtag === 'function') {
    gtag('event', 'quiz_complete', { event_category: 'diagnosis', diagnosis_version: 'ETI-2.0', value: getAnsweredCountV2() });
  }

  // プロトタイプ（eti_v2_prototypes.js）を使って元素・武器・国家・MIRRORまで計算する。
  // ここまでは全て純粋な計算であり、保存・通信は一切発生しない。
  var computeOpts = {};
  if (typeof ELEMENT_PROTOTYPES_V2 !== 'undefined') computeOpts.elementPrototypes = ELEMENT_PROTOTYPES_V2;
  if (typeof WEAPON_PROTOTYPES_V2 !== 'undefined') computeOpts.weaponPrototypes = WEAPON_PROTOTYPES_V2;
  if (typeof NATION_PROTOTYPES_V2 !== 'undefined') computeOpts.nationPrototypes = NATION_PROTOTYPES_V2;
  var results = ETIv2.computeResultsV2(answersV2, computeOpts);

  var mirrorTop = [];
  if (typeof ETI_V2_CHARACTERS !== 'undefined') {
    mirrorTop = ETIv2.computeMirrorV2(results, ETI_V2_CHARACTERS).slice(0, 4);
  }

  // 保存ボタンが押されたときに使う状態として保持するだけ。この時点では
  // localStorage・Supabase・Google認証のいずれにも一切触れない。
  window.__v2PendingResult = {
    answersV2: JSON.parse(JSON.stringify(answersV2)), // 回答内容のスナップショット
    code: result.code,
    results: results,
    mirrorTop: mirrorTop,
  };
  window.__v2Saved = false;

  window.__phase = 'result_v2';
  if (typeof render === 'function') render();
}

// 「無料で結果を保存」ボタンが押されたときだけ呼ばれる、唯一の保存入口。
async function handleSaveButtonClickV2() {
  var state = window.__v2PendingResult;
  if (!state) return;
  var clientSessionId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random();
  updateSaveButtonUIV2('saving');
  var saveResult = await handleSaveResultClickV2(state.answersV2, state.code, state.results, state.mirrorTop, clientSessionId);
  if (saveResult && saveResult.ok) {
    window.__v2Saved = true;
    if (typeof render === 'function') render(); // マイページ導線を出すため再描画する
  }
  return saveResult;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    renderQuizV2: renderQuizV2,
    nextQV2: nextQV2,
    prevQV2: prevQV2,
    showResultV2: showResultV2,
    getCanonicalOrderedItemsV2: getCanonicalOrderedItemsV2,
    _state: function () {
      return { currentPageV2: currentPageV2, quizFocusItemIdV2: quizFocusItemIdV2 };
    },
    _resetPagingState: function () { currentPageV2 = 0; quizFocusItemIdV2 = null; },
  };
}
