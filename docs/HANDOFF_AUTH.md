# 引き継ぎ書：元素診断 Preview C ／ 認証3方式（Google・X・メールOTP）

更新：2026-10-02。2つのセッションの共有メモ。最新はこのファイル（`release-c-preview`）を `git pull` して読む。

## 0. 運用ルール（全工程共通）
- 禁止：force push・main・Production・DB変更（migration/schema/RPC/UNIQUE）・Stripe・PR操作。SQLは実行しない。
- 変更しない：診断ロジック・採点・encode/decode・保存payload・entitlement・シェアURL仕様・legacy/v2 decode。¥1,000固定。
- 秘密値（PAT・X Client Secret等）は表示しない。チャット・コード・docs・commit に書かない。
- Supabase Auth 設定は「読み取り → 差分提示 → 承認後に変更」の3段階。
- commit / push は承認後。都度 SHA・ahead/behind・status を報告。

## 1. セッションの役割分担
| | GitHub 担当セッション | Supabase 担当セッション |
|---|---|---|
| 担当 | コード・docs・commit/push、Vercel の Preview/ログ確認 | Supabase Auth 設定の読み取り・差分提示・承認後の変更、認証ログ確認 |
| 触らない | Supabase 設定 | コード・git（読むだけ） |

セッション同士は直接メッセージできない。このファイルを共有メモにし、Supabase 側の結果は利用者経由で GitHub 担当へ渡して、ここへ反映する。

## 2. リポジトリの状態
- ブランチ `release-c-preview`（Preview 用）。認証の実装は `de7256c` feat(auth)。
- 実装：
  - `js/auth-providers.js`：X（`provider: 'x'`）、6桁メールOTP（`signInWithOtp` / `verifyOtp` type `'email'`）、3方式の選択UI。`AUTH_OTP_LENGTH = 6`
  - `index.html`：未ログイン時の保存カードを3方式に。Google は既存処理のまま、X は既存関数で結果を一時保存してから `/mypage.html` へ、メールはその場でログインして保存
  - `mypage.html`：ログイン画面を3方式に。Google ボタン id `gateGoogleBtn` は維持
  - `docs/AUTH_PROVIDERS_SETUP.md`：監査・設定手順・identity linking・実機テスト項目（§5）
- テスト（旧セッションで実施）：マイページ回帰 170/170、単体 15/15（保存済み判定8・診断コード7）、偽Supabaseでの認証E2E 通過。
- 未追跡だったファイルの扱い（決定：案a）：設計 docs・SQL案・テストは commit 済み（`docs/SAVE_DEDUP_DESIGN.md`、`docs/AUTH_RETURN_TEST_PLAN.md`、`docs/sql/`（実行しない草案）、`tests/eti_v2_diagnosis_code.test.js`）。デモ2つと未採用の背景画像3つは旧セッションのクラウドコンテナにのみあり、破棄。

## 3. 接続と環境
- Claude Code 環境「supabase」：API認証情報で `api.supabase.com` に Bearer の PAT を自動付与（権限は Auth Config: Read のみ）。許可ドメイン `api.supabase.com`。環境変数は空。
- Supabase Preview プロジェクト：ref `akivoobkqcnqvdumxtmg`。`gensokouro.html` が使う `csoivksmieguzywgxbrs` は別プロジェクトなので触らない。
- Vercel：project `element-diagnosis`（`prj_hPjAy6n0D9LL6yaAtIw2fdMWsNUH`）、チーム `nmkw0322-4497s-projects`。Production は main。
  - Preview 固定URL：`https://element-diagnosis-git-release-c-preview-nmkw0322-4497s-projects.vercel.app`
  - Preview は Vercel Authentication で保護されている。
  - 環境変数（名前のみ確認）：`SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`、`STRIPE_SECRET_KEY`、`REPORT_TOKEN_SECRET`、`KIT_API_KEY` が Preview・Production とも設定済み。

## 4. Supabase Auth の現状（読み取り済み）
| 項目 | 現状 | 判定 |
|---|---|---|
| Site URL / Redirect URLs | ブランチ名入り Preview URL ＋ `/**` の1件 | OK（テストはブランチ名入りURLで） |
| Google | 有効 | OK |
| X (OAuth 2.0) | 有効・ID/Secret 設定あり・email_optional false | OK（2026-10-02） |
| Email provider | 有効・新規登録可 | OK |
| OTP 桁数 | 6 | OK（2026-10-02 変更） |
| OTP 有効期限 | 3600秒 | OK |
| Magic Link / Confirm signup テンプレート | 件名「元素診断のログインコード」、本文に `{{ .Token }}`（英文とリンクも残存。動作に影響なし。整形は後日PCで） | OK |
| Custom SMTP | Resend（`smtp.resend.com:465`、user `resend`、送信元 `noreply@mail.elementdiagnosis.com`、差出人名「元素診断｜Element Diagnosis」） | OK |
| メール送信上限 | 30通/時 | Preview は可。公開前に見直す |
| Manual linking | 有効（2026-10-02） | OK。マイページの「ログイン方法」から Google / X を連携（`685ca7b`）。実機で Google→X 連携→X ログインで同じ記録を確認済み |

## 5. 次のアクション
| # | 担当 | 内容 | 状態 |
|---|---|---|---|
| 1 | 人 | Authentication → Sign In / Providers → Email：Email OTP Length を 6 に | 済 |
| 2 | 人 | Custom SMTP（Resend）設定、Magic Link / Confirm signup に `{{ .Token }}`、件名「元素診断のログインコード」 | 済 |
| 3 | Supabase担当 | 再読み取りで 1・2 の差分解消を確認 | 済（2026-10-02） |
| 4 | 人 | ブランチ名入り Preview URL で、チームメンバー宛てにメールOTP実機テスト（`docs/AUTH_PROVIDERS_SETUP.md` §5-3）。1時間2通まで、連打・再送しない | 済（2026-10-02：メールOTPでログイン成功。Google で保存していたのと同じ記録が表示＝同一メールの identity が同じ user_id にまとまることを確認） |
| 5 | 人 | X Developer Portal：OAuth 2.0 Web App、Callback `https://akivoobkqcnqvdumxtmg.supabase.co/auth/v1/callback`、Request email from users を有効、Client ID / Secret 発行 | 済（X Console のアプリ「Element Diagnosis Login」、Read、Request email ON、Web App。Privacy/Terms は本番URL `/privacy` `/terms` を登録＝現状 main 未反映で404） |
| 6 | 人 | ダッシュボードで X / Twitter (OAuth 2.0) を有効化し ID/Secret を入力。`external_x_email_optional` は false のまま | 済（X OAuth 2.0 有効、email_optional false） |
| 7 | Supabase担当 | 再読み取りで X 有効を確認 | 済（2026-10-02 再読み取りで確認） |
| 8 | 人＋両セッション | 実機テスト（§5 全体）。Supabase担当は認証ログ、GitHub担当は Vercel のログで失敗原因を調べる | 未 |

1・2・6 を API で自動化する場合は、Auth Config を Read and write にした PAT を別に作り API認証情報を差し替える。差分提示 → 承認 → PATCH の順。

### X アプリ内ブラウザのテストについて
Preview は Vercel Authentication で保護されているため、アプリ内ブラウザでは Vercel のログイン画面で止まる。テスト前に次のどちらかを承認のうえで決める。
- 一時的な共有リンク（`_vercel_share` 付き、約23時間有効）から開く。プロジェクト設定を変えずに済むので推奨。
- プロジェクトの Protection Bypass を有効にする（プロジェクト設定の変更）。

Supabase のログイン復帰は同じホスト（ブランチ名入りURL）に戻るので続けてテストできる見込み。アプリ内ブラウザで Cookie が保たれるかは実機で確認する。

## 6. メール送信基盤（2026-10-02 決定）
- 独自ドメイン `elementdiagnosis.com` を Vercel で取得（自動更新ON、次回 2027-10-02、年11.25ドル）。サイトURLには割り当てない（メール専用）。
- Resend（Free、Tokyo）に `mail.elementdiagnosis.com` を登録。DNS（MX・SPF・DKIM）は Vercel DNS に自動設定済み、公開DNSで確認済み。
- Resend API キーは Supabase SMTP パスワードにのみ設定（チャット・リポジトリには無い）。
- 送信失敗（429・5xx）時は Google / X へ誘導する（`e1c7ac9`）。上限を超えても Google / X でログインできるため、Pro への移行は通数を見て判断。

## 6.5 2026-10-02 の追加（GitHub担当）
- `4af9ae1` 連携解除（ログイン方法が2つ以上のときだけ。確認あり。メールは対象外）→ 実機OK
- `e5fa226` プライバシーポリシー改定（メールログイン・連携/解除・削除受付）→ 文面OK。削除手順書 `docs/ACCOUNT_DELETION_RUNBOOK.md`
- アカウント削除は当面「メール／X DM で依頼 → 手動削除 ＋ Kit 購読者削除」で運用

## 7. 未解決・注意
- 削除手順書の初回確認：`diagnosis_sessions` / `profiles` の user_id 外部キー（ON DELETE）を Table Editor で確認し、手順書に追記する。
- X ログインのテストで、X 側のメールが Google と一致せず、記録のない別アカウントが作られた。その X を Google のアカウントへ連携するには、先に Supabase の Users でその空アカウントを削除する（人の操作）。
- `privacy.html` / `terms.html` は release-c-preview にのみ存在し、本番（main）では 404。X の登録に本番URLを使っているため、本番反映時に必ず含める。メールログイン・ログイン方法の連携についての追記も必要。
- X の開発者プランは Pay Per Use。ログイン時のユーザー情報取得が課金対象か、残高0でログインが失敗しないかは要確認。
- X がメールを返すか、同じメールの Google ユーザーに自動でまとまるかは実機で確認する（推測で実装を足さない）。
- 別 user_id になった場合、履歴は元のアカウントに残る。購入権は診断コードのハッシュに紐づくので消えないが、マイページにはそのアカウントで保存した分しか出ない。
- X アプリ内ブラウザでは Google がログインを拒否する可能性。メールOTPで代替できるかを確認する。
- Preview は保護されているため、X のクローラーは OGP を取得できず、OGP 背景は円環表示になる。OGP は本番で確認する。
- 公開前に、メール送信上限（30通/時）と Resend のプラン（Free は 1日100通・月3,000通）を見直す。
- `scoring_version` が空の既存保存行は「未保存」と判定される。Preview の実データで確認が必要。
