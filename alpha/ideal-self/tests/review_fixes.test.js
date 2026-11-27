// Phase 1 レビュー指摘への修正の確認
//   指摘1：ETI が測った値（観測）と、アプリがそこから解釈した特性・価値観の候補（推論）を区別する。本人の選択は別の根拠として追える。
//   指摘2：追加回答で確定した成長目標にも、保護特性との確認を適用する。上限に達したら保護を維持して未確定にする。
import test from 'node:test';
import assert from 'node:assert/strict';
import { S, F, etiCurrent, answerAll, QUIET_CHARISMA } from './helpers.js';
import { computeFollowups } from '../src/adaptive.js';
import { MAX_QUESTIONS } from '../src/questions.js';

const draft = (s) => S.buildDraft(s).profile;

// すべての inference_status を、どこにあったか（パス）付きで集める
function statuses(x, at = '$', out = []) {
  if (Array.isArray(x)) x.forEach((v, i) => statuses(v, `${at}[${i}]`, out));
  else if (x && typeof x === 'object') {
    if (typeof x.inference_status === 'string') out.push([at, x.inference_status]);
    if (Array.isArray(x.statuses)) for (const st of x.statuses) out.push([`${at}.statuses`, st]);
    for (const [k, v] of Object.entries(x)) if (k !== 'legend') statuses(v, `${at}.${k}`, out);
  }
  return out;
}

// ---------------------------------------------------------------- 指摘1
test('指摘1：現在像（ETI）— 尺度値は観測、特性・価値観の候補は推論（根拠に観測値を持つ）', () => {
  const cur = etiCurrent().current;
  assert.equal(cur.measurements.length, 20);
  for (const m of cur.measurements) assert.equal(m.inference_status, 'observed');
  const inner = cur.traits.find((t) => t.trait === 'inner_focus');
  assert.equal(inner.inference_status, 'system_inferred');
  assert.equal(inner.evidence.axis, 'E');
  assert.equal(inner.evidence.value, 24);
  assert.equal(inner.evidence.value_status, 'observed');
  for (const t of cur.traits) { assert.equal(t.inference_status, 'system_inferred'); assert.equal(t.evidence.value_status, 'observed'); }
  for (const v of cur.values) { assert.equal(v.inference_status, 'system_inferred'); assert.equal(v.evidence.value_status, 'observed'); }
});

test('指摘1：FutureSelfProfile — observed は尺度の観測値だけに付く', () => {
  const p = draft(answerAll(etiCurrent(), QUIET_CHARISMA));
  const observed = statuses(p).filter(([, st]) => st === 'observed').map(([at]) => at);
  assert.ok(observed.length === 20);
  for (const at of observed) assert.match(at, /^\$\.observed_measurements\[\d+\]$/, `観測値以外に observed が付いています: ${at}`);
  for (const t of p.observed_traits) assert.equal(t.inference_status, 'system_inferred', t.trait);
  // 本人が選んでいない ETI 由来の価値観（BE）は推論のまま
  const be = p.core_values.find((v) => v.value === 'BE');
  assert.deepEqual(be.statuses, ['system_inferred']);
  assert.equal(be.user_selected, false);
});

test('指摘1：本人が「残したい」と選んだことは、ETI からの推論とは別の根拠として追える', () => {
  const p = draft(answerAll(etiCurrent(), QUIET_CHARISMA));
  const inner = p.protected_traits.find((t) => t.trait === 'inner_focus');
  assert.equal(inner.confirmed, true);
  assert.equal(inner.inference_status, 'user_answer');
  const choice = inner.sources.filter((s) => s.kind === 'answer');
  const derived = inner.sources.filter((s) => s.kind === 'observed_trait');
  assert.ok(choice.some((s) => s.question === 'K1' && s.status === 'user_answer'));
  assert.equal(derived.length, 1);
  assert.equal(derived[0].status, 'system_inferred');
  assert.equal(derived[0].evidence.axis, 'E');
  assert.equal(derived[0].evidence.value_status, 'observed');
  // 本人が選んでいない候補は推論のみ・未確認
  const cand = p.protected_traits.find((t) => t.trait === 'deliberation');
  assert.equal(cand.confirmed, false);
  assert.deepEqual(cand.sources.map((s) => s.status), ['system_inferred']);
});

// ---------------------------------------------------------------- 指摘2
// レビューで再現された経路：内省を残す → G1「意思をはっきり伝える力」、G2「初対面の場で固くなる」→ 追加質問で後者を優先
const REVIEW_PATH = { ...QUIET_CHARISMA, G1: ['clear_expression'], G2: ['crowd'] };
const answerReviewPath = (resolution) => answerAll(etiCurrent(), REVIEW_PATH, (q) => (q.id === 'F_GROW_PRIORITY' ? 'social_ease' : q.kind === 'inversion' ? resolution : 'unknown'));

test('指摘2：追加回答で優先した「初対面でも落ち着いて関わる力」にも、G1 直接選択と同じ確認が出る', () => {
  let s = S.startIdeal(etiCurrent());
  for (const [k, v] of Object.entries(REVIEW_PATH)) s = S.answerIdeal(s, k, v);
  assert.deepEqual(s.followups.map((f) => f.id), ['F_GROW_PRIORITY']); // まだ目標が決まっていないので確認は出さない
  s = S.answerIdeal(s, 'F_GROW_PRIORITY', ['social_ease']);
  const inv = s.followups.find((f) => f.kind === 'inversion');
  assert.ok(inv, '確定した成長目標への確認が出ていません');
  assert.equal(inv.id, 'F_INV_social_ease_inner_focus');
  // 確認は優先度の質問の後ろに足され、次に表示される
  assert.deepEqual(s.followups.map((f) => f.id), ['F_GROW_PRIORITY', 'F_INV_social_ease_inner_focus']);
  assert.equal(S.idealQueue(s)[s.idealIndex].id, 'F_INV_social_ease_inner_focus');
  // G1 で直接選んだときと同じ質問
  const direct = computeFollowups(s.current, { ...QUIET_CHARISMA, G1: ['social_ease'], G2: ['crowd'] }).followups.find((f) => f.kind === 'inversion');
  assert.equal(direct.id, inv.id);
  assert.equal(direct.text, inv.text);
  assert.deepEqual(direct.options, inv.options);
});

test('指摘2：「まだ決められない」なら、内省を保護したまま未確定に記録される', () => {
  const p = draft(answerReviewPath('unknown'));
  assert.ok(p.growth_targets.some((g) => g.capability === 'social_ease'));
  assert.ok(p.protected_traits.some((t) => t.trait === 'inner_focus' && t.confirmed));
  const g = p.growth_targets.find((x) => x.capability === 'social_ease');
  assert.deepEqual(g.protection_check, [{ trait: 'inner_focus', question: 'F_INV_social_ease_inner_focus', resolution: 'unknown', status: 'unknown' }]);
  assert.match(g.behavior.text, /社交的に振る舞うのではなく/);
  assert.ok(p.inference_status.unresolved.some((u) => u.ref === 'F_INV_social_ease_inner_focus'));
  assert.ok(p.source_provenance.followups_asked.some((f) => f.id === 'F_INV_social_ease_inner_focus'));
});

test('指摘2：「保ったまま」なら保護を維持して確定、「手放す」なら本人の選択として外れる', () => {
  const keep = draft(answerReviewPath('augment'));
  const g = keep.growth_targets.find((x) => x.capability === 'social_ease');
  assert.equal(g.protection_check[0].resolution, 'augment');
  assert.equal(g.protection_check[0].status, 'user_answer');
  assert.ok(keep.protected_traits.some((t) => t.trait === 'inner_focus' && t.confirmed));
  assert.ok(!keep.inference_status.unresolved.some((u) => /F_INV_social_ease/.test(u.ref || '')));

  const rel = draft(answerReviewPath('release'));
  assert.ok(!rel.protected_traits.some((t) => t.trait === 'inner_focus'));
  assert.ok(rel.released_traits.some((t) => t.trait === 'inner_focus' && t.source.question === 'F_INV_social_ease_inner_focus'));
});

test('指摘2：「両方」「まだ決められない」で優先度を答えても、採用された目標すべてに確認が出る', () => {
  for (const pri of ['both', 'unknown']) {
    const s = answerAll(etiCurrent(), REVIEW_PATH, (q) => (q.id === 'F_GROW_PRIORITY' ? pri : 'unknown'));
    assert.ok(s.followups.some((f) => f.id === 'F_INV_social_ease_inner_focus'), pri);
    const p = draft(s);
    assert.deepEqual(p.growth_targets.map((g) => g.capability).sort(), ['clear_expression', 'social_ease']);
  }
});

test('指摘2：成長目標が F_GROW（伸ばしたい力が未定のときの追加質問）で決まった場合も確認が出る', () => {
  const base = { ...QUIET_CHARISMA, G1: ['unknown'], G2: ['none'] };
  const s = answerAll(etiCurrent(), base, (q) => (q.id === 'F_GROW' ? 'social_ease' : 'unknown'));
  assert.ok(s.followups.some((f) => f.id === 'F_INV_social_ease_inner_focus'));
  const p = draft(s);
  assert.equal(p.growth_targets.find((g) => g.capability === 'social_ease').protection_check[0].resolution, 'unknown');
});

test('指摘2：優先度の回答を変えると、不要になった確認とその回答が消える', () => {
  let s = answerReviewPath('augment');
  assert.ok('F_INV_social_ease_inner_focus' in s.idealAnswers);
  s = S.answerIdeal(s, 'F_GROW_PRIORITY', ['clear_expression']);
  assert.ok(!s.followups.some((f) => f.kind === 'inversion'));
  assert.ok(!('F_INV_social_ease_inner_focus' in s.idealAnswers));
  const p = draft(s);
  assert.deepEqual(p.growth_targets.map((g) => g.capability), ['clear_expression']);
  assert.ok(!p.inference_status.unresolved.some((u) => /F_INV_social_ease/.test(u.ref || '')));
});

test('指摘2：追加6問の上限に達した場合は、保護特性を維持して未確定と表示する', () => {
  // 1段目で6問を使い切る：観測との食い違い×2、成長の優先度、価値観不明、憧れ不明、性格を変えたい部分
  const ext = etiCurrent({ ...F.OWN_EXTRAVERT, personality: { ...F.OWN_EXTRAVERT.personality, O: 80 } });
  const base = { ...REVIEW_PATH, K1: ['inner_focus', 'depth_mastery'], K3: ['unknown'], E1: ['unknown'], G4: ['transform'] };
  const s = answerAll(ext, base, (q) => (q.id === 'F_GROW_PRIORITY' ? 'social_ease' : 'unknown'));
  assert.equal(s.followups.length, 6);
  assert.equal(S.idealQueue(s).length, MAX_QUESTIONS);
  assert.ok(!s.followups.some((f) => f.id === 'F_INV_social_ease_inner_focus'));
  assert.ok(s.overflow.some((f) => f.id === 'F_INV_social_ease_inner_focus'));
  const p = draft(s);
  assert.ok(p.protected_traits.some((t) => t.trait === 'inner_focus' && t.confirmed), '内省の保護が外れています');
  const g = p.growth_targets.find((x) => x.capability === 'social_ease');
  assert.equal(g.protection_check[0].resolution, 'not_asked_question_limit');
  assert.equal(g.protection_check[0].status, 'unknown');
  assert.match(g.behavior.text, /社交的に振る舞うのではなく/);
  const u = p.inference_status.unresolved.find((x) => x.ref === 'F_INV_social_ease_inner_focus');
  assert.ok(u);
  assert.match(u.why, /上限/);
  assert.match(u.why, /保護したまま未確定/);
});

test('追加質問の回答が、その質問自体を消さない（どの回答の組み合わせでも全問回答済みで下書きまで進む）', () => {
  const bases = [
    REVIEW_PATH,
    { ...REVIEW_PATH, E1: ['radiance'] },                      // 1段目（憧れ）と2段目（成長）の両方で内省の確認
    { ...REVIEW_PATH, G4: ['transform'] },
    { ...QUIET_CHARISMA, G1: ['unknown'], G2: ['none'], E1: ['radiance'] },
  ];
  for (const base of bases) {
    for (const pri of ['social_ease', 'both', 'unknown']) {
      for (const inv of ['augment', 'release', 'unknown']) {
        const s = answerAll(etiCurrent(), base, (q) => (q.id === 'F_GROW_PRIORITY' ? pri : q.id === 'F_GROW' ? 'social_ease' : q.kind === 'inversion' ? inv : 'unknown'));
        assert.ok(S.idealDone(s), `${JSON.stringify(base.E1)} ${pri} ${inv}`);
        for (const f of s.followups) assert.ok(s.idealAnswers[f.id], `${f.id} の回答が消えています（${pri}/${inv}）`);
        assert.ok(S.idealQueue(s).length <= MAX_QUESTIONS);
        const p = draft(s);
        if (inv !== 'release') assert.ok(p.protected_traits.some((t) => t.trait === 'inner_focus' && t.confirmed), `${pri}/${inv}`);
      }
    }
  }
});
