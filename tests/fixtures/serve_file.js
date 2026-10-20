// 試験用の静的配信：HTML の外部スクリプトの integrity（SRI）を外して返す。
//   試験は CDN のライブラリ（supabase-js・html2canvas など）を代用品に差し替えるため、SRI のままだと読み込みが止まる。
//   本番の HTML（integrity 付き）はそのまま配信される。ここで外すのは試験のサーバーだけ。
const fs = require('fs');

function pipeFile(f, res) {
  if (/\.html$/.test(f) && !process.env.KEEP_SRI) { // KEEP_SRI=1：本物のライブラリで SRI を確かめる時
    res.end(fs.readFileSync(f, 'utf8').replace(/\s+integrity="sha(?:256|384|512)-[A-Za-z0-9+/=]+"/g, ''));
    return;
  }
  fs.createReadStream(f).pipe(res);
}

module.exports = { pipeFile };
