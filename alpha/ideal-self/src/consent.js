// 同意状態。用途ごとに区別し、既存 ETI の規約・配信同意（consent_pairs など）は流用しない。
// Phase 1 では外部AIへの送信は機能として存在しないため、同意を取る対象にもしない（常に「送信しない」）。

export const CONSENT_VERSION = 'ISA-CONSENT-0.1.0';

export const PURPOSES = {
  eti_import: {
    title: 'ETI結果の転用',
    body: '元素診断（ETI v2）の結果のうち、Big Five・STYLE・VALUES（中心化値）と、その診断・設問・採点の版だけを、5年後の自分の下書きづくりに使います。回答そのもの、診断コード、購入情報は使いません。撤回すると、取り込んだ値とそこから作った下書きを消します。',
    required: false,
  },
  memory: {
    title: '記憶の保存',
    body: 'この端末のブラウザ内にだけ、回答と下書きを保存します（サーバーには送りません）。同意しない場合は、画面を閉じると消えます。撤回すると保存分を消します。',
    required: false,
  },
  external_ai: {
    title: '外部AIへの送信',
    body: 'Phase 1 では外部AIへの送信を行いません。この機能はまだありません。将来使う場合は、提供者と保持期間を示したうえで、改めて同意を確かめます。',
    fixed: 'not_sent',
  },
};

export function initialConsents() {
  return {
    version: CONSENT_VERSION,
    eti_import: { status: 'unset' },
    memory: { status: 'unset' },
    external_ai: { status: 'not_sent' }, // Phase 1 固定。変更する操作は無い
  };
}

export function setConsent(consents, purpose, granted) {
  if (purpose === 'external_ai') throw new Error('external_ai consent is fixed to not_sent in Phase 1');
  if (!(purpose in PURPOSES)) throw new Error(`unknown purpose: ${purpose}`);
  const prev = consents[purpose].status;
  let status;
  if (granted) status = 'granted';
  else status = prev === 'granted' ? 'revoked' : 'denied';
  return { ...consents, [purpose]: { status, version: CONSENT_VERSION } };
}

export const isGranted = (consents, purpose) => consents[purpose] && consents[purpose].status === 'granted';

// 同意撤回時に、取り込んだデータと派生データをどう扱うかを判定する。
// 撤回後に旧データから作ったプロフィールを使い続けない。
export function judgeRevocation(purpose, state) {
  const actions = [];
  if (purpose === 'eti_import') {
    if (state.imported) actions.push({ target: 'imported_eti', action: 'delete', why: '撤回された用途で取り込んだ値のため' });
    if (state.current && state.current.source === 'eti_v2') {
      actions.push({ target: 'current', action: 'delete', why: 'ETI の値から作った現在像のため' });
      actions.push({ target: 'ideal_answers', action: 'keep', why: '本人が選んだ回答で、ETI の値そのものを含まないため（現在像を作り直すと選択肢の並びが変わるだけ）' });
      if (state.profile) actions.push({ target: 'profile', action: 'delete_and_regenerate', why: 'ETI 由来の観測値・保護特性候補・価値観を含むため。簡易質問か再同意で作り直す' });
      actions.push({ target: 'route', action: 'goto_current_select', why: '現在像を作り直す必要があるため' });
    } else if (state.profile) {
      actions.push({ target: 'profile', action: 'keep', why: 'ETI 由来の値を含まない（簡易質問経路）ため' });
    }
  }
  if (purpose === 'memory') {
    actions.push({ target: 'local_storage', action: 'delete', why: '保存の同意が撤回されたため' });
    actions.push({ target: 'session_state', action: 'keep_in_memory_only', why: '画面を閉じるまでは表示を続けられるが、端末には残さない' });
  }
  return actions;
}
