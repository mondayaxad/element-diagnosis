# 本番監査（#38 反映後・096133d・2026-11-24）

- 対象：https://element-diagnosis-five.vercel.app（本番デプロイ dpl_Hz9hHk7oCu8Z7i1pVPkrpvKjygy9）
- 186ルート（前回の本番監査と同じ一覧）。生データ：crawl-186-routes.json

## 1. 186ルート
- 取得エラー 0。応答：200×115・308×55・404×11・401×2・403×1・400×1・405×1（前回と同じ）
- 前回（#38 反映前）からの変化は、タイプ解説（title・description・og:title・og:image。35ページ×末尾スラッシュあり/なし＋クエリ付き1件＝71ルート）と、邪眼（JSON-LD。5ルート）だけ。状態コード・転送先・X-Robots-Tag・meta robots・canonical の変化は 0

## 2. インデックス制御・サイトマップ（scripts/seo-policy.js と照合）
- index 38：すべて 200・noindex なし・canonical が自分自身
- allow 4（privacy・terms・tokushoho・Search Console 確認ファイル）：200・noindex なし
- noindex 10＋動的 6（/result・/jagan/s/:id・/jagan/share・/j/:k・/api/share・/api/jagan-share-page）：すべて noindex
- sitemap.xml：38 URL。ポリシーの index と一致し、リポジトリのファイルとバイト単位で同じ。各 URL は 200・indexable・canonical 一致
- robots.txt：Allow: / と Sitemap の1行（変更なし）

## 3. タイプ解説35ページ（iPhone 13 相当の Chromium）
- メタ情報 35/35：title・description・og:title・og:description・og:image・twitter:image・寸法がリポジトリと一致。title は35件すべて異なる
- 診断開始ボタン 35/35：最初の画面内（上端 159〜224px、高さ 65px 以上）
- OGP 画像 35/35：200・image/jpeg・1200×630、配信された中身がリポジトリとバイト単位で一致（最大 126,846 バイト）

## 4. 邪眼の構造化データ
- /jagan/：WebApplication＋Offer（無料の50問だけ）。/jagan/about：WebPage＋BreadcrumbList
- JSON として解析でき、description・canonical がページと一致

## 5. type_diagnosis_cta_click
- ブラウザ側の発火：35/35 で、上・末尾・関連の各導線に1回ずつ（type_code・element・weapon_type・cta_position・destination・transport_type=beacon）。1秒以内の再クリックは送られない。この試験では GA への通信を遮断し、本番の計測には送っていない
- GA4 への到達：/type/pysw で1回だけ実送信（?ed_internal=1 ＝内部トラフィック）。GA4 の収集エンドポイント（www.google-analytics.com/g/collect、tid=G-FDN7NYZW9D）が page_view と type_diagnosis_cta_click をいずれも 204 で受け付けた。パラメータ：type_code=PYSW・element=pyro・weapon_type=sword・cta_position=top・destination=eti_top
- GA4 のレポート（リアルタイム・探索）での表示は確認していない（内部トラフィックとして送ったため、フィルタの設定次第でレポートに出ない）
