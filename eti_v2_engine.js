// eti_v2_engine.js
// ETI v2.0（新100問）の採点エンジン。既存のlegacy-v1エンジンとは完全に独立しており、
// legacy-v1の関数・データ（QUESTIONS, computeResults, ELEMENT_PROFILE等）には一切触れない。
//
// 依存：ETI_v2_QUESTIONS_100.js（ETI_V2_QUESTIONS, ETI_V2_META）を、この
// ファイルより先に <script src="..."> で読み込むこと。
// diagnosis-save.js が index.html の supabaseClient を参照しているのと同じ考え方で、
// 同一ドキュメント内のclassic scriptどうしはトップレベルのトップレベル字句スコープを
// 共有するため、window.ETI_V2_QUESTIONS のような書き方はせず、そのままの変数名で参照する。

// ------------------------------------------------------------
// 0. Canonical item order（ETI-ITEM-2.0.0固定）
//    表示順・配列位置に依存せず、item_idの昇順で固定する。
//    この順序自体がitem_set_versionの一部として凍結される。
// ------------------------------------------------------------
function getCanonicalOrder(questions) {
  return questions.map(q => q.id).sort(); // "Q001".."Q100" は文字列昇順=数値昇順で一致
}

// ------------------------------------------------------------
// 0-B. 回答データの検証（修正①）
//    計算前に必ず呼ぶ。欠損・型不正・余計なitem_idがあれば計算を拒否する。
//    未回答を黙って0（どちらでもない）扱いにしない。
// ------------------------------------------------------------
function validateAnswersV2(answersByItemId, questions) {
  questions = questions || ETI_V2_QUESTIONS;
  const expectedIds = questions.map(q => q.id);
  const expectedSet = new Set(expectedIds);
  const providedIds = Object.keys(answersByItemId || {});

  const errors = [];

  const missing = expectedIds.filter(id => !(id in (answersByItemId || {})));
  if (missing.length > 0) {
    errors.push({ type: 'missing_items', items: missing });
  }

  const unexpected = providedIds.filter(id => !expectedSet.has(id));
  if (unexpected.length > 0) {
    errors.push({ type: 'unexpected_items', items: unexpected });
  }

  const invalidValues = providedIds
    .filter(id => expectedSet.has(id))
    .filter(id => {
      const v = answersByItemId[id];
      return !Number.isInteger(v) || v < -2 || v > 2;
    });
  if (invalidValues.length > 0) {
    errors.push({ type: 'invalid_values', items: invalidValues });
  }

  return { valid: errors.length === 0, errors };
}


function encodeAnswersV2(answersByItemId, questions) {
  questions = questions || ETI_V2_QUESTIONS;
  // encodeAnswersV2()単体で呼ばれた場合でも、欠損回答を黙って0として
  // 符号化しないよう、ここでも検証する（computeResultsV2()と同じ基準）。
  const validation = validateAnswersV2(answersByItemId, questions);
  if (!validation.valid) {
    const err = new Error('ETIv2: invalid or incomplete answers, encode refused');
    err.validationErrors = validation.errors;
    throw err;
  }
  const order = getCanonicalOrder(questions);
  const digits = '0123456789abcdefghijklmnopqrstuvwxyz';
  let n = 0n;
  for (const itemId of order) {
    const a = answersByItemId[itemId] + 2; // -2..2 -> 0..4（検証済みのため ?? 0 は使わない）
    n = n * 5n + BigInt(a);
  }
  if (n === 0n) return '0';
  let s = '';
  while (n > 0n) {
    const rem = Number(n % 36n);
    s = digits[rem] + s;
    n = n / 36n;
  }
  return s;
}

function decodeAnswersV2(str, questions) {
  questions = questions || ETI_V2_QUESTIONS;
  const order = getCanonicalOrder(questions);
  const digits = '0123456789abcdefghijklmnopqrstuvwxyz';
  let n = 0n;
  for (const c of str) {
    const idx = digits.indexOf(c);
    if (idx < 0) return null;
    n = n * 36n + BigInt(idx);
  }
  const result = {};
  for (let i = order.length - 1; i >= 0; i--) {
    result[order[i]] = Number(n % 5n) - 2;
    n = n / 5n;
  }
  return result;
}

// ------------------------------------------------------------
// 2. PERSONALITY / STYLE 採点（設計書§5.1）
//    display = ((mean + 2) / 4) * 100
//    逆転項目（direction:-1）は -answer として方向を揃える
// ------------------------------------------------------------
function scoreSelfDomain(answersByItemId, questions, domain, axes) {
  const items = questions.filter(q => q.domain === domain);
  const byAxis = {};
  axes.forEach(ax => { byAxis[ax] = []; });
  items.forEach(q => {
    // validateAnswersV2 を通過済みが前提のため、ここでは ?? 0 のような
    // 欠損の握り消しは行わない（欠損があれば呼び出し前に例外で止まっている）。
    const raw = answersByItemId[q.id];
    const signed = q.direction === -1 ? -raw : raw;
    byAxis[q.axis].push(signed);
  });
  const result = {};
  axes.forEach(ax => {
    const vals = byAxis[ax];
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    result[ax] = {
      mean: mean,
      display: Math.round(((mean + 2) / 4) * 100),
      itemCount: vals.length,
    };
  });
  return result;
}

// ------------------------------------------------------------
// 3. VALUES 採点（設計書§5.2）
//    10価値それぞれ3項目平均 -> 30項目の総平均を引いてcenter
// ------------------------------------------------------------
function scoreValues(answersByItemId, questions, valueAxes) {
  const items = questions.filter(q => q.domain === 'VALUES');
  const byAxis = {};
  valueAxes.forEach(ax => { byAxis[ax] = []; });
  items.forEach(q => {
    // validateAnswersV2 を通過済みが前提のため、ここでも欠損の握り消しはしない。
    const raw = answersByItemId[q.id];
    const signed = q.direction === -1 ? -raw : raw; // VALUESは全問+想定だが念のため対応
    byAxis[q.axis].push(signed);
  });
  const meanByAxis = {};
  valueAxes.forEach(ax => {
    const vals = byAxis[ax];
    meanByAxis[ax] = vals.reduce((a, b) => a + b, 0) / vals.length;
  });
  const allMean = valueAxes.reduce((sum, ax) => sum + meanByAxis[ax], 0) / valueAxes.length;

  const result = {};
  valueAxes.forEach(ax => {
    result[ax] = {
      mean: meanByAxis[ax],
      centered: meanByAxis[ax] - allMean,
      display: Math.round(((meanByAxis[ax] + 2) / 4) * 100), // 参考表示用（設計書は主に順位・centeredを使う方針）
      itemCount: byAxis[ax].length,
    };
  });
  return { byAxis: result, allMean };
}

// ------------------------------------------------------------
// 4. プロトタイプ距離（設計書§6.4）
//    distance = sqrt(mean((user - prototype)^2))　※各軸0-1へ変換後
//    要素・武器（PERSONALITY/STYLE）は絶対値のまま比較する。
//    国家（VALUES）はcenter済みベクトルの類似度で比較する（修正③、下記参照）。
// ------------------------------------------------------------
function prototypeDistance(userDisplayByAxis, prototype, axesOrder) {
  const diffsSq = axesOrder.map(ax => {
    const u = userDisplayByAxis[ax] / 100;
    const p = prototype[ax] / 100;
    return (u - p) * (u - p);
  });
  const meanSq = diffsSq.reduce((a, b) => a + b, 0) / diffsSq.length;
  return Math.sqrt(meanSq);
}

// closenessScore・gapを付与する共通の後処理（修正④）。
// 「一致率」ではなく「近さスコア」という名称で扱う（統計的確率ではないため）。
// 0〜100へclampする：centered VALUES比較（コサイン由来のdistance）は、
// 通常の0〜1正規化ユークリッド距離とは性質が異なるため、将来プロトタイプ値や
// 距離式を変更した際に理論範囲外の値が出ないよう、防御的にclampしておく。
function attachClosenessAndGap(rows) {
  rows.forEach(row => {
    row.closenessScore = Math.max(0, Math.min(100, Math.round((1 - row.distance) * 100)));
  });
  const gap = rows.length >= 2
    ? rows[1].closenessScore != null
      ? rows[0].closenessScore - rows[1].closenessScore
      : null
    : null;
  return { ranking: rows, topGap: gap };
}

function rankByDistance(protoTable, userDisplayByAxis, axesOrder) {
  const rows = Object.entries(protoTable).map(([name, proto]) => ({
    name,
    distance: prototypeDistance(userDisplayByAxis, proto, axesOrder),
  }));
  rows.sort((a, b) => a.distance - b.distance); // 距離が小さい=近い が1位
  return attachClosenessAndGap(rows);
}

// 修正③：国家（VALUES）判定は、ユーザー・国家プロトタイプの双方をcenterしてから
// コサイン類似度で比較する。VALUESは「個人内で何を相対的に重視するか」を中心にする
// 設計（設計書§5.2）のため、絶対値のまま国家プロトタイプと比較すると、
// 例えば「10価値すべて+2」（＝優先順位が何も出ていない人）が、絶対値の近さだけで
// どこかの国家へ無理に寄せられてしまう。MIRRORのVALUES類似度（vSim）と同じ考え方に揃える。
function rankNationsByCenteredValues(nationPrototypes, userValuesDisplay, valueAxes) {
  const userCentered = centerVector(userValuesDisplay, valueAxes);
  const userIsZero = userCentered.every(v => v === 0);

  const rows = Object.entries(nationPrototypes).map(([name, proto]) => {
    const protoCentered = centerVector(proto, valueAxes);
    const cos = cosineSim(userCentered, protoCentered);
    // If the user's centered VALUES vector is flat (all 10 axes equal after
    // centering, i.e. no relative value preference is observable in this
    // person's answers), no nation can genuinely be "closer" than another —
    // there is nothing directional to compare. Rather than let an arbitrary
    // tie-break or a spurious cosine result force a match, we explicitly
    // return equal similarity (0) for every nation in this case. This is a
    // deliberate design choice (verified in eti_v2_engine_test.js /
    // report E2E test E2), not an incidental side effect of the cosine math.
    const similarity = userIsZero ? 0 : (cos === null ? 0 : cos);
    // 類似度(-1..1)を、他のプロトタイプ距離と同じ「小さいほど近い」distanceに変換する。
    const distance = (1 - similarity) / 2; // similarity=1→distance=0、similarity=-1→distance=1
    return { name, distance, cosineSimilarity: similarity };
  });
  rows.sort((a, b) => a.distance - b.distance);
  return attachClosenessAndGap(rows);
}

// ------------------------------------------------------------
// 5. computeResultsV2 本体
// ------------------------------------------------------------
function computeResultsV2(answersByItemId, opts) {
  opts = opts || {};
  const questions = opts.questions || ETI_V2_QUESTIONS;
  const meta = opts.meta || ETI_V2_META;
  const personalityAxes = meta.personalityAxes; // O,C,E,A,N
  const styleAxes = meta.styleAxes;              // AGY,REL,ROL,REF,AUT
  const valueAxes = meta.valueAxes;               // SD,ST,HE,AC,PO,SE,CO,TR,BE,UN

  // 修正①：計算前に必ずvalidateする。欠損・型不正・余計なitem_idがあれば
  // 黙って0扱いにせず、明示的に例外を投げて計算を拒否する。
  const validation = validateAnswersV2(answersByItemId, questions);
  if (!validation.valid) {
    const err = new Error('ETIv2: invalid or incomplete answers, computation refused');
    err.validationErrors = validation.errors;
    throw err;
  }

  const personality = scoreSelfDomain(answersByItemId, questions, 'PERSONALITY', personalityAxes);
  const style = scoreSelfDomain(answersByItemId, questions, 'STYLE', styleAxes);
  const values = scoreValues(answersByItemId, questions, valueAxes);

  const personalityDisplay = {};
  personalityAxes.forEach(ax => { personalityDisplay[ax] = personality[ax].display; });
  const styleDisplay = {};
  styleAxes.forEach(ax => { styleDisplay[ax] = style[ax].display; });
  const valuesDisplay = {};
  valueAxes.forEach(ax => { valuesDisplay[ax] = values.byAxis[ax].display; });

  // 元素・武器：プロトタイプ表との絶対値の標準化距離（較正なし。設計書§0-1決定通り）
  const elementResult = opts.elementPrototypes
    ? rankByDistance(opts.elementPrototypes, personalityDisplay, personalityAxes) : null;
  const weaponResult = opts.weaponPrototypes
    ? rankByDistance(opts.weaponPrototypes, styleDisplay, styleAxes) : null;
  // 国家：修正③により、ユーザー・プロトタイプ双方をcenterしたコサイン類似度で判定する
  const nationResult = opts.nationPrototypes
    ? rankNationsByCenteredValues(opts.nationPrototypes, valuesDisplay, valueAxes) : null;

  return {
    personality: personalityDisplay,
    style: styleDisplay,
    values: valuesDisplay,
    valuesCentered: Object.fromEntries(valueAxes.map(ax => [ax, values.byAxis[ax].centered])),
    // ranking: 近さスコア順（1位が最も近い）。topGap: 1位と2位の近さスコアの差。
    elementRanking: elementResult && elementResult.ranking,
    elementTopGap: elementResult && elementResult.topGap,
    weaponRanking: weaponResult && weaponResult.ranking,
    weaponTopGap: weaponResult && weaponResult.topGap,
    nationRanking: nationResult && nationResult.ranking,
    nationTopGap: nationResult && nationResult.topGap,
    meta: {
      diagnosisVersion: meta.diagnosisVersion,
      itemSetVersion: meta.itemSetVersion,
      scoringVersion: meta.scoringVersion,
    },
  };
}

// ------------------------------------------------------------
// 6. MIRROR v2（前回確定した式）
//    pSim = 1 - sqrt(mean(((userP-charP)/100)^2))
//    sSim = 1 - sqrt(mean(((userS-charS)/100)^2))
//    vSim = (cos(centered)+1)/2、zero-vectorなら0.5
//    mirrorScore = round((0.40*pSim + 0.30*sSim + 0.30*vSim)*100)
// ------------------------------------------------------------
function rmseSim(userAxes, charAxes, axesOrder) {
  const sq = axesOrder.map(ax => {
    const d = (userAxes[ax] - charAxes[ax]) / 100;
    return d * d;
  });
  const meanSq = sq.reduce((a, b) => a + b, 0) / sq.length;
  return 1 - Math.sqrt(meanSq);
}

function centerVector(valuesObj, axesOrder) {
  const vals = axesOrder.map(ax => valuesObj[ax]);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return vals.map(v => v - mean);
}

function cosineSim(a, b) {
  const dot = a.reduce((sum, v, i) => sum + v * b[i], 0);
  const na = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
  const nb = Math.sqrt(b.reduce((s, v) => s + v * v, 0));
  if (na === 0 || nb === 0) return null; // zero-vector
  return dot / (na * nb);
}

function computeMirrorV2(userResults, characters, meta) {
  meta = meta || ETI_V2_META;
  const personalityAxes = meta.personalityAxes;
  const styleAxes = meta.styleAxes;
  const valueAxes = meta.valueAxes;

  const userValuesCentered = centerVector(userResults.values, valueAxes);

  const scored = characters.map(ch => {
    const pSim = rmseSim(userResults.personality, ch.personality, personalityAxes);
    const sSim = rmseSim(userResults.style, ch.style, styleAxes);

    const charValuesCentered = centerVector(ch.values, valueAxes);
    const cos = cosineSim(userValuesCentered, charValuesCentered);
    const vSim = cos === null ? 0.5 : (cos + 1) / 2;

    const mirrorScore = Math.round((0.40 * pSim + 0.30 * sSim + 0.30 * vSim) * 100);

    return {
      name: ch.name,
      mirrorScore,
      pSim, sSim, vSim,
      element: ch.element, weapon: ch.weapon, region: ch.region,
    };
  });

  scored.sort((a, b) => b.mirrorScore - a.mirrorScore);
  return scored;
}

// ------------------------------------------------------------
// エクスポート
// ------------------------------------------------------------
// index.html等では、diagnosis-save.jsの関数群と同じ考え方で、
// これらの関数名をそのままグローバル（トップレベル字句スコープ）から呼び出せる。
var ETIv2 = {
getCanonicalOrder: getCanonicalOrder,
validateAnswersV2: validateAnswersV2,
encodeAnswersV2: encodeAnswersV2,
decodeAnswersV2: decodeAnswersV2,
computeResultsV2: computeResultsV2,
computeMirrorV2: computeMirrorV2,
// ランキング関数そのものの単体テスト用に公開する（元素/武器はrankByDistance、
// 国家はrankNationsByCenteredValuesを直接、任意のベクトルで呼べる）。
rankByDistance: rankByDistance,
rankNationsByCenteredValues: rankNationsByCenteredValues,
prototypeDistance: prototypeDistance,
};

// Node.js（テスト・サーバー側での再利用）向け。ブラウザでは無視される。
if (typeof module !== 'undefined' && module.exports) {
module.exports = ETIv2;
}
