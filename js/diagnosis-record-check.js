// js/diagnosis-record-check.js
// 診断完了ページの「診断記録」カード用：この結果がすでに保存されているかを確認する（読み取り専用）。
//
// ・書き込みは一切しない（INSERT / UPDATE / RPC 呼び出しなし）。保存そのものは既存の
//   handleSaveResultClickV2()（js/eti_v2_save.js）／handleSaveResultClick()（diagnosis-save.js）が行う。
// ・既存のテーブル・列・RLS だけを使う（マイページの loadDiagnosisHistory() と同じ列を読む）。
//   RLS により本人の行しか返らない。DB・RPCの変更は不要。
// ・完全一致の判定キー：user_id + diagnosis_version + item_set_version + scoring_version + diagnosis_code
//     v2     … diagnosis_code = 100回答の可逆コード（encodeAnswersV2）。1問でも違えば別コード
//     legacy … diagnosis_code = 元素＋武器＋エニアグラム＋回答コード（applyData）。回答から決定的に決まる
//   元素・武器・国家などの最終タイプは判定に使わない。v1 と v2 は diagnosis_version で必ず分ける。
// ・client_session_id は使わない（同じ保存操作の再送防止という既存の役割のまま）。
//
// 依存：diagnosis-save.js（supabaseClient, getCurrentUser）を先に読み込むこと。

// 戻り値 state：
//   'signed_out' … 未ログイン
//   'saved'      … 同じ測定条件・同じ回答の記録がある（sessionId 付き）
//   'unsaved'    … 記録がない
//   'unknown'    … 読み取りに失敗（呼び出し側は「未保存」として扱い、保存は既存処理に任せる）
async function findSavedDiagnosisRecord(key) {
  let user = null;
  try { user = await getCurrentUser(); } catch (e) { return { state: 'unknown', error: e }; }
  if (!user) return { state: 'signed_out' };
  if (!key || !key.diagnosisCode || !key.diagnosisVersion) return { state: 'unknown', error: 'missing_key' };
  try {
    const { data, error } = await supabaseClient
      .from('diagnosis_sessions')
      .select('id, diagnosis_version, item_set_version, diagnosis_results!inner(diagnosis_code, scoring_version, item_set_version)')
      .eq('user_id', user.id)
      .eq('diagnosis_type', 'element')
      .eq('diagnosis_results.diagnosis_code', key.diagnosisCode)
      .limit(50);
    if (error) return { state: 'unknown', error };
    const hit = (data || []).find(row => isSameDiagnosisRecord(row, key));
    return hit ? { state: 'saved', sessionId: hit.id } : { state: 'unsaved' };
  } catch (e) {
    return { state: 'unknown', error: e };
  }
}

// 1行が判定キーと完全一致するか（列の欠落は「一致しない」側に倒す）
function isSameDiagnosisRecord(row, key) {
  const r = Array.isArray(row.diagnosis_results) ? row.diagnosis_results[0] : row.diagnosis_results;
  if (!r) return false;
  // legacy 行は diagnosis_version が空のことがある（マイページと同じく legacy として扱う）
  const rowVersion = row.diagnosis_version || 'element-v1';
  const keyVersion = key.diagnosisVersion || 'element-v1';
  const rowItemSet = row.item_set_version || r.item_set_version || null;
  return rowVersion === keyVersion
    && rowItemSet === (key.itemSetVersion || null)
    && r.scoring_version === key.scoringVersion
    && r.diagnosis_code === key.diagnosisCode;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { findSavedDiagnosisRecord, isSameDiagnosisRecord };
}
