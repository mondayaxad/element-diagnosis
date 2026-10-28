// js/public-config-retry.js
// /api/public-config?format=js（公開設定）の読み込みに失敗した時（一時的な障害・関数の起動の遅れ・通信の乱れ）、
// 同じ設定を、JSON で、最大2回、取り直す。取れれば window.__ED_PUBLIC_CONFIG__ に入れる（以降のスクリプトは、最初から取れた時と同じに動く）。
//   ・失敗したままだと、購入ボタンが「準備中」のまま、ページを読み込み直すまで、戻らない（ログインや保存も使えない）ため。
//   ・サーバーが意図して返す 503（環境の食い違いを止める停止）では、取り直さない（同じ結果になるだけで、止めた意味を弱めない）。
//   ・設定が取れている時は、何もしない。失敗しても例外を出さない（ページの表示を止めない）。
//   ・返す値の形は、?format=js と同じ4項目＋販売・API の2項目だけ。形が違えば、採用しない。
(function () {
  'use strict';
  if (window.__ED_PUBLIC_CONFIG__) return;
  for (var i = 0; i < 2; i++) {
    try {
      var x = new XMLHttpRequest();
      x.open('GET', '/api/public-config?retry=' + (i + 1), false); // 同期：後続のスクリプトが、設定を読む前に済ませる
      x.send();
      if (x.status === 503) return; // 意図した停止
      if (x.status !== 200) continue;
      var c = JSON.parse(x.responseText);
      if (c && typeof c === 'object' && typeof c.appEnv === 'string' && typeof c.supabaseUrl === 'string'
          && typeof c.supabaseAnonKey === 'string' && typeof c.projectRef === 'string') {
        window.__ED_PUBLIC_CONFIG__ = Object.freeze(c);
        return;
      }
    } catch (e) { /* 次の試行へ */ }
  }
})();
