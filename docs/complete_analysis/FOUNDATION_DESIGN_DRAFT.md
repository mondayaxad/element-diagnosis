# 完全解析：決済・権利・生成・閲覧基盤 設計草案（第1段階・改訂1）

- 状態：**草案（DRAFT）**。DB は Preview にだけ complete_01〜complete_05 を適用済み（2026-10-07）。外部サービス未設定・コード本体は未変更。
- 基準：branch `release-c-preview` ／ baseline `8aca76db77449d4bd7fbe859bd23597474f208c7` ／ 2026-10-07
- 関連 migration（Preview 適用済み・本文は編集しない）：`docs/sql/20261007111306_complete_01_orders_entitlements_reports.sql`、`docs/sql/20261007113230_complete_02_service_role_privileges.sql`、`docs/sql/20261007205700_complete_03_mentor_goal_ownership.sql`、`docs/sql/20261007213147_complete_04_payment_transactions.sql`、`docs/sql/20261007234325_complete_05_admin_audit_log.sql`
- 戻し（草案・実行禁止）：`docs/sql/complete_99_rollback_DRAFT_DO_NOT_RUN.sql`（改訂5：complete_05 の関数・表・トリガーも明示的に削除）
- migration の番号：complete_01＝表・権利・生成物（適用済み）／complete_02＝service_role の権限を arw に縮小（適用済み）／complete_03＝MENTOR 目標の所有者整合・記録の所有者固定（適用済み）／complete_04＝決済の原子的処理・再購入禁止・旧購入権の結び付け（適用済み・20261007213147）／complete_05＝運営者操作の監査ログ・旧購入権の手動確認（適用済み・20261007234325）
- 改訂1：判断 1〜13（2026-10-07）を反映（§0）。**販売（決済の有効化）は §13 の停止条件がすべて解除されるまで行わない。**

## 0. 確定した判断（2026-10-07）

| # | 判断 | 反映先 |
|---|---|---|
| 1 | `prototypes/core1_v4_result_driven` は **COMPLETE-RC1（技術候補）**。本番の承認済み本文とは扱わない | §2、§13、DB `generator_release='COMPLETE-RC1'` |
| 2 | MENTOR は推測しない。利用者が確認済みの5目標から1つ選ぶ。選択完了前は Checkout へ進ませない | §4-4、§5-3、§7、DB `record_mentor_goals`・注文トリガー |
| 3 | goal_id・目標カタログ版・選択日時を診断記録単位で保存 | DB `record_mentor_goals`（記録ごとに1行） |
| 4 | 旧記録（MIRROR 2.0.2 等）を 2.1.0 で黙って再計算しない。版が一致しない記録は販売対象外 | §4-5、DB `complete_rc1_required_versions()`・注文トリガー・生成物 CHECK |
| 5 | 初期提供は認証必須の非公開 HTML だけ。PDF は販売表示・契約内容に含めない | DB `output_format='html'`、§6、§13 |
| 6 | 返金・失効時はアクセスを直ちに停止。生成物は非公開のまま隔離。保持期間は本番前に別途決定 | §8、DB `quarantined_at` |
| 7 | 生成物は Supabase Storage の非公開バケット、短時間の署名 URL で閲覧 | §6、§10 |
| 8 | Preview の生成は waitUntil・取り残し回収・運営者用再試行 API の3経路 | §5-2 |
| 9 | 新4テーブル案を採用。既存 ¥1,000 と record_entitlements の橋渡しを API 契約に明記。既存データはまだ移行しない | §4-3、§7 |
| 10 | Checkout Session はサーバーで作成、Webhook を支払確定の正本。まず Preview／Test だけ | §3、§7 |
| 11 | prototypes・docs・tests が Production の公開配信物に入ることを本番移行の停止条件とする | §12、§14 |
| 12 | complete_consent_01 は廃案（SUPERSEDED）。適用しない | §1-2、§付記 |
| 13 | 旧価格資料は履歴として残す。現在の価格は 解析レポート ¥1,000／完全解析 直接 ¥3,000／アップグレード ¥2,000 だけを正とする | §2、DB 金額 CHECK |

※ 新4テーブル（complete_orders／record_entitlements／stripe_webhook_events／complete_reports）に加え、判断 2・3 のために MENTOR 目標の表（record_mentor_goals）を1つ追加した。

### 0-2. 追加判断（2026-10-07・complete_01 の Preview 適用の前提）

| # | 判断 | 反映先 |
|---|---|---|
| A1 | 添付の13ページのナラティブレポート一式は **LEGACY_NARRATIVE_V1**。COMPLETE-RC1・新完全解析の本文・権利・価格に混ぜない | §2、§4-3（完全解析権を付与しない） |
| A2 | dispute 発生時は権利を**一時停止**（suspended）。勝訴で復旧、敗訴または返金確定で失効 | DB `record_entitlements.status='suspended'`・失効は最終状態、§8 |
| A3 | 生成 HTML に実名・user_id・diagnosis_session_id を入れない。表示名は「あなた」。識別子が必要なら推測困難な report_id（complete_reports.id）だけ | §5-1、§13（解除条件）、生成時の確認テスト |
| A4 | 署名 URL は初期300秒。本人確認の後に毎回発行する（使い回さない・保存しない） | §6、§7 |
| A5 | 運営者 API は Supabase JWT を検証し、環境変数 `COMPLETE_ADMIN_USER_ID`（運営者1人の user UUID）と完全一致で認可。POST のみ、監査ログ必須 | §7、監査ログ表は complete_05（適用済み） |
| A6 | MENTOR 選択画面は、対象記録の選択後・Checkout の直前に置く | §5-3、§7 |
| A7 | 旧 complete ¥2,500・旧ナラティブ・旧 CORE2 は新しい完全解析権を付与しない | §4-3、DB（完全解析権は complete_orders の支払いからだけ） |
| A8 | 価格の正本：解析レポート ¥1,000／完全解析 直接 ¥3,000／アップグレード ¥2,000 | §2、DB 金額 CHECK |

---

## 1. 現状監査表

### 1-1. Stripe 決済経路

| 項目 | 現状 | 根拠 | 評価 |
|---|---|---|---|
| Payment Link | ¥1,000（CORE1）だけ。index は `IS_PREVIEW_BUILD` で Live／Test を切替、mypage は Test を直書き。report_sample.html に旧 ¥3,000（ナラティブ）の Live 形式リンクが残存（main では削除済み、このブランチ未反映） | index.html:2647-2649、mypage.html:1016、report_sample.html:1525-1542 | 完全解析用のリンクは無い（正しい）。旧リンク残存は要整理 |
| 確定の方法 | ブラウザの戻り先 `/api/verify?session_id=` が Checkout Session を取得して権利を記録 | api/verify.js:245-260 | **Webhook なし**。戻り先に来なかった支払いは記録されない |
| Test／Live | セッション ID 接頭辞（cs_live_/cs_test_）・`livemode`・STRIPE_MODE・キー接頭辞を照合 | verify.js:80,252,265、lib/server-env.js | 良い。新 API も同じ仕組みを使う |
| Price 対応 | core1 は Live・Test とも登録。core2／complete／core2_upgrade は `price_REPLACE_ME_*` | verify.js:61-73 | 新商品（¥3,000／¥2,000）は未登録（正しい） |
| 金額照合 | `PRODUCT_EXPECTED` core1 1000／core2 2000／complete 2500／core2_upgrade 1500 | verify.js:86-91 | 旧商品の定義。新商品へ流用しない |
| client_reference_id | 診断コード（v2 は `v2_` 付き）。クライアントが付ける | verify.js:108-115、mypage.html:1099-1104 | 記録（session）ではなくコードに紐づく |
| Checkout Session ID | `purchase_entitlements.stripe_checkout_session_id` UNIQUE | DB 制約 | 同じ決済の二重記録は防げる |
| 二重決済防止 | **なし**（同じ診断コードで何度でも決済できる） | verify.js:185-188 | 新商品では決済前に必ず止める |
| 返金・失効・dispute | **なし**（status は 'active' のみ、CHECK でも active 固定） | verify.js:213、DB CHECK | 新設が必要 |

### 1-2. 既存 DB（Preview `qelqehkigydgrwedbgtr`、読み取りのみで確認）

| 表 | 要点 | GRANT（anon／authenticated） | RLS |
|---|---|---|---|
| purchase_entitlements | 診断コードのハッシュ単位。product_type CHECK＝core1/core2/complete/core2_upgrade。status CHECK＝active のみ。Checkout ID UNIQUE。Preview は `cs_test_` のみ。**session 単位の一意性なし** | **ALL（SELECT/INSERT/UPDATE/DELETE/TRUNCATE ほか）** | 有効・ポリシーなし |
| report_snapshots | diagnosis_code UNIQUE（session 単位ではない）。どこからも使われていない | ALL | 有効・ポリシーなし |
| diagnosis_sessions | client_session_id UNIQUE、user_id FK（profiles, cascade）、(user_id, completed_at) 索引 | ALL | 本人だけ SELECT／INSERT |
| diagnosis_results／answers | session_id UNIQUE（1記録1行）。版の列（diagnosis/item_set/scoring/translation/character_profile/mirror_model/report_logic/template）あり | ALL | 本人だけ |
| profiles | onboarding 列追加済み（onboarding_01） | ALL | 本人だけ SELECT／UPDATE（同意列はトリガーで保護） |
| Storage | **バケット 0** | — | — |
| 拡張 | supabase_vault のみ。**pg_cron／pg_net／pgmq なし** | — | — |

**GRANT と RLS の二層評価（重要）**：既存の公開表は RLS が有効でも、anon・authenticated に表レベルの全権限（TRUNCATE を含む）が付いている。
- 行の読み書きは RLS（ポリシーなし＝0行）で止まるが、**TRUNCATE は RLS の対象外**。PostgREST から TRUNCATE は発行できないため現時点で直接の経路は見当たらないが、防御が一層しかない状態。
- RLS が誤って無効化されたり、緩いポリシーが追加されたりした瞬間に全行が露出する。
- → **既存表の GRANT 是正は 0009 権限強化の別課題**として扱い、この草案には混ぜない（指示どおり）。新しい表は最初から「GRANT なし＋RLS 有効・ポリシーなし」の二層にした。

完全解析関連の草案テーブル：`docs/sql/complete_consent_01_migration_DRAFT_DO_NOT_RUN.sql` Part B（complete_analysis_entitlements）。
- user_id／session FK が **cascade**（アカウント削除で購入記録が消える）、GRANT なし、updated_at なし、Webhook・注文の概念なし。
- **Part A は適用済みの onboarding_01 と衝突**する。別名の CHECK が subscribe.js の書く `'skipped'` を拒否する。列の設計も食い違い、権限方針も逆。→ **complete_consent_01 は全体を廃案扱い**とし、今回の complete_01 草案で置き換える。

### 1-3. 既存 API と UI の期待

| API | 入力 | 確認 | 出力 | 課題 |
|---|---|---|---|---|
| verify | `?session_id=` | Checkout 取得・paid・Price・金額 | 302 → report.html?token=（100年・HMAC・コード暗号化） | 戻り先依存、Webhook なし |
| report-data | `?token=` | 署名・期限・env・ハッシュ単位の権利 | `{diagnosis_version, entitlements:{core_analysis_access, journey_report_access}, purchase, code?}` | 完全解析権から analysis を導く処理なし。report.html は `core_complete_access` だけでも閲覧可とするが API は返さない（食い違い） |
| my-report-link | POST `{diagnosis_session_id}`（snake） | 本人・記録→コード→ハッシュ・core1/complete | `{url, expires_in:900}` | — |
| my-entitlements | GET（Bearer） | 本人の記録→コード→ハッシュ | `{purchased_by_version:{"ETI-2.0:<code>":true}}` | 記録単位ではない。complete を区別しない |
| （未実装）my-complete-report-link | mypage は POST `{diagnosisSessionId}`（**camel**）を送る | — | `{url}` を期待 | 新設。camel／snake 両方受ける |

UI の状態モデル（complete-analysis.js）：`entitlementStatus / analysisAccess / completeAccess / completeStatus(none|generating|ready|failed) / diagnosisSessionId / completeReportUrl`。`CA_COMPLETE_API_READY=false`、`CA_COMPLETE_SALES_OPEN=false`。

### 1-4. 生成物

| 項目 | 結果 |
|---|---|
| 生成元 | `prototypes/core1_v4_result_driven/`（46p HTML、正本エンジン6ファイルを SHA-256 一致で読み込み、版は ETI-2.0／CHAR-2.1.0／MIRROR-2.1.0 に固定、テスト55件） |
| 保存データだけで作れるか | **計算は可能**（answers_v2／encoded_answers と版が保存済み。エンジンで再計算する）。ただし **MENTOR の目標（mentor_goal）と display_name の入力元が無い**。mentor_goal が無いと MENTOR は0名（販売表示「10名」と矛盾） |
| HTML か PDF か | 生成物は HTML（1件 約670KB、画像 base64 埋め込み）。PDF は Playwright／Chromium の別工程（サーバーに無い） |
| 生成時間 | ローカル実測で1件 35〜63ms（計算＋描画）。Vercel Function で十分速い |
| Vercel で動くか | 計算・HTML 生成は可能な見込み。`js/`・`src/content`・`assets`・`vendor` の同梱設定と、動的評価（new Function・require）の動作確認が必要。**サーバーで PDF を作るのは不可**（Chromium なし） |
| 非同期ジョブ | HTML のみなら同期でも間に合うが、「Webhook で重い生成をしない」「失敗しても権利は残る」「再試行」の要件から、**状態を持つキュー方式**にする（§5） |
| 版の凍結 | スナップショット（answers_hash・版・engine の sha256・content/template 版）はある。**content JSON とテンプレートの内容ハッシュが入っていない**（文面を変えても版名が変わらないおそれ）。HTML コメントに session_id を埋め込む |
| 公開範囲 | Preview では `prototypes/` が静的に配信されている（確認済み・Vercel 認証の内側）。main には無い。**このまま main へ入れると内容辞書・試験データ・docs・tests が公開される** |

---


## 2. 資料の競合と正本の扱い

| 対象 | リポジトリ内の状況 | 扱い（判断 1・13） |
|---|---|---|
| `prototypes/core1_v4_result_driven/` | 46p HTML。正本エンジン6ファイルを SHA-256 一致で読み込み。ETI-2.0／CHAR-2.1.0／MIRROR-2.1.0 に固定。テスト55件 | **COMPLETE-RC1（技術候補）**。承認済みの本文ではない |
| `core1_complete_report_v4_46p` 系・承認原本 `core1_v4_revised_46p.html` | リポジトリにも git 履歴にも無い | 照合できない。§13 の解除条件で取り込む |
| `CLAUDE_COMPLETE_ANALYSIS_AND_KIT_INTEGRATED_INSTRUCTIONS_2026-10-06.*` | 無い | 同上 |
| `ETI_COMPLETE_REPORT_BUILD_SPEC_20261003.*` | 無い | 同上 |
| CORE2（旅路）本文 | 無い | 旧商品。今回の完全解析と別物 |
| 旧価格（complete ¥2,500／core2_upgrade ¥1,500／core2 ¥2,000） | verify.js・設計メモ等に残る | **履歴として残す**。今回の商品へ読み替えない |
| Kit の任意チェック方式 | 旧設計メモ §4 | 現行の登録時一括同意が正。旧メモは更新対象 |
| 13ページのナラティブレポート一式（添付・リポジトリ外） | 旧 ¥3,000 ナラティブ販売欄の商品 | **LEGACY_NARRATIVE_V1**。新完全解析の本文・権利・価格に混ぜない（A1） |
| complete_consent_01 草案 | Part A は onboarding_01 と衝突 | **SUPERSEDED・適用しない**（complete_01 で置換） |

**現在の価格（これだけを正とする）**：解析レポート ¥1,000／完全解析の直接購入 ¥3,000／解析レポート購入済みからのアップグレード ¥2,000。DB の CHECK で direct=3000・upgrade=2000 以外を拒否する。

---

## 3. 構成図（決済・権利・生成・閲覧）

```
[mypage／結果ページ]  完全解析の欄（販売開始までは「準備中」で押せない）
   │ ① MENTOR の目標を5つから選ぶ（未選択なら購入ボタンは出ない）
   ▼
POST /api/select-mentor-goal ── 認証・本人の記録・販売対象（版一致）・ロック前 → record_mentor_goals
   │
   │ ② 購入（direct ¥3,000／upgrade ¥2,000）
   ▼
POST /api/create-complete-checkout ── 認証・本人・onboarding・環境・STRIPE_MODE・版一致・MENTOR 選択済み
   │   権利状態から offer を検証 → complete_orders（目標を写す・冪等キー）→ Checkout Session（サーバーで作成）
   ▼
[Stripe Checkout] ──支払い──▶ [Stripe] ──③ Webhook（署名付き）──▶ POST /api/stripe-webhook
   │ success_url（表示だけ。権利は付与しない）          raw body＋Stripe-Signature＋STRIPE_WEBHOOK_SECRET で検証
   ▼                                                    stripe_webhook_events（重複配送を除く）
mypage「お支払いを確認しています」                    complete_orders=paid、record_mentor_goals をロック
   │ ⑥ ポーリング                                      record_entitlements（analysis／complete）
   ▼                                                    complete_reports=queued（版・内容ハッシュ・目標を凍結）
GET /api/my-entitlements（記録単位）                   → すぐ 200 → waitUntil でワーカーへ合図
   │   （本人の取り残し queued があれば1件回収）
   ▼
生成ワーカー（内部 API）claim → 46p HTML（RC1）→ 非公開 Storage → ready／failed（再試行）
   ▲ 運営者の再試行 API（failed → queued）
   │
POST /api/my-complete-report-link ── 本人・complete 権 active・ready・同じ記録・revoked でない
   → 短時間の署名 URL（Storage・非公開バケット）
```

---

## 4. DB 設計（草案 SQL：`complete_01_..._DRAFT_DO_NOT_RUN.sql`）

### 4-1. 既存表を拡張する案 vs 新しい表に分ける案（判断 9：新表を採用）

| 観点 | A：purchase_entitlements を拡張 | B：新しい表に分離（採用） |
|---|---|---|
| 権利の単位 | 診断コードのハッシュ（同じコードの別記録へ権利が流れる） | diagnosis_session_id |
| 既存 CHECK | product_type・status（active のみ）を緩める必要。旧4商品と混ざる | 旧表に触れない（旧商品を凍結） |
| 既存コード | verify・report-data・my-entitlements・my-report-link の全経路を再確認 | 既存経路は無変更、新経路だけ追加 |
| 注文・Webhook・生成・MENTOR | 1表に詰め込み状態が混ざる | 別の事実として持てる |
| 権限 | 既存表の広い GRANT を引き継ぐ | GRANT なし＋RLS の二層 |
| 戻し | 既存データに影響 | 新しい表を消すだけ（支払済みが無い間） |

### 4-2. 表と一意制約

| 表 | 役割 | 主な制約 |
|---|---|---|
| record_mentor_goals | 記録ごとの MENTOR 目標（goal_id・カタログ版・選択日時・ロック日時） | PK＝diagnosis_session_id（記録ごとに1つ）。カタログ版 `CORE1-MENTOR-GOALS-1.0.0` と5目標以外を拒否。**ロック後は変更・解除不可**（トリガー） |
| complete_orders | 購入 intent／注文（offer・金額・test/live・状態・目標の写し・upgrade の根拠・Checkout／PaymentIntent・冪等キー） | Checkout ID・PaymentIntent・冪等キー UNIQUE。**記録ごとに決済待ち・支払済みは1つ**。金額＝offer で固定。upgrade は根拠必須。**作成時トリガーで「本人・登録完了・版一致・MENTOR 選択済みで注文の値と一致」を確認** |
| record_entitlements | 記録単位の権利（analysis／complete、active／revoked、失効理由） | (user, 記録, 権利) の active は1つ。(注文, 権利) UNIQUE。失効は理由と日時が必須 |
| stripe_webhook_events | Webhook 受信記録（本文なし） | event_id が PK。Preview は livemode=false のみ |
| complete_reports | 生成物（状態・試行・失敗コード・再試行・貸出し・凍結した版・内容ハッシュ・目標・非公開パス・出力ハッシュ・隔離日時） | 記録ごとに有効な生成物は1つ。(記録, RC, content_sha256, template_sha256, input_sha256) UNIQUE。**版は RC1 と一致のみ**。**HTML のみ**。ready は保存先と出力ハッシュ必須。**生成物がある失効は隔離日時必須** |

- 権限：新しい5表は `revoke all from public, anon, authenticated`、service_role に SELECT／INSERT／UPDATE だけ（DELETE なし）。RLS 有効・ポリシーなし。関数も anon・authenticated から EXECUTE を外す。
- FK は restrict（アカウント削除で購入記録が黙って消えない。削除手順は §8・未決事項）。
- 既存表の広い GRANT は混ぜない（0009 権限強化の別課題）。

### 4-3. 既存 ¥1,000 の権利との橋渡し（判断 9。既存データは移行しない）

解析権（analysisAccess）は次の **OR** で求める（読み取り時に導出、どこにも書き写さない）：

1. **旧 ¥1,000（purchase_entitlements）**：記録 → `diagnosis_answers.encoded_answers`（＝診断コード）→ 参照値（v2 は `v2_<code>`）→ SHA-256 → `purchase_entitlements` の `diagnosis_code_hash` 一致かつ `status='active'` かつ `product_type in ('core1','complete')`（現行の my-entitlements・my-report-link と同じ規則。旧 complete ¥2,500 も解析権を含む）。
2. **新（record_entitlements）**：同じ記録・同じ本人の `right_type in ('analysis','complete')` かつ `status='active'`（完全解析権があれば解析権も成立）。

完全解析権（completeAccess）は **record_entitlements の complete（active）だけ**。旧 complete ¥2,500（CORE1＋CORE2）・旧ナラティブ（LEGACY_NARRATIVE_V1）・旧 CORE2 は完全解析権に**ならない**（A7。新しい権利は complete_orders の支払いからだけ成立する）。suspended（dispute 中）の権利では閲覧できない。

注意点（仕様として明記）：
- 旧 ¥1,000 は診断コード単位のため、同じ回答コードを持つ本人の別記録にも解析権が及ぶ（現行と同じ挙動。変えない）。完全解析権は記録単位で、別記録へ流れない。
- upgrade の根拠は、Checkout 作成時に上の 1 または 2 で確認し、どちらで確認したかを注文の `analysis_basis` に記録する（`legacy_purchase_entitlement`／`record_entitlement`）。
- 旧 ¥1,000 の返金処理は今は無い（Webhook なし）。旧の解析権が後から失効しても、支払済みの完全解析権は取り消さない（完全解析権は別の支払いで成立したため）。
- 移行（旧行を record_entitlements へ写す）は行わない。将来行う場合は別の判断・別 migration。

### 4-4. MENTOR 目標の保存（判断 2・3）

- 5目標（`CORE1-MENTOR-GOALS-1.0.0`）：GOAL_VISIBLE_01／GOAL_BOUNDARY_01／GOAL_RELATION_01／GOAL_EXPLORE_01／GOAL_PACE_01（文面・deltas は `prototypes/.../src/content/mentor-goals.json`）。
- 結果から自動で選ばない。選択は本人の明示操作だけ（API 経由。ブラウザから表へ直接書けない）。
- 記録ごとに1つ。支払い前は選び直せる。支払い確定（Webhook）で `locked_at` を入れ、以後は変更不可。
- 注文作成時に目標を注文へ写し、DB トリガーで記録の選択と一致することを確認する。生成は注文（＝生成物に写した値）の目標を使う。
- complete_03（Preview 適用済み・20261007205700）：目標の user_id が記録の所有者と一致することを DB で保証する（INSERT・UPDATE のたび。記録の user_id は変更不可。他人の記録と存在しない記録は同じ誤り `mentor_goal_record_not_found`）。決済待ち・支払済みの注文がある間の目標変更を拒否（`mentor_goal_checkout_in_progress`）。同じ目標の再送では `selected_at` を動かさない（冪等）。支払後の変更は complete_01 の `mentor_goal_locked` のまま。
- カタログを改訂するときは新しい版名（例：1.1.0）として追加し、旧版の注文・生成物は旧版のまま。

### 4-5. 販売対象の判定（判断 4）

販売・生成の対象は、保存済みの `diagnosis_results` の6つの版が RC1 の要求と**完全に一致**する記録だけ。

| 版 | RC1 の要求 |
|---|---|
| diagnosis_version | ETI-2.0 |
| item_set_version | ETI-ITEM-2.0.0 |
| scoring_version | ETI-SCORE-2.0.0 |
| translation_model_version | ETI-TRANS-2.0.0 |
| character_profile_version | ETI-CHAR-2.1.0 |
| mirror_model_version | ETI-MIRROR-2.1.0 |

- 旧 MIRROR 2.0.2・旧 CHAR 2.0.1・旧版（element-v1）・保存結果の無い記録は**販売対象外**（2.1.0 で黙って再計算しない）。UI は「この記録は完全解析の対象外です」と示し、購入導線を出さない（現行の旧版記録と同じ扱い）。
- 判定は API（`create-complete-checkout`・`select-mentor-goal`・`my-entitlements` の `completeEligible`）と DB（`complete_rc1_required_versions()`・注文トリガー・生成物 CHECK）の二層。

---

## 5. 生成基盤

### 5-1. 状態遷移（生成物）

```
（行なし＝none）
   └─ Webhook で支払い確定 → 権利付与 → complete_reports: queued（版・内容ハッシュ・目標を凍結）
queued ──claim──▶ generating ──成功──▶ ready
                      │                    └─ refund／dispute 敗訴／manual ─▶ revoked（閲覧停止・隔離）
                      └─失敗──▶ failed ──next_retry_at 経過・attempts<max──▶ generating
                                      └─ attempts=max → failed のまま（運営者の再試行待ち）
generating（貸出し期限切れ）──claim で回収──▶ generating
```

- 購入成功と生成完了は別の事実。生成に失敗しても権利は失わない。
- 同じ記録・同じ RC・同じ内容ハッシュ・同じ入力は1行。再試行は同じ行を進める（同じ結果に収束）。
- 凍結：版6種・content/template の版と**内容ハッシュ**・入力ハッシュ・MENTOR 目標。キャラクター座標や文面の更新後も、購入済みの生成物は差し替えない（作り直しは運営者の明示操作だけ）。
- 生成 HTML に**実名・user_id・diagnosis_session_id を入れない**（A3）。表示名は「あなた」。識別子が必要なら complete_reports.id（推測困難な乱数）だけ。生成直後に「HTML に user_id・session_id・メールアドレスが含まれない」ことを機械的に確認し、含まれていれば failed にする。
- ログ：event_id・注文 ID の末尾、状態、エラーコードだけ。生回答・診断コード・メール・トークン・Storage パスは出さない。

### 5-2. 生成ジョブの3経路（判断 8。pg_cron・pg_net・pgmq なし、新サービスなし）

| 経路 | 内容 | 役割 |
|---|---|---|
| ① waitUntil | Webhook が 200 を返した後、同じ実行の残り時間で内部ワーカーを起動 | 通常の経路（すぐ ready） |
| ② 取り残し回収 | my-entitlements・my-complete-report-link が、本人の queued・期限切れ failed・貸出し切れ generating を1件だけ claim して生成 | ①が失われた場合の回収（本人の再訪時） |
| ③ 運営者の再試行 API | `POST /api/admin/complete-report-retry`（運営者の秘密＋環境ガード）。`failed → queued`、または queued の即時処理 | 上限到達・調査後の再試行。利用者が来なくても進められる |

- 参考（今回は使わない）：Vercel Cron（プランの頻度制限を要確認・vercel.json 変更）、Supabase pg_cron＋pg_net（拡張の有効化が必要）、外部キュー（新サービス）。
- 生成時間は1件100ms未満の見込み（ローカル実測）。貸出し期限（既定120秒）で多重実行と停止を防ぐ。

### 5-3. MENTOR 目標と販売の状態遷移

```
[記録] ─版一致？─ No ─▶ 販売対象外（購入導線なし）
   │Yes
   ▼
対象記録を選ぶ（右上の入口・記録内の導線）→ MENTOR 選択画面（Checkout の直前。A6）
目標未選択 ──本人が5つから選ぶ──▶ 目標選択済み（選び直し可）
   │（購入ボタンは出さない）            │ create-complete-checkout（目標を注文へ写す）
   │                                    ▼
   │                               決済待ち（checkout_open）──期限切れ・失敗──▶ 目標選択済みへ戻る
   │                                    │ Webhook paid
   │                                    ▼
   │                               支払済み：目標ロック（変更不可）→ 生成（§5-1）
```

---

## 6. 保存と閲覧（判断 5・7）

- 形式：認証必須の非公開 HTML だけ（PDF は販売表示・契約内容に含めない）。
- 保存先：Supabase Storage の**非公開バケット**（手動作成。公開にしない）。パスは `complete/<env>/<ランダムID>.html`（session ID・ユーザー ID を含めない）。パスは DB だけに持ち、応答・ログに出さない。
- 閲覧：`POST /api/my-complete-report-link` が本人確認の後に**毎回**、**300秒の署名 URL** を発行して返す（A4）。使い回さない・DB やブラウザに保存しない。期限が切れたら取り直す。
- 失効時：権利の状態で API が直ちに拒否する（署名 URL は短時間のため、発行済みのものも短時間で無効）。生成物は削除せず**非公開のまま隔離**（`quarantined_at`。可能なら隔離用のパスへ移す）。保持期間は本番前に決定。
- 完全解析の購入者の解析レポート：report-data／my-report-link を §4-3 の OR で判定するよう拡張し、`core_analysis_access` を返す。

---

## 7. API 契約案

### POST /api/select-mentor-goal（新規）
- 入力：`{ "diagnosisSessionId": "...", "goalId": "GOAL_VISIBLE_01" }`（カタログ版はサーバーが決める）
- 確認：認証、本人の記録、販売対象（§4-5）、onboarding 完了、目標がカタログにある、ロックされていない。
- 出力：`{ "goalId": "...", "goalCatalogVersion": "CORE1-MENTOR-GOALS-1.0.0", "selectedAt": "...", "locked": false }`
- 誤り：401／404／409 `mentor_goal_locked`／422 `unknown_goal`／403 `not_eligible`、`onboarding_required`。

### GET /api/mentor-goals（任意・新規）
カタログ（goal_id・label・keep_phrase）を返す。deltas・borrow は返さない（表示に不要）。

### 決済 API の実装（2026-10-08・Preview 限定・販売は閉じたまま）

実装：`api/complete-checkout.js`・`api/stripe-webhook.js`・`api/complete-status.js`・`lib/complete-payment.js`・`lib/complete-materials.json`（＋`scripts/complete-materials.js`）。DB は complete_04 の SQL 関数だけで更新する。Production（と環境不明）ではすべて 404 `not_available`（外部へ接続しない）。

必要な環境変数（名前だけ。Preview にだけ設定する。値はチャット・ログ・コードに出さない。2026-10-08 時点では未設定）：
`COMPLETE_SALES_OPEN`、`COMPLETE_CHECKOUT_ORIGIN`、`STRIPE_COMPLETE_PRICE_DIRECT`、`STRIPE_COMPLETE_PRICE_UPGRADE`、`STRIPE_COMPLETE_WEBHOOK_SECRET`。

#### POST /api/complete-checkout
- 販売の開始：`COMPLETE_SALES_OPEN` が文字列 `true` のときだけ動く。未設定・それ以外は 503 `sales_closed`（認証・DB・Stripe に接続しない）。
- 戻り先：`COMPLETE_CHECKOUT_ORIGIN` から作る（Host・X-Forwarded-Host は使わない）。
  - https の origin だけを認める：userinfo・port・path（末尾の `/` を含む）・query・fragment・前後の空白を拒否する。
  - Preview で許可した固定 origin（`https://element-diagnosis-git-release-c-preview-nmkw0322-4497s-projects.vercel.app`、`lib/complete-payment.js` の `PREVIEW_CHECKOUT_ORIGINS`）と一致しなければ 503（fail-closed）。
  - Price の環境変数が無い・形式違反のときも 503。
- 確認の順：環境 → 販売開始・設定 → 認証（Bearer を `/auth/v1/user` で検証）→ 入力 → 本人の記録・登録完了・RC1・MENTOR 選択・再購入禁止。
- 入力：`{ "diagnosisSessionId": "<uuid>" }` だけ。金額・Price・user ID・目標 ID・offer などの項目が付いていれば 400。
- offer はサーバーが決める：有効な解析権または旧購入権の結び付けがあれば upgrade ¥2,000、無ければ direct ¥3,000。
- 旧 ¥1,000 の購入（診断コードのハッシュ一致）が未結び付けの場合：
  - 購入時の Checkout Session を Stripe から取り直し、購入時メールと Auth の**確認済み**メールを照合する（大文字小文字・前後の空白を無視）。
  - 一致すれば complete_04 の `complete_bind_legacy_purchase`（`stripe_email_verified`）で結び付けて upgrade にする。
  - 不一致・Auth のメールなし／未確認・Session を取得できない・未払い・別の記録へ結び付け済みは、409 `legacy_purchase_verification_required`（¥3,000 へ誘導しない。運営者の手動確認へ）。
  - メールは DB・ログに保存しない。
- 注文：`complete_create_order`（記録ごとに直列化。決済待ちの注文があればそれを返す）。
- Price：Stripe から取得して、有効・JPY・3000／2000・Test（livemode=false）・一回払いを照合する。違えば注文を canceled にして 503。
- Checkout Session：
  - カードだけ。customer_email・customer・client_reference_id は渡さない。
  - metadata は `order_id`・`app`・`env` の3つだけ。
  - Stripe の Idempotency-Key は `complete-checkout-<注文 ID>`（二重クリック・並行要求でも Session は1つ）。
- Session を作った後に `complete_mark_checkout_open` が失敗した場合は 503 を返す。次の要求で同じ注文・同じ Idempotency-Key から同じ Session を回収する。
- Stripe の一時的な失敗（通信・5xx・429・処理中の Idempotency-Key）は注文を残して 503。恒久的な失敗は注文を failed にして 502。
- 出力：`{ checkoutUrl, offer, amount }`。
  - `checkoutUrl` は Stripe が返した決済画面の URL。https・正規ホスト `checkout.stripe.com`・userinfo／port なしのときだけ返す（違えば 500）。
  - Session ID を含むが、決済画面へ移るために返す（2026-10-08 承認）。ログには出さない。
- 誤り：401 `not_authenticated`／400／404 `record_not_found`／403 `onboarding_required`／422 `not_eligible`／409（`mentor_goal_required`、`repurchase_not_allowed`、`legacy_purchase_verification_required`、`checkout_in_progress`、`offer_changed`）／503。

#### POST /api/stripe-webhook
- Bearer 認証は使わない。生のリクエスト本文（`req` のストリームから読む。`req.body` は使わない）と `Stripe-Signature` だけで検証する。
  - 秘密値は `STRIPE_COMPLETE_WEBHOOK_SECRET`。HMAC-SHA256、許容 300 秒、定数時間で比較。
  - 署名なし・形式違反・時刻外れ・不一致は 400。秘密値が無ければ 503（fail-closed）。
- Preview の Test のイベントだけを扱う。Live のイベント・対象外のイベント・完全解析でない Session（旧 ¥1,000 など）は DB に書かずに 200。
- **`COMPLETE_SALES_OPEN=false` でも停止しない**（返金・dispute を処理するため）。
- イベント本文の値は信用しない。Checkout Session・Charge・Dispute を Stripe から取り直して判断する。

  | イベント | 処理（complete_04 の関数） |
  |---|---|
  | `checkout.session.completed` | Session の金額・通貨・支払い状態・Price（注文の offer の Price・1行・数量1）・metadata を確かめて `complete_apply_payment`：注文 paid・MENTOR ロック・権利・`complete_reports` queued を同時に作る |
  | `checkout.session.expired` | Stripe 上で expired のときだけ `complete_apply_checkout_expired`（違えば 500 で再送） |
  | `charge.refunded` | Charge の返金額で `complete_apply_refund`（一部は記録だけ、全額で refunded・権利と生成物を revoked） |
  | `charge.dispute.created`・`charge.dispute.closed` | Dispute の状態で `complete_apply_dispute`（opened／won／lost）。閉じていない closed は ignored |

- 生成素材のハッシュ：
  - 本文素材・テンプレートは、サーバー専用の `lib/complete-materials.json` に固定したハッシュを使う（静的公開しない）。
  - 素材を変えたら `node scripts/complete-materials.js` で作り直す。試験が元の素材との不一致を検出する。
  - 入力のハッシュは、保存済みの回答・6つの版・注文に固定した MENTOR 目標から計算する。ブラウザから受け取ったハッシュは使わない。
- 応答：
  - 処理済み・重複・恒久的な不一致（金額・Price・metadata・livemode）は 200（不一致は ignored）。
  - `complete_retry_later`、Stripe・DB の一時的な失敗、想定外の例外は failed を記録して 500（Stripe が再送し、failed のイベントは処理し直す）。
- **生成器が未実装の間は、支払い確定後も `complete_reports` は queued まで**（生成処理を起動しない。waitUntil も未使用）。
- 応答に Stripe ID を出さない（`{ received, result }` か `{ error, incident_id }` だけ）。

#### GET /api/complete-status
- 確認の順：環境 → 認証 → 入力（`diagnosisSessionId`）→ 本人の記録。他人の記録と存在しない記録は同じ 404。
- 出力：`{ salesOpen, order: {status, offer, amount}|null, entitlements: {analysis, complete}, report: {status}|null, mentorGoal: {goalId, goalCatalogVersion, locked}|null }`。
- Stripe ID・保存パス・メール・診断コード・注文 ID・user ID は返さない。
- 署名 URL の発行（POST）は、Storage と閲覧機能の工程で追加する。

#### ログ
- 「API 名・理由コード・照合 ID」の1行だけ（例：`stripe-webhook error: db_error 0123456789ab`）。環境ガードの拒否は従来の JSON。
- URL・query・署名・メール・Stripe ID 全文・user ID・記録 ID は出さない（試験でログの全行を検査）。

#### 検証（2026-10-08・ローカル）
- 決済 API の試験 32件（外部通信はすべて偽物）：
  - 偽の DB の模型で合格。
  - ローカル PG17 に complete_01〜05（適用済みの本文）を入れた DB で、本物の SQL 関数に対しても合格。
- 不具合を入れた9種類の変更（署名・時刻・customer_email・メール照合・販売フラグ・Idempotency-Key・応答の ID・イベント本文の信用・500→200）はすべて試験で検出。
- 署名方式は Stripe 公式 SDK（17.7.0）と相互に一致。
- `@vercel/nft` でバンドルを解析：Checkout・Webhook には lib・素材ハッシュ JSON・stripe が入り、docs・tests・scripts・素材の CSS や画像は入らない。
- Vercel の関数の本数：本数だけでは止めない。Preview の build の成功を正とし、上限エラーが出た場合だけ統合を再設計する（2026-10-08 判断）。

### GET /api/my-entitlements（v2・後方互換）
```json
{
  "purchased_by_version": { "ETI-2.0:<code>": true },
  "entitlementStatus": "ok",
  "records": {
    "<diagnosisSessionId>": {
      "analysisAccess": true,
      "analysisSource": "legacy_purchase_entitlement",
      "completeAccess": false,
      "completeEligible": true,
      "completeStatus": "none",
      "completeReportReady": false,
      "mentorGoal": { "goalId": "GOAL_VISIBLE_01", "goalCatalogVersion": "CORE1-MENTOR-GOALS-1.0.0", "selectedAt": "...", "locked": false }
    }
  }
}
```
- `analysisAccess`：§4-3 の OR。`analysisSource`：`legacy_purchase_entitlement`／`record_entitlement`／`null`。
- `completeAccess`：record_entitlements の complete（active）だけ。true なら analysisAccess も true。
- `completeEligible`：§4-5 の版一致。`completeStatus`：none／queued／generating／ready／failed／revoked。
- `mentorGoal`：未選択なら null。
- 確認に失敗したら 5xx（ok にしない）。UI は unknown（free と扱わない）。`purchased_by_version` は残す（現行 UI・テスト互換）。
- 副作用：本人の取り残しジョブを1件回収（§5-2 ②）。応答時間に影響させない（waitUntil）。

### POST /api/my-complete-report-link（新規）
- 入力：`{ "diagnosisSessionId": "..." }`（互換のため `diagnosis_session_id` も受ける）
- 確認：本人・complete 権 active・生成物 ready・同じ記録・revoked でない。
- 出力：`{ "url": "<署名URL>", "expires_in": 300 }`
- 誤り：401／404／403 `not_entitled`／409 `not_ready`・`revoked`。

### POST /api/admin/complete-report-retry（運営者用・内部。A5）
- **POST のみ**（他のメソッドは 405）。
- 認可：`Authorization: Bearer <Supabase JWT>` を `/auth/v1/user` で検証し、得られた user id が環境変数 `COMPLETE_ADMIN_USER_ID`（運営者1人の user UUID。Preview と Production で別の値を設定）と**完全一致**するときだけ許可。一致しなければ 403（存在を明かさない）。
- 入力：`{ "reportId": "...", "action": "requeue" | "process_now", "reasonCode": "..." }`（自由記述の理由は受け取らない。理由コードは生成再試行の migration で決める）。
- 処理：`failed → queued`（attempts を戻す）または queued の即時処理。
- **監査ログ必須**：誰が・いつ・どの report／order に・何をしたか・理由・結果を記録してから応答する。監査ログを書けなければ処理しない。監査ログ表（`complete_admin_audit_log`）は **complete_05**（Preview 適用済み 20261007234325）。生成物の状態を戻す SQL 関数は、生成 API の実装時に別の migration で追加する（監査ログの操作種別 `report_requeue`・`report_process_now` と理由コードも、その migration で同時に追加する。complete_05 には含めない）。

### 決済の確定方針と complete_04（2026-10-07 決定・Preview 適用済み 20261007213147）

| 項目 | 決定 |
|---|---|
| 決済方法 | 初期リリースはカードだけ（非同期決済の「入金待ち」状態は作らない） |
| MENTOR 変更 | created・checkout_open・paid・disputed は禁止。expired・failed・canceled は選び直し可（complete_03） |
| 返金・敗訴後 | 同じ記録の再購入は不可（`complete_repurchase_not_allowed`）。権利 revoked・生成物 revoked＋隔離・MENTOR ロック維持。再購入は新しい診断記録から |
| Webhook の更新 | SQL 関数1回＝1トランザクション（complete_04）。Stripe API は注文 ID と Idempotency-Key で再開可能に |
| Webhook の失敗 | 通信・Stripe 再取得・DB の失敗は failed＋HTTP 500（再配送で処理し直す）。署名済みで恒久的な不一致は ignored＋HTTP 200。failed のまま 200 にしない |
| Preview への Webhook | Vercel の Protection Bypass for Automation（クエリ方式）。secret はコード・DB・アプリの環境変数に置かず、Stripe Dashboard だけに設定。URL 全文をログに出さない。Stripe 署名検証は必須 |
| 関数の構成 | mentor-goal（GET・POST）、complete-status（GET 状態・POST 署名 URL）を各1関数にまとめる。本数の制限は Preview build の実測で判断 |
| 生成 | Webhook の DB 処理で必ず queued → `@vercel/functions` の waitUntil で開始 → マイページの状態取得で取り残しを回収 → 運営者 API で再試行 |
| 旧 ¥1,000 からの ¥2,000 | 診断コードのハッシュ一致だけでは認めない。`complete_legacy_bindings`（旧購入権1件→1人・1記録、一度だけ）を根拠にする。API が Stripe の Checkout Session を取り直し、購入時メールと Auth の本人メールが一致した時だけ結び付ける。不一致は運営者確認 |
| 結び付け前の旧購入者 | ¥3,000 へ誘導しない（DB は `complete_legacy_purchase_pending` で拒否、UI は「既存の購入を確認中」） |
| customer_email | Checkout 作成時に渡さない（決済画面で本人が入力） |

complete_04 の内容（関数はすべて SECURITY INVOKER・search_path 空・EXECUTE は service_role だけ。本文に削除文を書かない）：

- 表 `complete_legacy_bindings`：旧購入権・利用者・記録の固定（旧購入権・記録とも一意）。service_role は SELECT・INSERT だけ（更新・削除なし）。INSERT のトリガーで本人の記録・旧購入権の有効性・診断コードのハッシュ一致を確認。
- トリガー：`complete_orders_no_repurchase`（再購入禁止）、`complete_orders_state_guard`（注文の状態を後戻りさせない）。
- 関数：`complete_create_order`（記録ごとに直列化・冪等・決済待ちの注文を返す・offer の条件）、`complete_mark_checkout_open`、`complete_close_unopened_order`、`complete_apply_payment`（注文 paid・MENTOR ロック・権利・生成物 queued・イベント processed を同時に）、`complete_apply_checkout_expired`、`complete_apply_refund`（全額で失効・一部は記録だけ・支払い確定より先でも refunded を優先）、`complete_apply_dispute`（opened／won／lost。支払い確定前の opened は再送待ち、古い opened は無視）、`complete_bind_legacy_purchase`、`complete_webhook_gate`・`complete_webhook_finish`（イベントの重複排除と結果記録）。
- record_entitlement の analysis 権だけを根拠とする ¥2,000 は、現行の商品構成では発生しない（direct は analysis と complete を同時に付与するため）。現時点の ¥2,000 の根拠は旧購入権の結び付けだけ。将来の商品追加に備えた経路として残す。

API 実装時の必須事項（complete_04 の適用承認時の補足・2026-10-07）：

- 再送待ち：支払い確定前の dispute などは SQL が例外 `complete_retry_later` を返す（トランザクション全体を取り消し、イベントも残さない）。API は HTTP 500 で返して Stripe に再送させ、ignored・HTTP 200 にしない。HTTP 200 にするのは恒久的な不一致（ignored）だけ。
- 旧購入権の照合：Stripe の購入時メールと Auth のメールの平文を DB に保存しない（`complete_legacy_bindings` には旧購入権・利用者・記録・照合方式・日時だけ）。API のログにもメール、Checkout Session ID、PaymentIntent ID の全文を出さない（末尾だけ）。
- 手動確認待ち：Auth にメールが無い、または Stripe の購入時メールと一致しない場合は自動で結び付けず、`legacy_purchase_verification_required` として停止する（¥3,000 へ誘導しない）。運営者の確認機能と確認記録は complete_05 で扱う。
- 生成素材のハッシュ：本文素材・テンプレート・入力のハッシュは、ブラウザの入力ではなく、サーバーが読み取った保存済み回答と固定素材から計算して `complete_apply_payment` へ渡す。

### 運営者による旧購入権の手動確認と complete_05（2026-10-07 改訂1 承認・Preview 適用済み 20261007234325）

自動照合（Stripe の購入時メールと Auth のメールの一致）で結び付けられなかった旧 ¥1,000 購入者を、運営者が個別に確認して承認・却下する。DB は complete_05 で、監査ログ表と操作関数を追加する。

| 項目 | 決定 |
|---|---|
| 監査ログ表 | `complete_admin_audit_log`：監査 ID・運営者の user ID（`actor_user_id`）・操作種別（`action`）・対象種別（`target_type`）・対象 ID（`target_id`）・結果（`outcome`）・理由コード（`reason_code`）・照合 ID（`incident_id`：16進12桁）・実行日時。この9列だけ |
| 保存しないもの | メールアドレス、Stripe の秘密値、Checkout Session ID・PaymentIntent ID の全文、診断コード、回答、MENTOR の本文、リクエスト本文、自由記述。自由記述の列を作らない |
| 操作種別 | `legacy_binding_approve`・`legacy_binding_reject` だけ（対象種別は `legacy_entitlement` だけ）。生成の再試行（`report_requeue`・`report_process_now`）は、生成再試行 API を実装する migration で関数・権限・理由コードと同時に追加する |
| 理由コード | 下の表のとおり意味を固定し、操作・結果の組み合わせごとに CHECK で強制する |
| 未認証・未認可 | `not_authenticated`・`not_authorized` はこの表に入れない（運営者として認証・認可される前のアクセスは API のセキュリティログで扱う） |
| 照合 ID | NOT NULL・一意。同じ照合 ID の再送は新しい行を作らず前回の結果を返す。同じ照合 ID で運営者・操作・対象・内容（承認は記録、却下・失敗は理由コード）が違えば `complete_admin_incident_conflict`（行を追加しない。API は 409）。新しい照合 ID なら同じ購入権を再度却下でき、1行追加される |
| 運営者 ID | 外部キーにしない（UUID・NOT NULL）。Auth の利用者が削除された後も監査記録を維持し、表示時に存在しなくても削除・書き換えない |
| 追記だけ | UPDATE・DELETE・TRUNCATE をトリガーで拒否（所有者でも）。RLS 有効・ポリシーなし。anon・authenticated・PUBLIC は権限なし。service_role は SELECT・INSERT だけ |
| 手動承認 | `complete_admin_approve_legacy_binding(運営者, 利用者, 記録, 旧購入権, 照合 ID)`：complete_04 の `complete_bind_legacy_purchase`（照合方式 `operator_verified`）で本人の記録・旧購入権の有効性・診断コードのハッシュ一致・一度だけの固定を確かめ、同じトランザクションで監査ログを追加。applied（`operator_verified`）／noop（`already_bound`）を返す |
| 手動却下 | `complete_admin_reject_legacy_binding(運営者, 旧購入権, 理由コード, 照合 ID)`：結び付けは作らず、却下の理由コードだけを記録して rejected を返す。結び付け済みの購入権は却下できない。却下の後に再確認して承認へ進むことはできる |
| 失敗の記録 | 操作の途中で失敗すると、結び付けも監査ログも取り消される。API はその後で同じ照合 ID で `complete_admin_record_failure(運営者, 操作種別, 対象, 失敗の理由コード, 照合 ID)` を呼び、failed を残す（Webhook の failed 記録と同じ形）。失敗した照合 ID で同じ操作を再送すると failed が返るため、やり直しは新しい照合 ID で行う |
| 関数 | すべて SECURITY INVOKER・search_path 空。呼び出し関数の EXECUTE は service_role だけ、トリガー関数は所有者だけ。本文に削除文を書かない |

理由コード（固定）：

| 操作 | 結果 | reason_code |
|---|---|---|
| 手動承認 | applied | `operator_verified` |
| 手動承認 | noop | `already_bound` |
| 手動却下 | rejected | `email_mismatch`・`auth_email_missing`・`stripe_session_unavailable`・`purchase_not_eligible`・`identity_unverified` |
| 実行失敗（承認・却下） | failed | `invalid_request`・`record_not_found`・`legacy_purchase_not_found`・`binding_conflict`・`purchase_hash_mismatch`・`database_error`・`internal_error` |

API が DB の例外を失敗の理由コードへ対応付ける：`complete_admin_invalid_request`・`complete_admin_invalid_reason` → `invalid_request`／`complete_record_not_found` → `record_not_found`／`complete_legacy_purchase_not_found` → `legacy_purchase_not_found`／`complete_legacy_already_bound`・`complete_legacy_record_already_bound` → `binding_conflict`／`complete_legacy_not_matched` → `purchase_hash_mismatch`／DB への接続・応答の失敗 → `database_error`／その他 → `internal_error`。`complete_admin_incident_conflict` は失敗として記録せず 409 で返す。

Preview への適用（2026-10-08 記録）：

- 適用前：Ref `qelqehkigydgrwedbgtr`・`deployment_environment()='preview'`・PostgreSQL 17.11・migration 13件・complete_05 の表／関数／トリガー0件・実行中の処理と待機ロックなしを確認。
- 適用：`apply_migration` を1回だけ実行して成功（タイムアウトなし）。version `20261007234325`、記録された本文の SHA-256 `86ff4ae2952b84341f44aebab7c2939808603623c0e651f019f4fbffe576c645`（19,793 バイト）はファイルと一致。
- 適用後：列9つ（すべて NOT NULL）・外部キー0件・制約（action・target_type・outcome・incident_id 形式・incident_id 一意・理由コード）・索引・ACL（`service_role=ar` だけ）・RLS 有効・ポリシー0件・トリガー2つ・関数4つ（SECURITY INVOKER・search_path 空・呼び出し関数は service_role だけ、トリガー関数は所有者だけ）を確認。complete_01〜04 の定義・権限・既存データ（購入権・記録・プロフィール）の md5 は適用の前後で同一。
- ダミー試験（1つの DO ブロックで実行し、最後に例外で全体を取り消し）：51件すべて合格。取り消し後に監査ログ0件・結び付け0件・試験用の利用者・購入権・故障注入の関数とトリガーが残っていないこと、既存データの md5 が同一であることを確認。

運営者 API の前提（API は未実装。実装時に守る）：

- ログイン中の利用者を Supabase JWT で確認する（`Authorization: Bearer` を `/auth/v1/user` で検証。ブラウザから渡された user ID は使わない）。
- 運営者は Vercel の環境変数 `COMPLETE_ADMIN_USER_ID`（運営者1人の user UUID）との**完全一致**だけで許可する。Preview と Production で別の値を設定し、値はチャット・ログ・コードに出さない。未設定・空・UUID でない値のときは全員を拒否する。
- service_role の鍵を持つことだけでは運営者操作を成立させない。API は JWT と運営者 UUID の確認を終えてから、確認済みの user ID を `actor_user_id` として関数へ渡す。確認より前に DB を読まない・書かない。
- 一致しない利用者は 403（運営者機能の存在を明かさない文言）。POST のみ（他は 405）。
- 入力は旧購入権 ID・利用者 ID・記録 ID・理由コード・照合 ID だけ（自由記述・メールは受け取らない）。照合 ID は操作ごとに API が発行し、通信の再送では同じ値を使う。ログには理由コードと照合 ID だけを出す（メール、Stripe ID の全文、診断コードを出さない）。
- 監査ログを書けなければ操作も成立しない（承認・却下は同じトランザクション）。失敗は `complete_admin_record_failure` で別に記録する。
- 将来運営者が複数になる場合は、環境変数の一覧ではなく DB の運営者ロール表（service_role だけが読む）へ移す（別の migration・別承認）。

ローカル PG17 の検証（2026-10-07 改訂1、complete_01〜04 は適用済みの本文）：129件すべて合格。complete_04 の既存の試験（270件）も、改訂した complete_99 で合格。リポジトリの単体テスト 332件合格。内容：正しい承認（結び付けと監査ログの同時作成）、途中失敗で両方取り消し、同じ照合 ID の承認・却下・失敗記録の再送で行が増えない、同じ照合 ID を別の購入権・記録・運営者・操作・理由に使うと衝突（行を追加しない）、新しい照合 ID での再却下、別の利用者・別の記録・存在しない対象、ハッシュ不一致、別の購入権が結び付いた記録、却下後の承認、理由コードと操作・結果の組み合わせ違反・未認証・未認可・report_requeue・report_process_now の CHECK 拒否、列の確認（メール・Stripe ID・自由記述なし）、UPDATE・DELETE・TRUNCATE の拒否（service_role と所有者）、anon・authenticated の拒否、service_role の権限、二度当て、complete_99 で戻した後の 01〜05 の再適用、complete_04 が無い状態・非 Preview での中止、complete_01〜04 の定義・権限・既存データが前後で同一。

### 既存 API の変更（橋渡し）
- report-data／my-report-link：解析権の判定を §4-3 の OR に広げ、`core_analysis_access` を返す（旧の判定は変えずに追加）。
- verify：変更なし（¥1,000 の経路のまま）。

---

## 8. 返金・失効（判断 6）

| 事象 | 注文 | 権利 | 生成物 | 閲覧 |
|---|---|---|---|---|
| 全額返金 | refunded | complete（direct なら analysis も）を revoked（refund） | revoked＋隔離 | **直ちに停止** |
| dispute 作成 | disputed | **suspended**（dispute_open） | 据え置き（ready のまま） | **一時停止** |
| dispute 勝訴 | paid に戻す | active に復旧 | そのまま | 再開 |
| dispute 敗訴 | disputed | revoked（dispute_lost） | revoked＋隔離 | 停止 |
| 運営者の失効 | 変更なし | revoked（manual） | revoked＋隔離 | 停止 |
| 誤購入（返金して取り消し） | refunded | revoked（mistaken_purchase） | revoked＋隔離 | 停止 |
| 同一記録への重複購入 | 決済前に 409（一意制約＋API） | — | — | — |
| direct 後の upgrade／upgrade 後の direct | 409（完全解析権あり） | — | — | — |
| 一部返金 | 記録のみ（自動失効しない。運営者が判断） | — | — | — |

- 生成物は削除せず、非公開のまま隔離する。**保持期間は本番前に別途決定**。
- アカウント削除：新しい表の FK は restrict のため、削除手順（ACCOUNT_DELETION_RUNBOOK）に完全解析の記録の扱いを追加する必要がある（未決）。

---

## 9. テスト計画（実装時）

| 区分 | 項目 |
|---|---|
| MENTOR | 未選択で Checkout 不可（API 409・DB トリガー）。カタログ外・版違いを拒否。支払い前は選び直し可、支払い後は変更不可。注文の目標と生成物の目標が一致。結果から自動で選ばない |
| 販売対象 | MIRROR 2.0.2／CHAR 2.0.1／element-v1／結果なしの記録は不可（API・DB とも）。版一致の記録だけ可 |
| 権利の分離 | 同じユーザーで記録 A＝complete ready、B＝free。A だけ開ける。B の id で A を開けない |
| 他人 | 別ユーザーから A の閲覧・目標選択・Checkout 作成を拒否（404） |
| 橋渡し | 旧 ¥1,000 だけの記録で upgrade 可（根拠＝legacy）。旧 complete ¥2,500 は完全解析権にならない。direct 購入者は解析レポートも閲覧可 |
| offer 条件 | upgrade に解析権なし → 拒否。完全解析権あり → direct・upgrade とも拒否 |
| 連打・冪等 | Checkout 作成の同時10回 → 注文1件・Checkout1件 |
| Webhook | 重複配送、順序逆転（refund→completed、expired→completed）、不正署名、raw body 改変、Test／Live 混在、metadata 不一致 |
| 照合 | Price・金額・通貨・offer の不一致 → 権利なし・記録あり |
| 未完了 | 未払い、async 失敗、期限切れ（目標は選び直し可に戻る） |
| 生成 | waitUntil 成功、合図喪失→回収、運営者の再試行、上限到達、生成中の再読み込み、貸出し切れの回収、二重生成なし |
| 失効 | refund／dispute／manual → 即時に閲覧停止・隔離・my-entitlements に反映。dispute 作成で一時停止、勝訴で復旧、敗訴で失効。失効からは戻らない |
| 旧商品 | 旧 complete ¥2,500・旧ナラティブ・旧 CORE2 の購入者に完全解析権が付かない |
| 生成 HTML | 実名・user_id・session_id・メールアドレスが含まれない。表示名は「あなた」 |
| 運営者 API | JWT なし・運営者以外は 403、GET は 405、監査ログが書けなければ処理しない |
| URL | 署名 URL の期限切れ、パスを推測しても開けない |
| 秘匿 | ログ・応答に秘密値・生回答・診断コード・他人の識別子・Storage パスが出ない |
| DB | 草案 SQL：ローカル PG で60件（§4 末尾）。実装時に拡張 |
| 公開物 | Production の配信物に prototypes・docs・tests が無いこと（§14 の確認手順） |

**ローカル検証（改訂2）**：改訂1の60件に、dispute の一時停止・勝訴で復旧・敗訴で失効・失効は最終状態の試験を加え、**67件すべて成功**。
**ローカル検証（改訂1）**：使い捨ての PostgreSQL 16（Supabase 雛形＋0001〜0008＋onboarding_01）で **60件すべて成功**した。主な確認項目は次のとおり。
- 5表の anon・authenticated 拒否、関数の EXECUTE 拒否。
- MENTOR：カタログ外・版違いの拒否、1記録1行、支払い前の選び直し、ロック後の変更・解除の拒否。
- 注文の前提：MENTOR 未選択・旧 MIRROR・結果なし・他人・登録未完了・目標不一致の拒否。
- 旧価格・根拠のない upgrade・live の拒否、連打・並行購入の拒否。
- Webhook の重複・livemode の拒否、権利の二重付与の拒否。
- 生成物：RC1 以外の版の拒否、PDF の拒否、一意、ready の条件。
- 貸出し：排他・再試行・回収。
- 返金：失効・隔離の必須項目と停止。
- 戻しの拒否と成功、再適用、Preview 以外での中止。

---

## 10. 手動設定チェックリスト（実装の承認後・値はチャットに出さない）

| # | 画面 | 作業 | 時期 |
|---|---|---|---|
| 1 | Stripe（Test） | 「完全解析」Price ¥3,000（JPY・一回払い） | Preview 実装時 |
| 2 | Stripe（Test） | 「完全解析 アップグレード」Price ¥2,000 | 同上 |
| 3 | Stripe（Test） | Webhook endpoint（Preview の `/api/stripe-webhook`）。イベント：checkout.session.completed／async_payment_succeeded／async_payment_failed／expired、charge.refunded、charge.dispute.created／closed | 同上 |
| 4 | Stripe（Test） | Webhook の signing secret を控える | 同上 |
| 5 | Vercel | Preview・ブランチ `release-c-preview` 限定：`STRIPE_PRICE_COMPLETE_DIRECT`、`STRIPE_PRICE_COMPLETE_UPGRADE`、`STRIPE_WEBHOOK_SECRET`、運営者用の秘密（sensitive） | 同上 |
| 6 | Vercel | Preview の Deployment Protection が Webhook を遮らない設定（Webhook パスの除外または Protection Bypass。要検証） | 同上 |
| 7 | Supabase（Preview） | 非公開 Storage バケット（例：`complete-reports`、public=false） | 同上 |
| 8 | Supabase（Preview） | complete_01 の適用（別承認） | 同上 |
| 9 | リポジトリ | 公開物から prototypes・docs・tests を外す変更（§14。コード変更として別承認） | Production 前 |
| 10 | Production 一式 | **後日・別承認** | — |

---

## 11. 実装の工程分割（各工程で承認・検証・停止）

0. 未決事項の決定（§15）。
1. **DB**：complete_01 を Preview に適用（別承認）→ ローカルと同じ確認を Preview で読み取りと試験データで実施。
2. **読み取り API**：my-entitlements v2（records・橋渡し・completeEligible・mentorGoal）、report-data／my-report-link の解析権 OR。販売フラグ OFF。
3. **MENTOR 選択**：select-mentor-goal API と UI（5目標・選び直し・未選択では購入ボタンなし）。
4. **Webhook**：署名・冪等・順序・状態遷移（生成は queued まで）。Test のイベントで検証。
5. **Checkout 作成**：create-complete-checkout（販売フラグ OFF のまま API 単体で検証）。
6. **生成ワーカー**：RC1 の同梱・実行確認（`api/_complete/` 方式、§14）、非公開 Storage、3経路。
7. **閲覧**：my-complete-report-link・mypage の状態表示。
8. **返金・失効**：refund／dispute／manual の通し試験（閲覧停止・隔離）。
9. Preview で販売フラグ ON（Test 決済の通し試験）。
10. Production 移行（別承認・§12・§13 をすべて解消してから）。

---

## 12. Production 移行前の停止条件（1つでも当てはまれば止める）

- **prototypes・docs・tests（および demo HTML・README・SQL 草案）が Production の公開配信物に入る状態**（判断 11。§14 の確認手順で 404 を確認するまで）。
- §13 の販売停止条件が1つでも残っている。
- Webhook が Live で疎通していない。署名検証・冪等・順序逆転の試験が未通過。
- Live の Price と offer・金額の照合が未設定・未試験。
- 返金・dispute・manual の失効と閲覧停止が未試験。生成物の保持期間が未決定。
- 非公開 Storage・署名 URL の短時間化が未確認。
- 既存表の広い GRANT（0009 権限強化）が未解消。
- 本番 DB に onboarding（legacy_exempt 規則）と complete_01 相当が未適用。
- `CA_PREVIEW_BUILD=true`・Preview 用の状態切替・テスト用リンクが残っている。
- `report_sample.html` の旧 ¥3,000 販売欄が残っている。
- **完全解析の販売開始（`COMPLETE_SALES_OPEN=true`）は、Preview でも、生成・保存・閲覧まで通るまで禁止**（2026-10-08 決定）。生成器が未実装の間は、支払い確定後も `complete_reports` は queued のまま。
- **Webhook の raw body が Vercel の実環境で保持されること**を、Webhook の設定後に Preview で確かめるまで止める（必須の停止条件。Stripe の Test イベントで署名検証が通ること、1バイト変えた本文が拒否されることを実環境で確認する）。
- `COMPLETE_CHECKOUT_ORIGIN` が https の origin だけで、Preview で許可した固定 origin と一致すること（一致しなければ Checkout は閉じる）。Production 用の origin は Production 移行時に別承認で許可リストへ加える。

### 12-1. 本番移行前のセキュリティ整理の候補（停止条件ではない・2026-10-07 記録）

- **API の確認順の統一**：原則を「環境確認 → 認証 → 詳細な入力・記録の確認」の順にそろえる。
  - 現状の `/api/mentor-goal`（Preview 配信 818ed5b で確認）は、環境確認の後、認証より先に入力の形式を確かめる。
  - そのため未認証のとき、記録 ID が無い・形式違反なら 400 `invalid_request`、形式を満たせば 401 `not_authenticated` になる。
  - 記録の存在・所有者は認証の後にしか確かめないため情報漏洩にはつながらず、Preview 反映の停止条件にはしない（2026-10-07 判断）。
  - 本番移行前に、認証の確認（Bearer の有無と JWT 検証）を入力の形式確認より前へ移す。同じ順序を他の新規 API（complete-status・Checkout・運営者 API）にも適用し、順序の試験を加える。
- **MENTOR 選択の実機確認**：Preview で実在データへ書き込む MENTOR 選択 POST は未実施。実施は別承認とする。

---

## 13. 正本候補（COMPLETE-RC1）の販売停止条件と解除に必要な本文監査

RC1 は技術候補。**次がすべて満たされるまで販売しない**（Preview の Test 決済による試験は可）。

| # | 停止条件 | 解除に必要な監査・作業 |
|---|---|---|
| 1 | 承認済み原本がリポジトリに無い | `core1_v4_revised_46p.html`（承認原本）・BUILD_SPEC・10-06 指示書をリポジトリへ取り込み、RC1 の出力（代表 fixture）と章立て・ページ数・本文を突合。差分を一覧化して承認 |
| 2 | 本文の全文査読が未完了 | 代表3件以上（性格の傾向が異なるもの）の46ページ全文を査読。禁止表現（README 規則：主観的な推測・断定・医療的な表現）を確認 |
| 3 | 閾値が暫定（TEXT-BANDS 0.1.0 等） | 閾値の確定と版名の更新。分布（MIRROR_DISTRIBUTION 等）での偏りの確認 |
| 4 | MENTOR の目標文面 | 5目標の label・keep_phrase・borrow の最終確認（利用者向けの選択画面の文言を含む） |
| 5 | HIDDEN SHAPE の表現 | 販売カードの「表に出にくい一面」と README 規則・P08 定義の整合 |
| 6 | 内容ハッシュの凍結 | content JSON・テンプレート・CSS・画像の SHA-256 をスナップショットと生成物に記録する実装（DB 列は用意済み） |
| 7 | 表示名 | 「あなた」に固定（A3）する実装と確認 |
| 8 | 識別子の埋め込み | RC1 の HTML コメントの session ID 埋め込みをやめ、必要なら report_id だけにする実装と、生成時の自動確認（A3） |
| 9 | 販売表示・契約内容 | 「認証必須の非公開 HTML」「PDF なし」「MENTOR は購入前に1つ選ぶ・購入後は変更不可」「対象は最新版の診断記録だけ」を販売画面・規約・特定商取引法表記に明記 |
| 10 | 生成の実行確認 | Vercel Function での RC1 の同梱と実行（動的評価・ファイル読み込み）、1件の生成時間、メモリ |
| 11 | 画像 | base64 埋め込み（1件 約670KB）の妥当性、権利・出典の確認 |
| 12 | 返金・失効 | §8 の試験の完了、保持期間の決定 |

---

## 14. Production 公開物から prototypes 等を除外する方法（調査結果・変更案のみ）

調査結果：
- 現在の Vercel 設定は `vercel.json` の `cleanUrls` だけで、フレームワーク指定もビルドもない。**リポジトリ直下のファイルはすべて静的に配信される**（Preview で `prototypes/…/package.json`、`docs/sql/…`、`lib/server-env.js` が 200 を返すことを確認。Preview は Vercel の認証の内側）。
- `api/` の下は関数として実行され、ソースは配信されない。`api/` の下で `_` で始まるものは関数にならない（既存の `api/_ogp-char-element.mjs` と同じ扱い。要検証）。
- main には prototypes・docs・tests・lib・js・assets がまだ無い（ローカルの git 情報で確認。Production 自体へは確認しない）。
- `rewrites`／`headers` は静的ファイルより後に評価されるため、既存の静的ファイルを隠す用途には使えない（要検証）。

変更案（未実施・別承認）：

| 案 | 内容 | 長所 | 短所 |
|---|---|---|---|
| A：`.vercelignore`（除外リスト） | `prototypes/`、`docs/`、`tests/`、`*-demo.html`、`index-test.html`、`report_sample.html`、`*.md` などをデプロイ対象から外す | 小さな変更・既存構成のまま | 除外漏れが起きやすい（新ファイルが公開される）。外したファイルは関数からも読めない |
| B：ビルドで公開物を許可リスト化 | ビルドで公開してよいファイルだけを `public/` へコピーし、`outputDirectory` にする | 新しいファイルは既定で非公開（安全側） | デプロイ方式の変更が大きい。Preview での検証が必要 |
| C：生成コードの配置 | RC1 の実行に必要なもの（エンジン・content・テンプレート・assets）を `api/_complete/` に置き、関数から読む（`functions.includeFiles` 等） | 生成コードを公開せずに関数で使える | 配置替えと同梱設定の検証が必要 |

推奨：**C＋A を最初の一歩**（RC1 の実行物を `api/_complete/` に置き、`.vercelignore` で prototypes・docs・tests などを外す）。本番移行前に **B（許可リスト化）** を検討する。
- 確認手順：Preview で `/prototypes/…`・`/docs/…`・`/tests/…` が 404、`/api/_complete/…` が 404、関数からは読めることを確認してから Production へ。
- 併せて `lib/server-env.js` も静的に配信されている（秘密値は無いが、ガードの仕組みが読める）。`api/_lib/` へ移すかは別途判断。

---

## 15. 未決事項

1. COMPLETE-RC1 を承認済み本文へ昇格させる手順と責任者（§13 の 1〜5）。
2. 生成物の保持期間（失効・隔離後）と、アカウント削除時の扱い。
3. ~~dispute 作成時の扱い~~ → **決定（A2）**：一時停止・勝訴で復旧・敗訴／返金確定で失効。
4. ~~display_name・ID の埋め込み~~ → **決定（A3）**：表示名「あなた」、実名・user_id・session_id は入れない。
5. 公開物の除外方式（§14：A＋C か B か）。
6. 販売画面・規約・特定商取引法表記の文言（§13-9）。
7. ~~MENTOR 選択画面の位置~~ → **決定（A6）**：対象記録の選択後・Checkout の直前。
8. ~~署名 URL の有効時間~~ → **決定（A4）**：初期300秒・毎回発行。
9. ~~運営者用 API の認証~~ → **決定（A5）**：Supabase JWT＋運営者 UUID の完全一致・POST のみ・監査ログ必須（監査ログ表は complete_05。Preview 適用済み 20261007234325）。

---

## 16. 次に適用する最小単位

**工程1：complete_01 草案を Preview DB へ適用する（別承認）**。

- 前提：本文や Stripe の設定に依存しない。販売は始まらない（API も UI も無い）。
- 適用前：
  - Ref（`qelqehkigydgrwedbgtr`）と `deployment_environment()='preview'` を確認。
  - complete_01 の SHA-256 を記録。
- 適用後：
  - 5表・3関数・2トリガー・制約・索引・権限（anon・authenticated の拒否）を読み取りで確認。
  - ローカルと同じ試験を、トランザクション内のダミーで確認し、必ず rollback。
- その次：工程2（読み取り API の橋渡し）。

---

## 付記：別課題として記録するもの（今回は対応しない）

- 0009 権限強化：既存の公開表から anon・authenticated の不要な権限（特に TRUNCATE・DELETE）を外す。
- `complete_consent_01_migration_DRAFT_DO_NOT_RUN.sql`：**SUPERSEDED・適用しない**（ファイルは履歴として残す。冒頭への注記追加は別途）。
- `docs/COMPLETE_ANALYSIS_PREVIEW_DESIGN.md` §4（Kit の任意チェック）を現行方式へ更新。
- verify.js の二重決済（同じ診断コードの ¥1,000 の再購入）防止。
- report.html の `core_complete_access` 前提と report-data の食い違い（§7 の橋渡しで解消予定）。
