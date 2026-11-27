// 理想像の質問の並びと、追加質問（最大6問）の判定。
// 追加質問は「主要な項目が未確定」または「回答に矛盾がある」ときだけ出す。理由（reason）は画面とレビュー資料に出す。
import { TRAITS, VALUES, CAPABILITIES, ASPIRATIONS, OPPOSING_TRAITS, INVERSION_RISKS, UNKNOWN } from './catalog.js';
import { IDEAL_QUESTIONS, MAX_FOLLOWUPS } from './questions.js';

const isUnknown = (sel) => !sel || sel.length === 0 || sel.includes(UNKNOWN);

function optionsOf(qid) { return IDEAL_QUESTIONS.find((q) => q.id === qid).options; }
function pick(qid, answers, key) {
  const sel = answers[qid] || [];
  const out = [];
  for (const oid of sel) {
    const o = optionsOf(qid).find((x) => x.id === oid);
    if (o && o[key]) out.push(...o[key]);
  }
  return out;
}

// 現在像に合わせて、K1（特性）・K3（価値観）の選択肢の並びを決める（観測済みを先頭に。選択肢の集合は変えない）
export function idealQuestionsFor(current) {
  const obsT = new Set(current.traits.map((t) => t.trait));
  const obsV = new Set(current.values.map((v) => v.value));
  return IDEAL_QUESTIONS.map((q) => {
    if (!q.dynamicOptions) return q;
    const mark = q.dynamicOptions === 'traits' ? obsT : obsV;
    const known = q.options.filter((o) => o.id !== UNKNOWN);
    const ordered = [...known.filter((o) => mark.has(o.id)), ...known.filter((o) => !mark.has(o.id))]
      .map((o) => (mark.has(o.id) ? { ...o, badge: current.source === 'eti_v2' ? 'ETIの傾向' : '自己申告' } : o));
    return { ...q, options: [...ordered, ...q.options.filter((o) => o.id === UNKNOWN)] };
  });
}

// 基本12問の回答から、保護特性の本人選択をまとめる
export function keptTraitsFromBase(answers) {
  const set = new Set([...pick('K1', answers, 'traits'), ...pick('K2', answers, 'traits'), ...pick('K4', answers, 'traits')]);
  return [...set];
}

function inversionQuestion(target, t, stage) {
  const tlabel = TRAITS[t].label;
  const glabel = (CAPABILITIES[target] || ASPIRATIONS[target]).label;
  return {
    id: `F_INV_${target}_${t}`, purpose: 'FOLLOWUP', kind: 'inversion', target, trait: t, stage,
    text: `「${tlabel}」を残したいと選び、「${glabel}」も望んでいます。近いのはどちらですか`,
    reason: `保護特性「${tlabel}」と「${glabel}」が逆向きに解釈されるおそれがあるため。本人の確認なしに性格を反転させない`,
    options: [
      { id: 'augment', label: `「${TRAITS[t].short}」は保ったまま、必要な場面で「${glabel}」を使えるようにしたい` },
      { id: 'release', label: `「${TRAITS[t].short}」は手放してもよい。大きく変わりたい` },
      { id: UNKNOWN, label: 'まだ決められない' },
    ],
  };
}

/**
 * 最終的に下書きに採用する成長目標（能力）を決める。profile.js と同じ規則を使う。
 *   G1・G2 が別の能力 → F_GROW_PRIORITY の回答で決まる（未回答なら pending）。「両方」「まだ決められない」は両方。
 *   G1・G2 のどちらかだけ・同じ → その能力。
 *   どちらも無し → F_GROW の回答で決まる（未回答なら pending）。
 * viaFollowup：追加質問の回答で確定したか（そうなら、その目標への確認は2段目で出す）
 */
export function resolveGrowthCaps(answers) {
  const g1 = pick('G1', answers, 'capabilities');
  const g2 = pick('G2', answers, 'capabilities');
  if (g1.length && g2.length && g1[0] !== g2[0]) {
    const a = (answers.F_GROW_PRIORITY || [])[0];
    if (!a) return { caps: [], pending: true, viaFollowup: true, decidedBy: 'F_GROW_PRIORITY' };
    const caps = a === g1[0] || a === g2[0] ? [a] : [g1[0], g2[0]];
    return { caps, pending: false, viaFollowup: true, decidedBy: 'F_GROW_PRIORITY' };
  }
  if (g1.length || g2.length) return { caps: [...new Set([...g1, ...g2])], pending: false, viaFollowup: false, decidedBy: null };
  const a = answers.F_GROW;
  if (!a) return { caps: [], pending: true, viaFollowup: true, decidedBy: 'F_GROW' };
  return { caps: a.filter((x) => x !== UNKNOWN && CAPABILITIES[x]), pending: false, viaFollowup: true, decidedBy: 'F_GROW' };
}

// 追加質問の候補を優先順に並べ、上限で切る。切られたものは overflow として返す（未確定として扱う）
// 1段目：基本12問の回答だけで決まるもの。2段目：追加質問の回答で確定した成長目標への、保護特性との確認。
export function computeFollowups(current, answers) {
  const cands = [];
  const stage2 = [];
  // F_TRANSFORM（性格を変えたい部分）は1段目の確認が無いときだけ出るので、ここで外しても循環しない
  const transformed = new Set((answers.F_TRANSFORM || []).filter((t) => TRAITS[t]));
  const kept = keptTraitsFromBase(answers).filter((t) => !transformed.has(t));

  const obs = current.traits.map((t) => t.trait);
  const g1 = pick('G1', answers, 'capabilities');
  const g2 = pick('G2', answers, 'capabilities');
  const asp = pick('E1', answers, 'aspirations');
  const transform = (answers.G4 || []).includes('transform');
  const growth = resolveGrowthCaps(answers);

  // 1. 保護特性と成長・憧れの緊張（単純な反転を防ぐ）。成長目標は「最終的に採用するもの」を対象にする
  const stage1Targets = [...(growth.viaFollowup ? [] : growth.caps), ...asp];
  const stage2Targets = growth.viaFollowup && !growth.pending ? growth.caps : [];
  for (const target of stage1Targets) for (const t of INVERSION_RISKS[target] || []) if (kept.includes(t)) cands.push(inversionQuestion(target, t, 1));
  // 1段目の確認で本人が「手放す」と答えた特性は、2段目で改めて確かめない（2段目の自分の回答は数えない。数えると質問が消えて回答も消える）
  const releasedStage1 = new Set(cands.filter((c) => (answers[c.id] || [])[0] === 'release').map((c) => c.trait));
  for (const target of stage2Targets) for (const t of INVERSION_RISKS[target] || []) if (kept.includes(t) && !releasedStage1.has(t)) stage2.push(inversionQuestion(target, t, 2));
  // 2. 現在像（観測・自己申告）と、残したい特性の食い違い
  for (const t of pick('K1', answers, 'traits')) {
    for (const [a, b] of OPPOSING_TRAITS) {
      const other = t === a ? b : t === b ? a : null;
      if (!other || !obs.includes(other)) continue;
      const src = current.source === 'eti_v2' ? 'ETIの結果' : '簡易質問の回答';
      cands.push({
        id: `F_OBS_${t}_${other}`, purpose: 'FOLLOWUP', kind: 'observed_mismatch', trait: t, observed: other,
        text: `${src}では「${TRAITS[other].label}」の傾向でしたが、残したいものに「${TRAITS[t].label}」を選びました。今の自分に近いのはどれですか`,
        reason: `現在像と本人の選択が逆向きのため。どちらかを勝手に正しいとせず、本人に確かめる`,
        options: [
          { id: 'observed', label: `ふだんは「${TRAITS[other].short}」のほうが近い` },
          { id: 'chosen', label: `本当は「${TRAITS[t].short}」のほうが近い` },
          { id: 'both', label: '場面によって両方ある' },
          { id: UNKNOWN, label: 'わからない' },
        ],
      });
    }
  }
  // 3. 伸ばしたい力（G1）と、足りない場面（G2）の食い違い
  if (g1.length && g2.length && g1[0] !== g2[0]) {
    cands.push({
      id: 'F_GROW_PRIORITY', purpose: 'FOLLOWUP', kind: 'growth_mismatch',
      text: 'どちらを先に伸ばしたいですか',
      reason: '「伸ばしたい力」と「足りないと感じる場面」が別の能力を指しているため',
      options: [
        { id: g1[0], label: CAPABILITIES[g1[0]].label, capabilities: [g1[0]] },
        { id: g2[0], label: CAPABILITIES[g2[0]].label, capabilities: [g2[0]] },
        { id: 'both', label: '両方を同じくらい', capabilities: [g1[0], g2[0]] },
        { id: UNKNOWN, label: 'まだ決められない' },
      ],
    });
  }
  // 4. 保護特性が未確定
  if (isUnknown(answers.K1) && kept.length === 0) {
    const ids = obs.length ? obs : Object.keys(TRAITS);
    cands.push({
      id: 'F_KEEP', purpose: 'FOLLOWUP', kind: 'keep_unclear',
      text: 'しいて一つ残すなら、どれが近いですか',
      reason: '残したい自分らしさ（保護特性）が一つも決まっていないため',
      options: [...[...new Set(ids)].map((t) => ({ id: t, label: TRAITS[t].label, traits: [t] })), { id: UNKNOWN, label: 'それでもわからない' }],
    });
  }
  // 5. 中心価値が未確定
  if (isUnknown(answers.K3)) {
    const ids = current.values.length ? current.values.map((v) => v.value) : Object.keys(VALUES);
    cands.push({
      id: 'F_VALUES', purpose: 'FOLLOWUP', kind: 'values_unclear',
      text: 'しいて一つ選ぶなら、判断の最後に残る価値観はどれですか',
      reason: '判断原則の土台になる価値観が決まっていないため',
      options: [...ids.map((v) => ({ id: v, label: VALUES[v].label, values: [v] })), { id: UNKNOWN, label: 'それでもわからない' }],
    });
  }
  // 6. 成長対象が未確定
  if (g1.length === 0 && g2.length === 0) {
    cands.push({
      id: 'F_GROW', purpose: 'FOLLOWUP', kind: 'growth_unclear',
      text: 'まず一つだけ伸ばすなら、どれが近いですか',
      reason: '伸ばしたい力が決まっていないため',
      options: [...Object.keys(CAPABILITIES).map((c) => ({ id: c, label: CAPABILITIES[c].label, capabilities: [c] })), { id: UNKNOWN, label: 'それでもわからない' }],
    });
  }
  // 7. 憧れが未確定
  if (asp.length === 0) {
    cands.push({
      id: 'F_ASPIRATION', purpose: 'FOLLOWUP', kind: 'aspiration_unclear',
      text: '身近な人や作品の中で「いいな」と感じる振る舞いに近いのは',
      reason: '憧れる魅力の方向性が決まっていないため',
      options: [...Object.keys(ASPIRATIONS).map((a) => ({ id: a, label: ASPIRATIONS[a].label, aspirations: [a] })), { id: UNKNOWN, label: 'それでもわからない' }],
    });
  }
  // 8. 性格そのものを変えたいが、どこを変えたいか不明
  if (transform && !cands.some((c) => c.kind === 'inversion')) {
    const ids = [...new Set([...kept, ...obs])];
    if (ids.length) {
      cands.push({
        id: 'F_TRANSFORM', purpose: 'FOLLOWUP', kind: 'transform_target',
        text: '変えたいのは、今の自分のどの部分ですか',
        reason: '「性格そのものを変えたい」と答えたが、どこを変えるかが決まっていないため（変えない部分を保護するため）',
        options: [...ids.map((t) => ({ id: t, label: TRAITS[t].label, traits: [t] })), { id: UNKNOWN, label: 'まだ決められない' }],
      });
    }
  }

  // 重複（同じ id）を除く。1段目を優先順に並べ、2段目はその後ろに足す（回答済みの質問の順番が動かないように）
  const seen = new Set();
  const uniq = [...cands, ...stage2].filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
  return { followups: uniq.slice(0, MAX_FOLLOWUPS), overflow: uniq.slice(MAX_FOLLOWUPS) };
}
