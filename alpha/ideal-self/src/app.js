// 画面。状態遷移は state.js の純粋関数に任せ、ここは描画と操作の受け渡しだけ。外部通信は行わない（CSP でも禁止）。
import * as S from './state.js';
import { PURPOSES } from './consent.js';
import { QUICK_QUESTIONS, PURPOSE_LABELS, MAX_QUESTIONS, BASE_QUESTION_COUNT } from './questions.js';
import { TRAITS, VALUES, AXIS_LABELS, UNKNOWN } from './catalog.js';
import { INFERENCE_STATUSES } from './profile.js';
import { SYNTHETIC_RECORDS, SYNTHETIC_SUBJECT_ID } from '../fixtures/synthetic_eti.js';
import * as store from './storage.js';

const app = document.getElementById('app');
const backBtn = document.getElementById('back');
const progress = document.getElementById('progress');

let state = (() => {
  const saved = store.load();
  return saved && saved.consents && saved.consents.memory && saved.consents.memory.status === 'granted' ? saved : S.initialState(SYNTHETIC_SUBJECT_ID);
})();
let ui = { recordKey: null, multi: [], multiQ: null };

function dispatch(fn) {
  try { state = fn(state); } catch (e) { console.error(e); }
  ui.multi = []; ui.multiQ = null;
  if (S.canPersist(state)) store.save(state); else store.clear();
  render();
  app.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

// ---- 小さな DOM ヘルパー（文字列はすべて textContent で入れる）
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
const tag = (status, label) => h('span', { class: `tag ${status}`, text: label || INFERENCE_STATUSES[status] || status });
const btn = (label, onclick, extra = {}) => h('button', { type: 'button', class: `btn ${extra.secondary ? 'secondary' : ''}`, onclick, disabled: extra.disabled, 'data-testid': extra.testid }, label);

// ---------------------------------------------------------------
const screens = {
  consent() {
    const boxes = {};
    const card = (purpose) => {
      const p = PURPOSES[purpose];
      if (p.fixed) {
        return h('section', { class: 'card', 'data-testid': `consent-${purpose}` }, h('h3', { text: p.title }), h('p', { class: 'small', text: p.body }), tag('unknown', 'Phase 1：送信しない（固定）'));
      }
      const cur = state.consents[purpose].status;
      boxes[purpose] = h('input', { type: 'checkbox', id: `c-${purpose}`, 'data-testid': `consent-${purpose}`, checked: cur === 'granted' });
      return h('section', { class: 'card' },
        h('h3', { text: p.title }), h('p', { class: 'small', text: p.body }),
        h('label', { class: 'check', for: `c-${purpose}` }, boxes[purpose], h('span', { text: `「${p.title}」に同意する（任意）` })));
    };
    return [
      h('h1', { text: '5年後の自分を、いまの自分から描く' }),
      h('p', { class: 'lead', text: 'いまの自分の本質を残したまま、憧れる力や魅力を身につけた5年後の自分の「下書き」をつくります。予測や診断ではなく、あなたの回答から組み立てる仮説です。' }),
      h('p', { class: 'lead', text: 'データの使い方は用途ごとに選べます。元素診断の利用規約・配信の同意とは別のものです。同意しなくても、質問から始められます。' }),
      card('eti_import'), card('memory'), card('external_ai'),
      btn('次へ', () => dispatch((s) => S.submitConsent(s, { eti_import: boxes.eti_import.checked, memory: boxes.memory.checked })), { testid: 'consent-next' }),
    ];
  },

  current_select() {
    const granted = state.consents.eti_import.status === 'granted';
    return [
      h('h1', { text: 'いまの自分を、どこから知りますか' }),
      h('section', { class: 'card' },
        h('h3', { text: '元素診断（ETI v2）の結果を使う' }),
        h('p', { class: 'small', text: 'α版では合成データで試します。取り込むのは Big Five・STYLE・VALUES の値と版だけです。' }),
        !granted && h('p', { class: 'notice', text: '「ETI結果の転用」に同意していないため、取り込めません。質問から始めるか、同意を見直してください。' }),
        btn('ETIの結果を使う（合成データ）', () => dispatch((s) => S.chooseRoute(s, 'eti')), { secondary: !granted, testid: 'route-eti' })),
      h('section', { class: 'card' },
        h('h3', { text: '質問から始める（6問）' }),
        h('p', { class: 'small', text: '未受診の方向け。結果は「あなたの自己申告」として扱い、診断と同じ精度があるとはみなしません。' }),
        btn('質問から始める', () => dispatch((s) => S.chooseRoute(s, 'quick')), { testid: 'route-quick' })),
      consentPanel(),
    ];
  },

  eti_import() {
    const idBox = h('input', { type: 'checkbox', id: 'idv', 'data-testid': 'identity', checked: state.subject.identityVerified, onchange: (e) => dispatch((s) => S.verifyIdentity(s, e.target.checked)) });
    const at = state.importAttempt;
    return [
      h('h1', { text: 'ETIの結果を取り込む' }),
      h('section', { class: 'card' },
        h('label', { class: 'check', for: 'idv' }, idBox, h('span', {}, '本人確認（α：合成の本人ID ', h('code', { text: SYNTHETIC_SUBJECT_ID }), ' として扱う）'))),
      h('h2', { text: '合成データを選ぶ' }),
      ...SYNTHETIC_RECORDS.map((r) => h('button', {
        type: 'button', class: 'opt', 'aria-pressed': String(ui.recordKey === r.key), 'data-testid': `record-${r.key}`,
        onclick: () => { ui.recordKey = r.key; render(); },
      }, h('span', { class: 'mark' }), h('span', { text: r.label }))),
      at && !at.ok && h('div', { class: 'notice', 'data-testid': 'import-error' },
        h('p', { text: at.message }),
        at.detail && h('p', { class: 'small', text: JSON.stringify(at.detail) }),
        h('p', { class: 'small', text: 'このまま質問から始めることもできます。' })),
      btn('取り込む', () => { const r = SYNTHETIC_RECORDS.find((x) => x.key === ui.recordKey); const key = ui.recordKey; dispatch((s) => S.attemptImport(s, r.record, key)); ui.recordKey = key; render(); }, { disabled: !ui.recordKey, testid: 'import' }),
      at && !at.ok && btn('質問から始める（6問）', () => dispatch((s) => S.chooseRoute(s, 'quick')), { secondary: true, testid: 'fallback-quick' }),
      h('details', {}, h('summary', { text: '取り込む項目・取り込まない項目' }),
        h('ul', { class: 'ev' },
          h('li', { text: '取り込む：Big Five（O・C・E・A・N）、STYLE（5軸）、VALUES の中心化値（10軸）、診断・設問・採点の版、記録の参照ID' }),
          h('li', { text: '取り込まない：回答そのもの、診断コード、購入情報、元素・武器・国家の順位、ミラー情報' }),
          h('li', { text: '取り込めない：同意前・拒否・撤回、本人確認前、別の所有者、欠損・範囲外、旧版・未知版' }))),
    ];
  },

  quick() {
    const i = Math.min(state.quickIndex, QUICK_QUESTIONS.length);
    if (i >= QUICK_QUESTIONS.length) {
      return [h('h1', { text: '6問に答えました' }), btn('いまの自分を確かめる', () => dispatch(S.finishQuick), { testid: 'quick-finish' })];
    }
    const q = QUICK_QUESTIONS[i];
    const sel = state.quickAnswers[q.id] || [];
    return [
      h('p', {}, tag('purpose', `現在像 ${i + 1} / ${QUICK_QUESTIONS.length}`), tag('user_answer', '自己申告')),
      h('h1', { text: q.text }),
      ...q.options.map((o) => h('button', {
        type: 'button', class: 'opt', 'aria-pressed': String(sel.includes(o.id)), 'data-testid': `opt-${o.id}`,
        onclick: () => dispatch((s) => S.answerQuick(s, q.id, o.id)),
      }, h('span', { class: 'mark' }), h('span', { text: o.label }))),
      h('details', {}, h('summary', { text: 'この質問の意図' }), h('p', { class: 'small', text: q.why })),
    ];
  },

  current_review() {
    const c = state.current;
    const isEti = c.source === 'eti_v2';
    return [
      h('h1', { text: 'いまの自分（現在像）' }),
      h('p', { class: 'lead', text: c.note }),
      h('section', { class: 'card', 'data-testid': 'current-traits' },
        h('h3', { text: '特性の候補' }),
        c.traits.length ? h('ul', { class: 'ev' }, ...c.traits.map((t) => h('li', { 'data-testid': `cur-trait-${t.trait}`, 'data-status': t.inference_status }, TRAITS[t.trait].label, ' ', tag(t.inference_status, isEti ? 'ETIからの推論' : '自己申告'),
          isEti ? h('span', { class: 'small' }, '（根拠：', tag('observed', 'ETI観測値'), `${t.evidence.axis_label} ${t.evidence.value}／規則 ${t.evidence.rule}）`)
            : h('span', { class: 'small', text: `（${t.evidence.question}：${t.evidence.option_label}）` }))))
          : h('p', { class: 'small', text: 'はっきりした傾向は出ませんでした（不明として扱い、推測で補いません）。' }),
        h('h3', { text: '大切にしている価値観の候補' }),
        c.values.length ? h('ul', { class: 'ev' }, ...c.values.map((v) => h('li', { 'data-testid': `cur-value-${v.value}`, 'data-status': v.inference_status }, VALUES[v.value].label, ' ', tag(v.inference_status, isEti ? 'ETIからの推論' : '自己申告'),
          isEti && h('span', { class: 'small' }, '（根拠：', tag('observed', 'ETI観測値'), `中心化値 ${v.evidence.centered}・${v.evidence.rank}位／規則 ${v.evidence.rule}）`))))
          : h('p', { class: 'small', text: '不明' }),
        c.unknowns.length > 0 && h('p', { class: 'small', text: `「わからない」と答えた質問：${c.unknowns.join('、')}` })),
      isEti && h('section', { class: 'card', 'data-testid': 'current-measurements', 'data-status': 'observed' },
        h('h3', { text: 'ETIが測った値' }), tag('observed', 'ETI観測値'),
        h('p', { class: 'small', text: '解釈を含まない尺度の値です。上の候補は、この値からアプリが規則で導いた推論です。' }),
        h('details', {}, h('summary', { text: '値と版を見る' }), provenanceKv(c.provenance), scalesKv(c.scales))),
      btn('理想の自分について答える', () => dispatch(S.startIdeal), { testid: 'to-ideal' }),
    ];
  },

  ideal() {
    const queue = S.idealQueue(state);
    const i = Math.min(state.idealIndex, queue.length);
    if (i >= queue.length && S.idealDone(state)) {
      return [
        h('h1', { text: '質問はここまでです' }),
        h('p', { class: 'lead', text: `基本 ${BASE_QUESTION_COUNT} 問${state.followups.length ? `＋確認 ${state.followups.length} 問` : ''}に答えました。` }),
        state.overflow.length > 0 && h('p', { class: 'reason', text: `質問の上限（${MAX_QUESTIONS}問）のため、${state.overflow.length}件は下書きで「未確定」として示します。` }),
        btn('5年後の自分の下書きをつくる', () => dispatch(S.buildDraft), { testid: 'build-draft' }),
      ];
    }
    const q = queue[Math.min(i, queue.length - 1)];
    const multi = q.multi || 1;
    const sel = ui.multiQ === q.id ? ui.multi : (state.idealAnswers[q.id] || []);
    const choose = (oid) => {
      if (multi === 1) return dispatch((s) => S.answerIdeal(s, q.id, [oid]));
      let next = sel.includes(oid) ? sel.filter((x) => x !== oid) : [...sel.filter((x) => x !== UNKNOWN), oid];
      if (oid === UNKNOWN) next = sel.includes(UNKNOWN) ? [] : [UNKNOWN];
      if (next.length > multi) next = next.slice(next.length - multi);
      ui.multi = next; ui.multiQ = q.id; render();
    };
    return [
      h('p', {}, tag('purpose', PURPOSE_LABELS[q.purpose]), h('span', { class: 'small', text: ` ${i + 1} / ${queue.length}（最大${MAX_QUESTIONS}）` })),
      h('h1', { text: q.text }),
      q.purpose === 'FOLLOWUP' && h('p', { class: 'reason', 'data-testid': 'followup-reason', text: `追加の確認：${q.reason}` }),
      ...q.options.map((o) => h('button', {
        type: 'button', class: 'opt', 'aria-pressed': String(sel.includes(o.id)), 'data-testid': `opt-${o.id}`, onclick: () => choose(o.id),
      }, h('span', { class: 'mark' }), h('span', {}, o.badge && h('span', { class: 'badge', text: o.badge }), o.label))),
      multi > 1 && btn('次へ', () => dispatch((s) => S.answerIdeal(s, q.id, sel)), { disabled: sel.length === 0, testid: 'multi-next' }),
      q.why && h('details', {}, h('summary', { text: 'この質問の意図' }), h('p', { class: 'small', text: q.why })),
    ];
  },

  draft() {
    const p = state.profile;
    const ev = (sources) => h('details', {}, h('summary', { text: '出所と根拠' }), h('ul', { class: 'ev' }, ...sources.map(srcLine)));
    return [
      h('h1', { text: '5年後の自分（下書き）' }),
      h('p', { class: 'notice', 'data-testid': 'disclaimer', text: p.disclaimer }),
      h('section', { class: 'card', 'data-testid': 'summary' }, h('p', { class: 'summary', text: p.summary.text }), tag('system_inferred', '下書き・システムの推論')),
      legend(),
      p.observed_measurements.length > 0 && h('details', { class: 'card', 'data-testid': 'draft-measurements', 'data-status': 'observed' },
        h('summary', {}, tag('observed', 'ETI観測値'), 'ETIが測った値（解釈を含まない）'),
        h('dl', { class: 'kv' }, ...p.observed_measurements.flatMap((m) => [h('dt', { text: `${m.domain}.${m.axis}` }), h('dd', { text: String(m.value) })]))),
      section('CORE｜残す自分らしさ', 'protected', p.protected_traits.map((t) => h('div', { class: 'card' },
        h('h3', { text: t.label }), tag(t.inference_status), t.confirmed ? tag('user_answer', '保護する') : tag('system_inferred', '候補（本人未確認）'),
        ...t.notes.map((n) => h('p', { class: 'small', text: n })), ev(t.sources)))),
      p.released_traits.length > 0 && section('手放すと本人が選んだ特性', 'released', p.released_traits.map((t) => h('div', { class: 'card' }, h('h3', { text: t.label }), tag(t.inference_status), h('p', { class: 'small', text: t.why }), ev([t.source])))),
      section('GROWTH｜伸ばす力', 'growth', p.growth_targets.map((g) => h('div', { class: 'card' },
        h('h3', { text: g.label }), tag(g.inference_status, '本人の選択'),
        h('p', {}, h('span', { class: 'small', text: '具体的な振る舞い：' }), g.behavior.text, ' ', tag(g.behavior.inference_status, '推論')),
        g.gap.current_scene && h('p', { class: 'small', text: `いまの場面：${g.gap.current_scene}` }),
        h('p', { class: 'small', text: `性格とのかかわり：${{ augment: '性格はそのまま、使える場面を増やす', transform: '性格そのものを変えたい', unknown: '不明（保つ前提で下書き）' }[g.mode]}` }),
        ...g.constraints.map((c) => h('p', { class: 'small', text: `制約：${c}` })),
        ...g.protection_check.map((c) => h('p', { class: 'small', 'data-testid': `check-${g.capability}-${c.trait}`, 'data-resolution': c.resolution },
          tag(c.status, c.status === 'unknown' ? '未確定' : '本人の確認'),
          `「${TRAITS[c.trait].short}」との関係：${{ augment: '保ったまま加える', release: '手放す', unknown: 'まだ決められない（保護したまま）', not_asked: '確認できていない（保護したまま）', not_asked_question_limit: '質問の上限で確認できなかった（保護したまま）' }[c.resolution]}`)),
        ev(g.sources)))),
      section('ASPIRATION｜憧れる魅力', 'aspiration', p.aspirational_traits.map((a) => h('div', { class: 'card' },
        h('h3', { text: a.label }), tag(a.inference_status, '本人の選択'),
        h('p', {}, a.integration.text, ' ', tag(a.integration.inference_status, '推論')), ev(a.sources)))),
      section('大切にする価値観', 'values', p.core_values.map((v) => h('div', { class: 'card' },
        h('h3', { text: v.label }), ...v.statuses.map((s) => tag(s)), ev(v.sources)))),
      section('判断原則（仮）', 'principles', p.decision_principles.map((d) => h('div', { class: 'card' },
        h('p', { text: d.text }), tag('system_inferred', '下書き'),
        h('details', {}, h('summary', { text: '根拠' }), h('ul', { class: 'ev' }, ...d.basis.map((b) => h('li', { text: basisLabel(b, p) }))))))),
      (p.inference_status.unknowns.length + p.inference_status.unresolved.length) > 0 && section('不明・未確定', 'unknowns', [
        ...p.inference_status.unknowns.map((u) => h('p', { class: 'small' }, tag('unknown'), `${u.field}：${u.why}`)),
        ...p.inference_status.unresolved.map((u) => h('p', { class: 'small' }, tag('unknown', '未確定'), `${u.why}`)),
      ]),
      h('details', { class: 'card' }, h('summary', { text: '出所と版' }), provenanceKv({
        persona_version: p.persona_version, approval_status: p.approval_status, current_source: p.source_provenance.current_source,
        ...(p.source_provenance.eti || {}), quick: p.source_provenance.quick_question_set_version, ideal: p.source_provenance.ideal_question_set_version,
        rule: p.source_provenance.rule_version, catalog: p.source_provenance.catalog_version, consent: p.source_provenance.consent_version,
        followups: p.source_provenance.followups_asked.map((f) => f.id).join(', ') || 'なし',
      })),
      h('details', { class: 'card' }, h('summary', { text: '構造化データ（JSON）' }), h('pre', { class: 'small', style: null, 'data-testid': 'profile-json', text: JSON.stringify(p, null, 2) })),
      h('h2', { text: 'この下書きについて' }),
      h('p', { class: 'small', 'data-testid': 'approval', text: `状態：${{ unconfirmed: '未確認', needs_revision: '修正待ち', approved: '承認済み' }[p.approval_status]}` }),
      h('div', { class: 'row' },
        btn('修正したい', () => dispatch((s) => S.markApproval(s, 'needs_revision')), { secondary: true, testid: 'needs-revision' }),
        btn('この下書きで進める', () => dispatch((s) => S.markApproval(s, 'approved')), { testid: 'approve' })),
      btn('回答を見直す', () => dispatch(S.goBack), { secondary: true }),
      consentPanel(),
    ];
  },
};

function section(title, id, kids) { return h('section', { 'data-testid': `sec-${id}` }, h('h2', { text: title }), ...(kids.length ? kids : [h('p', { class: 'small' }, tag('unknown'), '未回答・不明')])); }
function legend() { return h('p', { class: 'small' }, ...Object.keys(INFERENCE_STATUSES).map((k) => tag(k))); }
function srcLine(s) {
  if (!s) return h('li', { text: '不明' });
  if (s.kind === 'answer') return h('li', { 'data-status': 'user_answer' }, tag('user_answer', '本人の選択'), `${s.question}「${s.question_text}」→「${s.option_label}」`);
  if (s.kind === 'observed_trait') {
    return s.evidence.kind === 'eti_scale'
      ? h('li', { 'data-status': s.status }, tag(s.status, 'アプリの推論'), `ETIの値から規則 ${s.evidence.rule} で導いた候補（`, tag('observed', 'ETI観測値'), `${s.evidence.axis_label}（${s.evidence.axis}）= ${s.evidence.value}）`)
      : h('li', { 'data-status': s.status }, tag(s.status, '自己申告'), `簡易質問 ${s.evidence.question}：${s.evidence.option_label}`);
  }
  if (s.kind === 'eti_values_centered') return h('li', { 'data-status': 'system_inferred' }, tag('system_inferred', 'アプリの推論'), `規則 ${s.evidence.rule} で導いた候補（`, tag('observed', 'ETI観測値'), `VALUES ${s.evidence.axis} 中心化値 ${s.evidence.centered}・${s.evidence.rank}位）`);
  if (s.kind === 'quick_question') return h('li', { text: `簡易質問 ${s.evidence.question}：${s.evidence.option_label}（自己申告）` });
  return h('li', { text: JSON.stringify(s) });
}
function basisLabel(b, p) {
  if (b.element === 'core_values') return `価値観：${VALUES[b.id].label}`;
  if (b.element === 'protected_traits') return `保護特性：${TRAITS[b.id].label}`;
  if (b.element === 'answer') return `本人の回答 ${b.id}（${b.option}）`;
  return `${b.element}:${b.id}`;
}
function provenanceKv(obj) { return h('dl', { class: 'kv' }, ...Object.entries(obj).filter(([, v]) => v != null).flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: String(v) })])); }
function scalesKv(sc) {
  return h('dl', { class: 'kv' }, ...['personality', 'style'].flatMap((d) => Object.entries(sc[d]).flatMap(([k, v]) => [h('dt', { text: `${k}（${AXIS_LABELS[k]}）` }), h('dd', { text: v })])),
    ...Object.entries(sc.valuesCentered).flatMap(([k, v]) => [h('dt', { text: `${k}（${VALUES[k].short}）` }), h('dd', { text: v })]));
}
function consentPanel() {
  const c = state.consents;
  const label = { granted: '同意済み', denied: '同意していない', revoked: '撤回済み', unset: '未選択', not_sent: '送信しない（固定）' };
  return h('details', { class: 'card', 'data-testid': 'consent-panel' }, h('summary', { text: '同意の確認・撤回' }),
    h('p', { class: 'small', text: `ETI結果の転用：${label[c.eti_import.status]}／記憶の保存：${label[c.memory.status]}／外部AIへの送信：${label[c.external_ai.status]}` }),
    c.eti_import.status === 'granted' && btn('ETI結果の転用を撤回する', () => dispatch((s) => S.revoke(s, 'eti_import')), { secondary: true, testid: 'revoke-eti' }),
    c.memory.status === 'granted' && btn('記憶の保存を撤回する', () => dispatch((s) => S.revoke(s, 'memory')), { secondary: true, testid: 'revoke-memory' }),
    c.eti_import.status !== 'granted' && btn('同意を見直す', () => dispatch((s) => ({ ...s, step: 'consent' })), { secondary: true, testid: 'reconsent' }));
}

function render() {
  const fn = screens[state.step] || screens.consent;
  app.replaceChildren(...fn().filter(Boolean));
  backBtn.hidden = state.step === 'consent';
  progress.textContent = { consent: '説明・同意', current_select: '現在像', eti_import: '現在像', quick: '現在像', current_review: '現在像', ideal: '理想像', draft: '下書き' }[state.step] || '';
  document.body.dataset.step = state.step;
}
backBtn.addEventListener('click', () => dispatch(S.goBack));
render();
