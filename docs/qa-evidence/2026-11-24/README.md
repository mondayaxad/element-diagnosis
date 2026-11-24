# 品質正常化の証跡（2026-11-24）— 参照用。main へはマージしない

| ファイル | 内容 |
|---|---|
| `TEST_QUALITY_AUDIT.md` | 調査報告：スキップ91件の全件一覧・既知の失敗1件の根本原因・検証環境の構築案（調査時点の内容） |
| `original-801-tests-seo-content-optimization-8fce8be.tap` | 品質正常化の前の全テストの生ログ（`seo-content-optimization` 8fce8be・`node --test tests/*.test.js`・801件：pass 709・fail 1・skipped 91） |
| `local-4e1ab44/1-all.tap`・`2-pg.tap`・`3-live.tap` | 統合候補 4e1ab44（#39 48f524f・#40 0e8bba8・#38 8fce8be）の手元の全テスト（`tests/support/run_full.sh`、PostgreSQL 17.12〔embedded-postgres・npm の integrity 一致〕、unix ソケットのみ、合成データのみ）：832・44・145件、いずれも fail・skipped・cancelled・todo 0 |
| `ogp-parallel/og_par_1〜6.tap` | OGP の性能試験を6本同時に実行した結果（PSNR・CPU 比を診断行に記録） |

CI（GitHub Actions）の TAP は、各実行の成果物「test-reports」にある（Quality のみ）。
