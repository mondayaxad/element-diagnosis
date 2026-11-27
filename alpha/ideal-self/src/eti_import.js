// ETI v2 結果の取込境界。条件：本人確認済み・ETI取込同意あり・所有者が本人・既知の版・必須値がそろっている。
// 取り込むのは Big Five（personality）・STYLE・VALUES の中心化値と、出所・版だけ（許可リスト方式でコピー）。
// 生回答（answers_v2・encoded_answers）、診断コード、購入情報、ミラー・ランキング等は一切コピーしない。
// Phase 1 は合成データのみ。実 ETI アカウント・本番DBには接続しない。

export const KNOWN_ETI_VERSIONS = [
  { diagnosis_version: 'ETI-2.0', item_set_version: 'ETI-ITEM-2.0.0', scoring_version: 'ETI-SCORE-2.0.0' },
];
export const PERSONALITY_AXES = ['O', 'C', 'E', 'A', 'N'];
export const STYLE_AXES = ['AGY', 'REL', 'ROL', 'REF', 'AUT'];
export const VALUE_AXES = ['SD', 'ST', 'HE', 'AC', 'PO', 'SE', 'CO', 'TR', 'BE', 'UN'];

export const REJECT_MESSAGES = {
  consent_not_granted: 'ETI結果の転用に同意していないため、取り込みません',
  consent_revoked: 'ETI結果の転用の同意が撤回されているため、取り込みません',
  identity_not_verified: '本人確認ができていないため、取り込みません',
  owner_mismatch: '本人の記録ではないため、取り込みません',
  not_eti: '元素診断の記録ではないため、取り込みません',
  legacy_version: '旧版の診断結果のため、取り込みません（v2 のみ対応）',
  unknown_version: '対応していない版の診断結果のため、取り込みません',
  missing_or_invalid: '必要な値が欠けている・範囲外のため、取り込みません',
  no_record: '記録がありません',
};

function finite(x) { return typeof x === 'number' && Number.isFinite(x); }

export function importEtiResult(record, ctx) {
  const reject = (reason, detail) => ({ ok: false, reason, message: REJECT_MESSAGES[reason], detail: detail || null });
  const consent = ctx && ctx.consent;
  if (!consent || consent.status !== 'granted') return reject(consent && consent.status === 'revoked' ? 'consent_revoked' : 'consent_not_granted');
  if (!ctx.identityVerified || !ctx.subjectId) return reject('identity_not_verified');
  if (!record || typeof record !== 'object') return reject('no_record');
  if (record.owner_id !== ctx.subjectId) return reject('owner_mismatch');
  if (record.diagnosis_type !== 'element') return reject('not_eti');

  const dv = record.diagnosis_version;
  const known = KNOWN_ETI_VERSIONS.find((k) => k.diagnosis_version === dv);
  if (!known) return reject(typeof dv === 'string' && /^(ETI-1|legacy|v1)/i.test(dv) ? 'legacy_version' : 'unknown_version', { diagnosis_version: dv ?? null });
  if (record.item_set_version !== known.item_set_version || record.scoring_version !== known.scoring_version) {
    return reject('unknown_version', { item_set_version: record.item_set_version ?? null, scoring_version: record.scoring_version ?? null });
  }

  const missing = [];
  const take = (obj, axes, path, lo, hi) => {
    const out = {};
    for (const ax of axes) {
      const v = obj && obj[ax];
      if (!finite(v) || v < lo || v > hi) missing.push(`${path}.${ax}`);
      else out[ax] = v;
    }
    return out;
  };
  const personality = take(record.personality, PERSONALITY_AXES, 'personality', 0, 100);
  const style = take(record.style, STYLE_AXES, 'style', 0, 100);
  const valuesCentered = take(record.values_centered, VALUE_AXES, 'values_centered', -4, 4);
  if (missing.length) return reject('missing_or_invalid', { fields: missing });

  return {
    ok: true,
    data: {
      scales: { personality, style, valuesCentered },
      provenance: {
        source: 'eti_v2',
        record_ref: String(record.session_id),
        diagnosis_version: known.diagnosis_version,
        item_set_version: known.item_set_version,
        scoring_version: known.scoring_version,
        completed_at: record.completed_at ?? null,
        consent_version: consent.version ?? null,
        synthetic: record.synthetic === true,
      },
    },
  };
}
