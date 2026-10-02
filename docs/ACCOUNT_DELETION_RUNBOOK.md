# アカウント削除依頼の対応手順（手動運用）

対象：元素診断（Supabase・Kit）。当面は「削除依頼をメール／X DM で受け付け → 運営が手動で削除」で運用する。
自動削除（ボタン一つで消える仕組み）は、DB・API の設計が必要なため別段階で検討する。

## 0. 原則
- 本人確認ができるまで削除しない（なりすまし対策）。
- 依頼から **14日以内** に対応し、完了を連絡する（プライバシーポリシーに記載した目安）。
- 削除した人のデータを、同意なくリストとして持ち続けない。お知らせ配信（Kit）も削除する。
- 購入の記録（Stripe・purchase_entitlements）は、会計上・法令上必要な期間は保管する（ポリシーに記載）。
- SQL や DB の操作は運営者本人が行う。Claude のセッションは手順の案内と確認のみ。

## 1. 受付
| 経路 | 本人確認の方法 |
|---|---|
| メール（yaduns0522@gmail.com） | 送信元アドレスが、ログインに使っているメールアドレス（Supabase Users の Email）と一致すること |
| X の DM（@mondayaxad） | DM 送信元の X アカウントが、ログインに使っている X（Supabase Users の Identities に X）と一致すること |

一致しない場合は、登録しているメールアドレスから改めて連絡してもらう。

受付時の返信例：
> 削除のご依頼を受け付けました。ご本人確認のうえ、14日以内にアカウント・診断記録・お知らせ配信の登録を削除し、完了をご連絡します。

## 2. 対象ユーザーの特定（Supabase ダッシュボード）
1. Authentication → Users で、メールアドレス（または X の表示名）で検索する。
2. ユーザーの **User UID** を控える（以降の作業はこの ID で行う）。
3. Identities（Google / X / email）を確認し、依頼者本人であることを最終確認する。
4. Google と X が別々のアカウントに分かれている場合は、依頼者に「どのアカウントか／すべてか」を確認する。

## 3. 削除するもの
外部キーの設定（2026-10-02 に Table Editor で確認）：

```
auth.users ──(profiles_id_fkey: ON DELETE CASCADE)──▶ public.profiles(id)
public.profiles ──(diagnosis_sessions_user_id_fkey: ON DELETE CASCADE)──▶ public.diagnosis_sessions(user_id)
```

→ **Authentication → Users でユーザーを削除すると、`profiles`（お知らせ配信の同意）と `diagnosis_sessions`（診断記録）も自動で削除される。**
（`diagnosis_answers`・`diagnosis_results` は `diagnosis_sessions` にぶら下がる。こちらの ON DELETE は未確認。初回の削除後に、該当 session の行が残っていないか Table Editor で確認する。）

| 対象 | 場所 | 方法 |
|---|---|---|
| アカウント・プロフィール・診断記録 | Authentication → Users | 該当ユーザーの「…」→ Delete user（上記の CASCADE で一括削除） |
| お知らせ配信の登録 | Kit（Subscribers） | メールアドレスで検索し、**購読者を削除**（配信停止だけでなく削除） |
| ログインコードの送信ログ | Resend | 一定期間で自動削除されるため対応不要 |

削除後の確認：Table Editor で `profiles` と `diagnosis_sessions` を User UID で絞り込み、行が残っていないこと。

## 4. 残すもの
| 対象 | 理由 |
|---|---|
| Stripe の決済記録 | 会計・税務上の保存義務 |
| `purchase_entitlements`（購入権） | 診断コードのハッシュで管理しており、氏名・メールは含まない。会計上の記録として保管 |
| 対応記録（自分用メモ） | 受付日・対応日・User UID 先頭数文字のみ。メールアドレス等は書かない |

## 5. 完了連絡
> ご依頼いただいたアカウント・診断記録・お知らせ配信の登録の削除が完了しました。ご利用ありがとうございました。
> （有料レポートの購入記録は、法令上必要な期間に限り保管します。）

## 6. 対応記録（例）
| 受付日 | 経路 | User UID（先頭8文字） | 削除日 | Kit 削除 | 完了連絡 |
|---|---|---|---|---|---|
| 2026-10-xx | メール | xxxxxxxx | 2026-10-xx | 済 | 済 |
