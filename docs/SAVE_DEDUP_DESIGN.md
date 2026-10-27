# 診断記録の保存仕様・重複防止 設計書（案2 / 未適用）

- 状態：設計・SQL草案・テスト設計まで。**DBへの適用、RPCの変更、commit / push、Production 操作はしていません。**
- 前提コード：release-c-preview `f4f3143` の作業ツリー
- 関連ファイル：
  - `docs/sql/save_dedup_00_preflight_READONLY.sql`（事前確認。SELECTのみ）
  - `docs/sql/save_dedup_01_migration_DRAFT_DO_NOT_RUN.sql`（migration草案）
  - `docs/sql/save_dedup_99_rollback_DRAFT_DO_NOT_RUN.sql`（rollback草案）
  - `tests/eti_v2_diagnosis_code.test.js`（一致キーの前提を固定する正式テスト。`node --test tests/eti_v2_diagnosis_code.test.js`）
  - `result-save-demo.html`（完了ページUIの確定版デモ）
  - `docs/AUTH_RETURN_TEST_PLAN.md`（Safari / Chrome / Xアプリ内ブラウザの実機確認手順）

---

## 1. 確定した仕様

### 1-1. 保存UI（result-save-demo.html を採用）

| 状態 | 本文 | 操作 |
|---|---|---|
| 未ログイン | この結果を、今のあなたとして残しませんか。／保存すると、次に診断したとき今日の自分と見比べられます。 | 結果を保存する |
| ログイン済み・未保存 | この結果は、まだ診断記録に残っていません。／記録として残すと、マイページからいつでも見返せます。 | この結果を診断記録に残す |
| 保存済み | この結果は、すでに診断記録に残っています。 | マイページで見る → |

補助の状態として、保存中、保存成功直後（カード全体が保存済み表示へ切り替わる）、エラー（もう一度試す）があります。

- 「無料」という文言は使いません。
- **ログイン済みでも自動保存はしません。**
  - ページを開いたときに行うのは、ログイン状態の確認と、保存済みかどうかの確認（READ）だけです。
  - 書き込み（INSERT）は、必ずボタンを押したあとに行います。
- 同じ内容がすでに保存されていても、エラー表示にはしません。「すでに診断記録に残っています」と表示します。

### 1-2. 同一診断の一致キー

```
user_id + diagnosis_type + diagnosis_version + item_set_version + scoring_version + answers_code
```

- `answers_code` は100回答の可逆コードです（`diagnosis_answers.encoded_answers`）。
  - **v2 では `diagnosis_code` と同じ値です。**
  - **legacy では `diagnosis_results.diagnosis_code` が別の値**（旧購入導線の applyData）なので、キーには必ず `encoded_answers` を使います。
  - `diagnosis_code` という名前のままキーにすると legacy で誤判定するため、列名は `answers_code` にしました。
- `scoring_version` をキーに含めます。
  - 同じ100回答でも、採点版が違えば別の記録として残ります（例：ETI-SCORE-2.0.0 と 2.1.0）。
- 元素・武器・国家などの最終タイプはキーに含めません。
- fingerprint 列は作りません。
  - コードは100回答を損失なく1対1で表せます。
  - 同じ回答は必ず同じコードになり、1問でも違えば別のコードになります。
  - 以上は `tests/eti_v2_diagnosis_code.test.js` で固定しています（7項目すべて合格）。

### 1-3. 二層構造（役割を混ぜない）

| 仕組み | 防ぐもの | どこで守るか |
|---|---|---|
| `client_session_id`（既存のUNIQUE。変更しない） | 同じ保存操作の再送（通信の再試行、二重送信） | RPCの既存ロジック（冪等処理、`idempotency_payload_mismatch`） |
| 一致キー（新しいUNIQUE） | 同じ診断内容の二重保存（リロード、再診断、別タブ、別端末） | RPCでの事前確認と、一意インデックス（同時保存の競合も防ぐ） |

クライアント側の変更：
- `client_session_id` を作る単位を、ボタンを押すたびではなく、**結果を表示するごとに1つ**にします。
- これで、保存エラー後の再試行が同じ保存操作として扱われます。

---

## 2. schema / 一意制約案

`diagnosis_sessions` に次の3列を追加します。どれも空欄を許す列なので、既存の行には影響しません。

- `answers_code text`：一致キー用です。`encoded_answers` の複製で、保存RPCが書き込みます。
- `scoring_version text`：sessions 側にまだ無い場合のみ追加します。事前確認の P1 で確認します。
- `duplicate_of uuid`：migration の時点で既に存在していた重複行に付ける印です。新しい保存では常に空欄です。

一意インデックス（空欄は coalesce で空文字などに揃えます）：

```sql
create unique index concurrently diagnosis_sessions_identity_uq
  on diagnosis_sessions (user_id, diagnosis_type,
     (coalesce(diagnosis_version,'element-v1')), (coalesce(item_set_version,'')),
     (coalesce(scoring_version,'')), answers_code)
  where answers_code is not null and duplicate_of is null;
```

- **v1 と v2 を混ぜない条件**：`diagnosis_version` がキーに入っているため、同じコード文字列でも v1 と v2 は必ず別の記録です。legacy で空欄のものは `element-v1` として扱います。
- 他のユーザーとは `user_id` が違うため衝突しません。RLS（本人の行しか見えない制限）とも独立しています。
- 答えのコードが無い行は、一致キーの対象外です。

---

## 3. RPC 変更案（save_diagnosis_session_v2 / save_diagnosis_session）

詳しくは `01_migration` の Step 6 に書きました。要点は次のとおりです。

- **戻り値の型、引数、SECURITY INVOKER は変えません。** 戻り値の型を変えると関数を作り直す必要があり、クライアントとの互換が崩れるためです。
- 処理の順序：
  1. ログイン確認（既存）
  2. 同じ `client_session_id` の既存セッションを確認（既存）。見つかれば再送として同じ結果を返し、payload が違えば従来どおり `idempotency_payload_mismatch` を返します。
  3. **追加**：一致キーで本人の既存記録を探します。見つかれば INSERT せず、既存のidを返し、成功として扱います。
  4. 3テーブルへの INSERT を1つのブロックにまとめます。一意インデックスの違反（同時保存の競合）だけを捕まえて、先に確定した既存のidを返します。それ以外のエラーは従来どおり呼び出し元へ返します。
  5. INSERT のときに `answers_code = p_encoded_answers`、`scoring_version = p_scoring_version` を書き込みます。
- legacy の `save_diagnosis_session` にも同じ変更を入れます。
  - `item_set_version` は空文字に固定します。
  - `scoring_version` には `element-score-v1` が送られてきます。
- **既知の限界**：`p_encoded_answers` が `p_answers_v2` と一致しているかは、サーバー側で検証しません（現状どおり）。ずれていたとしても、影響するのは送った本人のデータだけです。

---

## 4. 既存データに重複があった場合の方針

- **行は削除しません。**
  - 回答、結果、購入権利はそのまま残します。
  - 購入権利は `diagnosis_code_hash`（回答コード）に紐づいていて、session のidには紐づいていないため、どの行を正本にしても購入状態は変わりません（`api/my-entitlements.js`、`api/report-data.js` で確認）。
- 同じ一致キーの行のうち、`completed_at` が最も早いもの（同時刻ならid順）を正本にします。
  - 正本以外の行には `duplicate_of = 正本のid` を入れます。
  - 「その瞬間を最初に記録した日」を残すという考え方です。
- マイページは `duplicate_of is null` の行だけを表示します（クライアント側の変更。DB適用後に行います）。
- 重複行のidで `/api/my-report-link` を呼ばれても、同じコードなので同じレポートを返せます。互換性は保たれます。
- 件数と影響範囲は、事前確認の P8 で先に確認します。

---

## 5. テスト設計

### 5-1. 自動テスト（追加済み・DB不要）
`tests/eti_v2_diagnosis_code.test.js`：7項目すべて合格しています。
- 100問の往復
- キーの順序に関係なく同じ結果になること（決定論的）
- どの1問を変えても別のコードになること
- 境界値
- ランダム2万件で衝突しないこと
- 未回答や範囲外の値を拒否すること

### 5-2. DB・RPC テスト（Previewで適用後に実施）

| # | ケース | 期待する結果 |
|---|---|---|
| D1 | 新規保存 | 1行作成。`answers_code` と `scoring_version` が入っている |
| D2 | 同じ `client_session_id` で再送 | 新しい行は作られず、同じidが返る（既存の冪等処理） |
| D3 | 同じ `client_session_id` で payload が違う | `idempotency_payload_mismatch`（既存どおり） |
| D4 | 別の `client_session_id`、同じ一致キー（リロード後・再診断・別タブ） | 新しい行は作られず、既存のidが返る。エラーにしない |
| D5 | 1問だけ違う回答 | 新しい行が作られる |
| D6 | 元素・武器・国家は同じで、回答が違う | 新しい行が作られる |
| D7 | 同じ回答で、`scoring_version` だけ違う | 新しい行が作られる |
| D8 | 同じコード文字列で、v1 と v2 | それぞれ別の行が作られる |
| D9 | 別ユーザーで、同じ回答 | それぞれ別の行が作られる |
| D10 | **同時保存の競合**：同じ一致キーで、別の `client_session_id` の保存を2つのコネクションから同時に実行（`pg_sleep` を挟むか、2つのセッションで BEGIN してから順に確定） | 片方が作成、もう片方は一意制約違反を捕まえて既存のidを返す。どちらも成功。行は1つ |
| D11 | 同時保存の競合（同じ `client_session_id`） | 既存の UNIQUE と冪等処理で1行になる |
| D12 | migration 後、既存の重複行 | 正本以外は `duplicate_of` が入っている。一意インデックスが INVALID になっていない |
| D13 | rollback を手順どおり実施 | インデックスが削除され、印が消え、旧RPCで D1 と D2 が従来どおり動く |

### 5-3. 画面の E2E テスト（Playwright。Supabase はスタブ ＋ Preview の実物）

| # | ケース | 期待する結果 |
|---|---|---|
| U1 | 未ログインで開く | ①「結果を保存する」。INSERT は呼ばれない |
| U2 | ログイン済み・未保存で開く | ②。**ページを開いただけでは RPC が一度も呼ばれない** |
| U3 | ログイン済み・保存済みで開く | ③「マイページで見る →」。保存ボタンは出ない |
| U4 | ②で保存を押す | 保存中 → 保存直後 → ③。RPC は1回だけ呼ばれる |
| U5 | U4 のあとリロード | ③（READ で判定） |
| U6 | 同じ回答で再診断 | ③ |
| U7 | 1問だけ変えて再診断 | ② |
| U8 | エラーから再試行 | 同じ `client_session_id` で再送される |
| U9 | 未ログイン → 認証 → マイページ | 保存される（すでにあれば保存されたものとして扱う）。pending が消える |
| U10 | legacy（`?code=`）で①②③ | v2 の記録と混ざらない |
| U11 | 購入済み × 未保存、未購入 × 保存済み | 保存カードの表示が購入状態に影響されない |
| U12 | 375px / 430px | 横スクロールなし、JSエラーなし |

---

## 6. rollback 案

`docs/sql/save_dedup_99_rollback_DRAFT_DO_NOT_RUN.sql` にまとめました。手順は次のとおりです。

1. クライアントを revert します。
2. RPC を、事前に保存しておいた旧定義に置き換えます。
3. 一意インデックスを削除します。
4. `duplicate_of` を空欄に戻します。

追加した列は空欄を許す列なので残しても害はありません。完全に戻す場合だけ削除します。

どの手順でも行データは消えません。

---

## 7. X アプリ内ブラウザ（将来候補B：サーバー側 pending token。今回は実装しません）

**現状**
- ログイン前の診断データは localStorage に置いています。そのため、Xアプリ内ブラウザから Safari などへ移ると引き継がれません。これはブラウザの仕組み上の問題です。
- ただし、**実際の挙動は実機で未確認です。** Google がアプリ内ブラウザのログインを拒否するかどうかも未確認です。
- 確認手順は `docs/AUTH_RETURN_TEST_PLAN.md` にまとめました。

**候補Bの設計メモ**（実機で問題が再現した場合に実装します）
1. 保存を押したら、`POST /api/pending-save` で次をサーバーに送ります。
   - 回答コード
   - 各種の版（diagnosis_version / item_set_version / scoring_version）
   - 計算済みの結果
2. サーバーは推測できないランダムな token（128bit 以上）を返します。token はサーバー側にはハッシュで保存し、有効期限は30分、使えるのは1回だけです。
3. ログイン後の戻り先を `/mypage.html?pt=<token>` にします。**URL に載るのは token だけで、回答は載せません。**
4. 認証後、`POST /api/claim-pending` を本人のトークン付きで呼びます。サーバーは次の順で処理します。
   - token が有効期限内で、まだ使われていないことを確認します。
   - 最初に受け取ったユーザーに紐づけます。
   - 一致キーで重複を確認し、新しい記録であれば保存します。
   - token を使用済みにします。
5. 他のユーザーの token を使っても、何も取得できません。期限切れの token は定期的に削除します。

**優先順位**
1. 完了ページUI
2. DB側の重複防止
3. Previewの実機で X 認証を確認
4. 問題が再現したら候補B
