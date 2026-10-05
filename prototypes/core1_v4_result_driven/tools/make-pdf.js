// make-pdf.js — dist/<id>.html を A4 PDF にする。使い方: NODE_PATH=$(npm root -g) node tools/make-pdf.js F01 F02 ...
'use strict';
const path = require('path');
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  for (const id of process.argv.slice(2)) {
    const p = await b.newPage();
    await p.goto('file://' + path.join(__dirname, '..', 'dist', id + '.html'));
    await p.emulateMedia({ media: 'print' });
    await p.pdf({ path: path.join(__dirname, '..', 'dist', id + '.pdf'), format: 'A4', printBackground: true, preferCSSPageSize: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } });
    console.log('pdf', id);
    await p.close();
  }
  await b.close();
})();
