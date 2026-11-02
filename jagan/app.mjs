// jagan/app.mjs — 邪眼診断の画面（TOP・質問・結果・保存・画像保存・X共有）。
//   採点は jagan/engine（仕様パッケージの runtime.mjs・math.mjs をそのまま使用）。サーバーも同じ版で再計算する。
//   ・回答は 1〜5 と、別枠の「判断できない・回答しない」（null）。null を中間点で埋めない。
//   ・この端末に残すもの（localStorage）：途中の回答、最後の結果（再表示用）、ログイン前の保存待ち、共有の取消用の値。
//     ETI の pending（pendingDiagnosis_v1・v2）とは別のキーにする。
//   ・GA4 へは操作の種類だけを送る（回答・12スコア・結果 ID・公開 ID は送らない）。
import { computeDiagnosis, publicSummary, makeShareText } from './engine/runtime.mjs';
import { BUNDLE, COPY } from './engine/data.mjs';
import { renderResult, shareTextFromSummary, esc } from './view.mjs';
import { cardBlob } from './card.mjs';

const ITEMS = BUNDLE.items;
const VERSION = ITEMS.item_set_version;
const ORDER = ITEMS.display_order;
const ITEM_BY_ID = Object.fromEntries(ITEMS.items.map((i) => [i.id, i]));
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const K = { progress: 'jagan_progress_v1', last: 'jagan_last_v1', pending: 'jagan_pending_save_v1', shares: 'jagan_shares_v1' };
const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000; // ETI v2 の保存待ちと同じ 24 時間
const BLOCKS = {
  need: { title: 'ブロック1／3｜日々の手応え', intro: '' },
  strategy: { title: 'ブロック2／3｜気持ちの扱い方', intro: 'ここからは、気持ちが動いたときの扱い方についての質問です。' },
  difficulty: { title: 'ブロック3／3｜つらいとき', intro: 'ここからは、最近1か月の、つらい気持ちになった場面についての質問です。その期間に経験した場面を思い浮かべてください。' },
};

const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch { /* noop */ } },
};
function track(name, params) { try { if (typeof window.gtag === 'function') window.gtag('event', name, params || {}); } catch { /* 計測だけ */ } }
const newResultId = () => (crypto.randomUUID ? crypto.randomUUID()
  : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));

// ---- Supabase（ETI と同じ公開設定。本番ホストでは本番の設定だけを使う） ----
function supabaseClient() {
  if (supabaseClient.c !== undefined) return supabaseClient.c;
  const cfg = window.__ED_PUBLIC_CONFIG__;
  let c = null;
  try {
    const ok = cfg && /^[a-z0-9]{20}$/.test(cfg.projectRef || '') && cfg.supabaseUrl === `https://${cfg.projectRef}.supabase.co`
      && typeof cfg.supabaseAnonKey === 'string' && !cfg.supabaseAnonKey.startsWith('sb_secret_')
      && ((location.hostname === 'element-diagnosis-five.vercel.app') === (cfg.appEnv === 'production'));
    if (ok && window.supabase && typeof window.supabase.createClient === 'function') c = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  } catch { c = null; }
  supabaseClient.c = c;
  return c;
}
async function accessToken() {
  const c = supabaseClient();
  if (!c) return null;
  try { const { data } = await c.auth.getSession(); return data && data.session ? data.session.access_token : null; } catch { return null; }
}

// ---- 画面 ----
function show(view) {
  document.querySelectorAll('[data-view]').forEach((el) => { el.hidden = el.id !== `view-${view}`; });
  window.scrollTo(0, 0);
}
function message(text) { $('messageText').textContent = text; show('message'); }

// ---- 回答の状態（途中の回答はこの端末に残す。版が違えば使わない） ----
let state = null; // { resultId, answers, index }
function loadProgress() {
  const p = store.get(K.progress);
  if (!p || p.v !== VERSION || !UUID_RE.test(p.resultId || '') || !p.answers || typeof p.answers !== 'object') return null;
  const answers = {};
  for (const [k, v] of Object.entries(p.answers)) if (ITEM_BY_ID[k] && (v === null || (Number.isInteger(v) && v >= 1 && v <= 5))) answers[k] = v;
  return { resultId: p.resultId, answers, index: Math.max(0, Math.min(ORDER.length - 1, Number(p.index) || 0)) };
}
function saveProgress() { if (state) store.set(K.progress, { v: VERSION, resultId: state.resultId, answers: state.answers, index: state.index }); }
const answeredCount = (a) => ORDER.filter((id) => Object.hasOwn(a, id)).length;

// ---- 質問 ----
let advancing = false;
let pendingBreak = null; // ブロックの区切りを表示中
function renderQuestion() {
  const id = ORDER[state.index];
  const item = ITEM_BY_ID[id];
  const block = BLOCKS[item.block];
  $('qBlock').textContent = block.title;
  $('qCount').textContent = `${state.index + 1} / ${ORDER.length}`;
  $('qBar').style.width = `${(answeredCount(state.answers) / ORDER.length) * 100}%`;
  $('qBreak').hidden = !pendingBreak;
  $('qBody').hidden = !!pendingBreak;
  if (pendingBreak) {
    $('qBreakTitle').textContent = BLOCKS[pendingBreak].title;
    $('qBreakText').textContent = `${BLOCKS[pendingBreak].intro}${ITEMS.instruction}`;
    $('qNext').disabled = true;
    $('qBreakGo').focus();
    return;
  }
  $('qId').textContent = `Q${state.index + 1}`;
  $('qText').textContent = item.text;
  const has = Object.hasOwn(state.answers, id);
  const cur = has ? state.answers[id] : undefined;
  $('qOptions').innerHTML = ITEMS.options.map((o) => `<button type="button" class="jg-opt" data-v="${o.value}" aria-pressed="${cur === o.value}">
      <span class="jg-mark" aria-hidden="true"></span><span>${esc(o.label)}</span></button>`).join('');
  const miss = $('qMissing');
  miss.setAttribute('aria-pressed', String(has && cur === null));
  miss.lastElementChild.textContent = ITEMS.missing_option.label;
  $('qBack').disabled = state.index === 0;
  $('qNext').disabled = !has;
  $('qNext').textContent = state.index === ORDER.length - 1 ? '確認へ ›' : '次へ ›';
}
function choose(value) {
  if (advancing || pendingBreak) return; // 連打で2問進まない
  const id = ORDER[state.index];
  state.answers[id] = value;
  saveProgress();
  advancing = true;
  renderQuestion();
  const at = state.index;
  setTimeout(() => { advancing = false; if (state && state.index === at) next(); }, 260);
}
function next() {
  const id = ORDER[state.index];
  if (!Object.hasOwn(state.answers, id)) return;
  if (state.index === ORDER.length - 1) { showReview(); return; }
  const cur = ITEM_BY_ID[id].block;
  state.index += 1;
  const nb = ITEM_BY_ID[ORDER[state.index]].block;
  if (nb !== cur) pendingBreak = nb;
  saveProgress();
  renderQuestion();
}
function back() {
  if (advancing) return;
  if (pendingBreak) { pendingBreak = null; state.index -= 1; saveProgress(); renderQuestion(); return; }
  if (state.index === 0) return;
  state.index -= 1;
  saveProgress();
  renderQuestion();
}
function startQuiz(resume) {
  state = resume || { resultId: newResultId(), answers: {}, index: 0 };
  pendingBreak = null;
  saveProgress();
  if (!resume) { $('introInstruction').textContent = ITEMS.instruction; show('intro'); track('jagan_start', {}); return; }
  show('quiz'); renderQuestion();
}

// ---- 回答の確認 ----
function showReview() {
  const a = state.answers;
  const missing = ORDER.filter((id) => a[id] === null).length;
  const unanswered = ORDER.length - answeredCount(a);
  $('reviewSummary').textContent = `${ORDER.length}問中、${ORDER.length - missing - unanswered}問に回答しました。「判断できない・回答しない」は${missing}問です。`;
  let warn = '';
  try {
    const r = computeDiagnosis({ answers: a, resultId: state.resultId, itemSetVersion: VERSION }, BUNDLE);
    const short = ITEMS.domains.filter((d) => r.domains[d.id].score === null).map((d) => d.label);
    if (short.length) warn = `回答が足りない領域があります（${short.join('・')}）。この領域を使う判定は保留になります。回答を見直すこともできます。`;
  } catch { /* 表示だけ */ }
  $('reviewWarn').textContent = warn;
  $('reviewWarn').hidden = !warn;
  show('review');
}
function finish() {
  const answers = {};
  for (const id of ORDER) answers[id] = Object.hasOwn(state.answers, id) ? state.answers[id] : null;
  const last = { v: VERSION, resultId: state.resultId, answers, completedAt: new Date().toISOString() };
  store.set(K.last, last);
  store.del(K.progress);
  track('jagan_complete', { answered_bucket: bucket(ORDER.filter((id) => answers[id] !== null).length) });
  showResult(last, { mode: 'fresh' });
  try { history.replaceState(null, '', '/jagan/#result'); } catch { /* noop */ }
}
const bucket = (n) => (n === 50 ? '50' : n >= 45 ? '45-49' : n >= 30 ? '30-44' : '0-29');

// ---- 結果 ----
let current = null; // { result, answers, mode }
function showResult(record, { mode, savedAt } = {}) {
  let result;
  if (mode === 'saved') result = record.snapshot;
  else {
    try { result = computeDiagnosis({ answers: record.answers, resultId: record.resultId, itemSetVersion: VERSION }, BUNDLE); }
    catch (e) { message('結果を表示できませんでした。もう一度診断してください。'); return; }
  }
  current = { result, answers: mode === 'saved' ? result.answers : record.answers, mode };
  $('resultBody').innerHTML = renderResult(result, BUNDLE, COPY);
  const banner = $('savedBanner');
  banner.hidden = mode !== 'saved';
  if (mode === 'saved') banner.textContent = `マイページに保存した結果です（${new Date(savedAt).toLocaleString('ja-JP')}・保存時の版 ${result.versions.interpretation}）。`;
  const shareable = summaryOf(result) !== null;
  $('imageBtn').disabled = !shareable;
  $('shareBtn').disabled = !shareable;
  const insufficient = result.elements.status === 'insufficient' || result.types.status === 'insufficient' || result.characters.status !== 'available';
  $('pendingFix').hidden = !(insufficient && mode === 'fresh');
  setStatus(shareable ? '' : '回答不足の部分があるため、画像保存・共有はできません。');
  const saveBtn = $('saveBtn');
  if (mode === 'saved') { saveBtn.textContent = '✓ 保存済み'; saveBtn.disabled = true; }
  else if (store.get(K.pending) && store.get(K.pending).resultId === result.resultId) { saveBtn.textContent = 'マイページ保存（ログイン待ち）'; saveBtn.disabled = false; }
  else { saveBtn.textContent = 'マイページ保存'; saveBtn.disabled = false; }
  show('result');
}
function summaryOf(result) { try { return publicSummary(result); } catch { return null; } }
function setStatus(text, isError) { const s = $('actionStatus'); s.textContent = text || ''; s.classList.toggle('is-error', !!isError); }

// 保存：ログイン中ならサーバーへ（サーバーが再計算して保存）。未ログインなら保存待ちを残してマイページでログイン
let saving = false;
async function save() {
  if (!current || current.mode === 'saved' || saving) return;
  track('jagan_save_click', {});
  const r = current.result;
  const payload = { resultId: r.resultId, itemSetVersion: r.versions.itemSet, answers: current.answers };
  const btn = $('saveBtn');
  const token = await accessToken();
  if (!token) {
    if (!supabaseClient()) { setStatus('ログイン・保存は現在ご利用いただけません。', true); return; }
    store.set(K.pending, { ...payload, at: Date.now() });
    // ETI の「保存後に結果ページへ戻る」印が残っていると、マイページから ETI の結果へ移るため消す
    try { localStorage.removeItem('ed_save_return_v1'); } catch { /* noop */ }
    setStatus('マイページでログインすると、この結果を保存します。');
    location.href = '/mypage?from=jagan';
    return;
  }
  saving = true; btn.disabled = true; btn.textContent = '保存中…'; setStatus('');
  try {
    const res = await fetch('/api/jagan-save', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(payload) });
    const out = await res.json().catch(() => ({}));
    if (res.ok && out.ok) {
      store.del(K.pending);
      btn.textContent = '✓ 保存しました';
      $('actionStatus').innerHTML = 'マイページに保存しました。<a href="/mypage#jagan">マイページで見る ›</a>';
      track('jagan_save_success', {});
      return;
    }
    if (res.status === 403 && out.error === 'registration_required') {
      store.set(K.pending, { ...payload, at: Date.now() });
      $('actionStatus').innerHTML = '保存の前に、マイページで登録（利用規約への同意）を完了してください。完了すると自動で保存します。<a href="/mypage?from=jagan">マイページへ ›</a>';
      btn.disabled = false; btn.textContent = 'マイページ保存';
      return;
    }
    const why = res.status === 503 ? '保存は現在ご利用いただけません（準備中）。' : res.status === 409 ? 'この結果は保存できません（別のアカウントで保存済みです）。' : '保存に失敗しました。';
    setStatus(`${why}もう一度押すと再試行します。`, true);
    btn.disabled = false; btn.textContent = 'マイページ保存（再試行）';
  } catch {
    setStatus('通信に失敗しました。もう一度押すと再試行します。', true);
    btn.disabled = false; btn.textContent = 'マイページ保存（再試行）';
  } finally { saving = false; }
}

// 画像保存：押したときに描く（生成中・失敗でも他の操作は止めない）
let imaging = false;
async function saveImage() {
  if (!current || imaging) return;
  const s = summaryOf(current.result);
  if (!s) return;
  imaging = true; const btn = $('imageBtn'); btn.textContent = '画像を作成中…';
  track('jagan_image_save', {});
  try {
    const blob = await cardBlob(s);
    const file = typeof File === 'function' ? new File([blob], 'jagan-result.png', { type: 'image/png' }) : null;
    if (file && navigator.canShare && navigator.canShare({ files: [file] }) && /iP(hone|ad|od)|Android/.test(navigator.userAgent)) {
      await navigator.share({ files: [file] }).catch(() => {});
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'jagan-result.png';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
    btn.textContent = '画像保存';
  } catch {
    btn.textContent = '画像保存（再試行）';
    setStatus('画像を作成できませんでした。もう一度押すと再試行します。', true);
  } finally { imaging = false; }
}

// X共有：本人の操作で共有ページを作り、内容を確認してから X の投稿画面を開く（自動投稿しない）
let sharing = false;
let currentShare = null;
async function share() {
  if (!current || sharing) return;
  const r = current.result;
  track('jagan_share_click', {});
  const known = (store.get(K.shares) || {})[r.resultId];
  sharing = true; $('shareBtn').textContent = '共有ページを作成中…';
  try {
    let publicId = known && known.publicId;
    if (!publicId) {
      const token = await accessToken();
      const res = await fetch('/api/jagan-share', { method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ resultId: r.resultId, itemSetVersion: r.versions.itemSet, answers: current.answers }) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.publicId) {
        setStatus(res.status === 503 ? '共有は現在ご利用いただけません（準備中）。' : '共有ページを作成できませんでした。もう一度押すと再試行します。', true);
        return;
      }
      publicId = out.publicId;
      const all = store.get(K.shares) || {};
      all[r.resultId] = { publicId, revokeToken: out.revokeToken || (known && known.revokeToken) || null };
      store.set(K.shares, all);
    }
    const url = `${location.origin}/jagan/s/${publicId}`;
    let text;
    try { text = makeShareText(r, url, `${location.origin}/`); } catch { text = shareTextFromSummary(publicSummary(r), url); }
    currentShare = { publicId, url, resultId: r.resultId };
    $('shareText').textContent = text;
    $('shareOpenX').href = `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
    $('shareStatus').textContent = '';
    $('shareDialog').showModal();
  } catch {
    setStatus('通信に失敗しました。もう一度押すと再試行します。', true);
  } finally { sharing = false; $('shareBtn').textContent = 'Xシェア'; }
}
async function revokeShare() {
  if (!currentShare) return;
  const all = store.get(K.shares) || {};
  const rec = all[currentShare.resultId] || {};
  const token = await accessToken();
  try {
    const res = await fetch('/api/jagan-share', { method: 'DELETE',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ publicId: currentShare.publicId, revokeToken: rec.revokeToken || undefined }) });
    if (res.ok) {
      delete all[currentShare.resultId]; store.set(K.shares, all);
      $('shareStatus').textContent = '共有を取り消しました。このURLでは結果が表示されなくなります。';
      currentShare = null;
    } else {
      $('shareStatus').textContent = res.status === 403 ? 'この端末からは取り消せません（共有を作成した端末・アカウントで操作してください）。' : '取り消しに失敗しました。';
    }
  } catch { $('shareStatus').textContent = '通信に失敗しました。'; }
}

// ---- 保存した結果の再表示（/jagan/?saved=<結果ID>。本人の行だけ RLS で読める） ----
async function openSaved(resultId) {
  const c = supabaseClient();
  if (!c) { message('ログイン・保存は現在ご利用いただけません。'); return; }
  const token = await accessToken();
  if (!token) { message('保存した結果を見るには、マイページでログインしてください。'); return; }
  try {
    const { data, error } = await c.from('jagan_results').select('result_id,snapshot,created_at').eq('result_id', resultId).maybeSingle();
    if (error || !data) { message('保存した結果が見つかりませんでした（削除された、または別のアカウントの結果です）。'); return; }
    showResult({ snapshot: data.snapshot }, { mode: 'saved', savedAt: data.created_at });
  } catch { message('読み込みに失敗しました。時間をおいて再度お試しください。'); }
}

// ---- 起動 ----
function wire() {
  $('startBtn').addEventListener('click', () => startQuiz(null));
  $('resumeBtn').addEventListener('click', () => { const p = loadProgress(); if (p) startQuiz(p); });
  $('lastResultBtn').addEventListener('click', () => { const l = store.get(K.last); if (l && l.v === VERSION) { showResult(l, { mode: 'fresh' }); history.replaceState(null, '', '/jagan/#result'); } });
  $('introGo').addEventListener('click', () => { show('quiz'); renderQuestion(); });
  $('qOptions').addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (b) choose(Number(b.dataset.v)); });
  $('qMissing').addEventListener('click', () => choose(null));
  $('qBack').addEventListener('click', back);
  $('qNext').addEventListener('click', () => { if (!advancing) next(); });
  $('qBreakGo').addEventListener('click', () => { pendingBreak = null; renderQuestion(); });
  $('qShowInstruction').addEventListener('click', () => alert(ITEMS.instruction));
  $('reviewBack').addEventListener('click', () => {
    const firstMissing = ORDER.findIndex((id) => !Object.hasOwn(state.answers, id) || state.answers[id] === null);
    state.index = firstMissing >= 0 ? firstMissing : 0; pendingBreak = null; show('quiz'); renderQuestion();
  });
  $('reviewGo').addEventListener('click', finish);
  $('saveBtn').addEventListener('click', save);
  $('imageBtn').addEventListener('click', saveImage);
  $('shareBtn').addEventListener('click', share);
  $('shareCopy').addEventListener('click', async () => {
    if (!currentShare) return;
    try { await navigator.clipboard.writeText(currentShare.url); $('shareStatus').textContent = 'URLをコピーしました。'; } catch { $('shareStatus').textContent = currentShare.url; }
  });
  $('shareRevoke').addEventListener('click', revokeShare);
  $('shareClose').addEventListener('click', () => $('shareDialog').close());
  $('shareOpenX').addEventListener('click', () => track('jagan_share_open_x', {}));
  $('buyBtn').addEventListener('click', () => track('jagan_report_cta', { state: 'closed' }));
  $('retryBtn').addEventListener('click', () => { store.del(K.progress); history.replaceState(null, '', '/jagan/'); startQuiz(null); });
  $('fixAnswersBtn').addEventListener('click', () => {
    if (!current || current.mode !== 'fresh') return;
    state = { resultId: current.result.resultId, answers: { ...current.answers }, index: 0 };
    const firstMissing = ORDER.findIndex((id) => state.answers[id] === null);
    state.index = firstMissing >= 0 ? firstMissing : 0;
    pendingBreak = null; saveProgress(); show('quiz'); renderQuestion();
  });
  document.addEventListener('keydown', (e) => {
    if ($('view-quiz').hidden || pendingBreak || e.target.closest('input,textarea')) return;
    if (/^[1-5]$/.test(e.key)) choose(Number(e.key));
  });
}

function boot() {
  wire();
  const params = new URLSearchParams(location.search);
  const saved = params.get('saved');
  if (saved && UUID_RE.test(saved)) { openSaved(saved); return; }
  const last = store.get(K.last);
  const validLast = last && last.v === VERSION && UUID_RE.test(last.resultId || '') ? last : null;
  if (location.hash === '#result' && validLast) { showResult(validLast, { mode: 'fresh' }); return; }
  const p = loadProgress();
  $('resumeBtn').hidden = !(p && answeredCount(p.answers) > 0);
  $('lastResultBtn').hidden = !validLast;
  show('top');
}
boot();
