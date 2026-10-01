# ログイン方式の追加（Google ＋ X ＋ メール6桁OTP）— Preview 設定手順とテスト項目

対象：release-c-preview（Supabase テスト用プロジェクト `akivoobkqcnqvdumxtmg`）。
Production の Supabase・Vercel 本番環境・main には設定もコードも入れない。

## 1. 監査結果（現状）

| 項目 | 現状 |
|---|---|
| Supabase クライアント | `diagnosis-save.js` の `window.supabase.createClient(URL, publishable key)`。supabase-js v2（CDN `@2`）、オプション指定なし（既定の implicit フロー・`detectSessionInUrl: true`） |
| Google ログイン | `signInWithGoogle()`（diagnosis-save.js）と `signInWithGoogleV2()`（js/eti_v2_save.js）。どちらも `provider: 'google'`、`redirectTo: <origin>/mypage.html` |
| auth callback | Supabase 側 `https://akivoobkqcnqvdumxtmg.supabase.co/auth/v1/callback`。アプリ側の callback ページは無く、`/mypage.html` に戻ってきた URL のトークンを supabase-js が自動で取り込む |
| セッション復元 | supabase-js が localStorage に保存。`onAuthStateChange` の `SIGNED_IN` / `INITIAL_SESSION` で pending（`pendingDiagnosis_v1` / `pendingDiagnosis_v2`）を保存。mypage は `SIGNED_IN` で `init()` を再実行 |
| user_id 前提の処理 | 保存 RPC（`auth.uid()`）、`diagnosis_sessions` の RLS、マイページ履歴、`/api/my-entitlements`・`/api/my-report-link`（アクセストークン → `/auth/v1/user` → user_id）、結果ページの保存済み判定 |
| 購入権 | `purchase_entitlements` は **診断コードのハッシュ** が鍵（user_id ではない）。マイページは「本人が保存した診断コード」から購入状態を引く |
| メールOTP | `signInWithMagicLink()` は旧来のリンク方式（未使用）。mypage に旧 OTP 入力 UI が残っていたが `verifyEmailOtp` が未定義で無効だった |

pending の保存・マイページの再読込はどれも provider に依存しないため、X・メールを足しても既存の保存経路はそのまま動く。

## 2. 今回の実装（コード）

- `js/auth-providers.js`（新規）
  - `signInWithX()`：`provider: 'x'`（Supabase の X / Twitter OAuth 2.0）。復帰先は Google と同じ `/mypage.html`
  - `sendEmailOtp(email)`：`signInWithOtp({ email, options: { shouldCreateUser: true } })`
  - `verifyEmailOtp(email, token)`：`verifyOtp({ email, token, type: 'email' })`。ページ遷移なしでログイン
  - `renderAuthChoices(container, handlers)`：「Googleで続ける／Xで続ける／またはメールで続ける」の UI
- `index.html`（結果ページの保存カード・未ログイン時）
  - Google：従来どおり `onRecordSaveClick` → 既存の保存関数が pending を退避して Google へ
  - X：既存の `stashPendingDiagnosisV2(buildPendingV2(...))`／`stashPendingDiagnosis(...)` で Google と同じ pending を退避してから X へ。復帰後の保存は既存の `onAuthStateChange`
  - メール：コード確認でその場でログイン → そのまま通常の保存（保存直前の読み取り確認も従来どおり）
- `mypage.html`（ログイン画面）：同じ3方式。Google ボタンは既存 id `gateGoogleBtn` と `signInWithGoogle()` のまま

変更していないもの：Google ログイン関数、保存関数・RPC・payload、DB・RLS・migration、購入権 API、Stripe、`vercel.json`。

## 3. Supabase（Preview プロジェクト）の設定手順

ダッシュボード：`akivoobkqcnqvdumxtmg` → Authentication。

### 3-1. URL Configuration
- Redirect URLs に Preview の `/mypage.html` が入っていること（Google 用に設定済みのはず。X・メールも同じ URL を使う）
  - 例：`https://<preview-host>/mypage.html` または `https://*-<team>.vercel.app/**`

### 3-2. X（OAuth 2.0）
1. X Developer Portal でアプリを作成（Free で可）→ User authentication settings
   - OAuth 2.0 を有効化、App type：**Web App（Confidential client）**
   - Callback URI：`https://akivoobkqcnqvdumxtmg.supabase.co/auth/v1/callback`
   - Website URL：サイトの URL
   - メールアドレスの取得許可（Request email from users）を有効にする ※1
2. OAuth 2.0 の **Client ID / Client Secret** を控える（OAuth 1.0a の API Key / Secret ではない）
3. Supabase → Providers → **X / Twitter (OAuth 2.0)** を有効化し、Client ID / Secret を登録
   - 旧「Twitter (OAuth 1.0a)」provider は有効にしない

※1 X がメールアドレスを返さない場合、Supabase 側でログインエラーになるか、メールなしユーザーになる。どちらになるかは Preview で要確認（下の 5-3）。

### 3-3. メール（6桁OTP）
1. Providers → Email：有効。パスワードログインは UI に出さない（コードは OTP のみ呼ぶ）
2. Email OTP の桁数：**6**（プロジェクトによって既定が 6 以外のことがあるので確認）。有効期限は 600〜3600 秒程度
3. Email Templates：**Magic Link** と **Confirm signup** の両方の本文に `{{ .Token }}` を入れる
   （既存ユーザーには Magic Link、初回のアドレスには Confirm signup のテンプレートが使われる）
   - 例：「元素診断のログインコード：{{ .Token }}（10分間有効）」
4. 送信基盤（**重要**）：Supabase 内蔵のメール送信は、プロジェクトのチームメンバーのアドレスにしか届かず、1時間あたりの送信数も非常に少ない。
   - Preview の動作確認はチームメンバーのアドレスで行える
   - 一般公開（本番）前には Custom SMTP が必要。無料枠のある送信サービスもあるが、外部サービスの追加になるので別途判断

費用：Google・X・メールOTP はいずれも Supabase Free の Auth（月 50,000 MAU）の範囲。SMS は使わない。
ただし MAU 上限超過・メール送信量の増加・有料 SMTP の利用などで費用が出る可能性はある。

## 4. 既存 Google ユーザーへの影響と identity linking

- Google ログインのコード・設定は変えていないので、既存ユーザーは今までどおり同じ user_id でログインできる
- Supabase は、**確認済みの同じメールアドレス** を持つ identity を同じユーザーへ自動でまとめる（automatic linking）
  - Google（Gmail など）で保存していた人が、同じアドレスでメール OTP ログイン → **同じ user_id**（履歴・購入状態はそのまま）
  - 違うアドレスでメール OTP → **別の user_id**（新規ユーザー）
  - X：X が確認済みメールを返し、それが Google と同じなら同じ user_id。返さない／違うアドレスなら **別の user_id**
- 手動リンク（`linkIdentity`）は今回入れていない（Supabase の manual linking 設定が必要。次段階）

### 分離が起きた場合の影響
| データ | 鍵 | 別 user_id でログインしたとき |
|---|---|---|
| 診断履歴（diagnosis_sessions） | user_id | 見えない（元のアカウントに残る。消えない） |
| 結果ページの保存済み判定 | user_id | 「未保存」と表示され、保存すると新しいアカウント側に記録される |
| 購入権（purchase_entitlements） | 診断コードのハッシュ | 権利自体は失われない。ただしマイページは「そのアカウントで保存した診断」の購入状態しか表示しない |
| 購入済みレポートの再発行（/api/my-report-link） | user_id ＋ セッション | 元のアカウントでログインし直せば開ける |
| レポート URL（Stripe 決済後のトークン） | 署名付きトークン | 影響なし |

対策（UI）：マイページは「保存したときと同じアカウントでログインしてください」と案内している。

## 5. テスト項目（Preview 実機）

### 5-1. Google（既存）
- [ ] 既存の Google アカウントでマイページにログイン → 以前の履歴・購入状態がそのまま見える（user_id が変わっていない）
- [ ] 結果ページ（未ログイン）→「Googleで続ける」→ /mypage.html に戻り、その結果が保存されている
- [ ] 結果ページ（Google ログイン済み）→「この結果を診断記録に残す」→「記録しました」

### 5-2. X（新規）
- [ ] 結果ページ（未ログイン）→「Xで続ける」→ X の同意画面 → /mypage.html に戻り、その結果が保存されている
- [ ] Supabase の Users で provider が `x`、メールアドレスの有無を確認
- [ ] Google と同じメールの X アカウントなら、Google ユーザーと同じ user_id になるか（identities に google と x の両方）
- [ ] 同意画面でキャンセル → サイトに戻ってもエラー表示で止まらない

### 5-3. メールOTP（新規）
- [ ] 「メールで続ける」→ アドレス入力 → 6桁コードのメールが届く（リンクではなくコード）
- [ ] 正しいコード → その場でログイン → 結果ページなら保存まで進み「記録しました」、マイページなら一覧表示
- [ ] 誤ったコード → 「コードが正しくないか…」／期限切れコードも同じ
- [ ] 60秒後に再送できる。連続送信で 429 → 「少し時間をおいて…」
- [ ] Google と同じアドレス → Google ユーザーと同じ user_id（履歴が見える）
- [ ] iOS の「コードを自動入力」候補が出る（`autocomplete="one-time-code"`）

### 5-4. ログアウト → 再ログイン
- [ ] Google／X／メール それぞれでログアウト → 同じ方式で再ログイン → 同じ履歴が見える
- [ ] ログアウト後、別の方式（同じメール）でログイン → 同じ user_id か

### 5-5. 保存 → マイページ
- [ ] 3方式それぞれで保存した記録がマイページに出る
- [ ] 同じ結果を再表示すると「すでに診断記録に残っています」
- [ ] legacy（`?code=` の旧形式）でも3方式で保存できる

### 5-6. 購入権
- [ ] 購入済みの Google ユーザーでログイン → 購入状態・「購入済みレポートを見る」が今までどおり
- [ ] X／メールの新規ユーザーで購入 → マイページで購入済みになり、レポートが開ける（テストモードの Stripe）

### 5-7. ブラウザ
- [ ] iOS Safari：3方式すべて。OAuth から戻ったときにログイン状態になる
- [ ] Chrome（Android／PC）：3方式すべて
- [ ] X アプリ内ブラウザ：
  - Google は埋め込みブラウザを拒否する（`disallowed_useragent`）可能性が高い → その場合の表示と、メール OTP で代替できることを確認
  - X ログインがアプリ内ブラウザで完結するか
  - メール OTP：メールアプリでコードを見て、アプリ内ブラウザに戻って入力できるか（ページが再読み込みされて入力途中が消えないか）
