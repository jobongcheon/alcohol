// usage: node render.js <outDir> <frame,frame,...|start-end> [workers]
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const [outDir, spec, nw = '1'] = process.argv.slice(2);
let frames = [];
if (spec.includes('-')) { const [a, b] = spec.split('-').map(Number); for (let i = a; i <= b; i++) frames.push(i); }
else frames = spec.split(',').map(Number);
fs.mkdirSync(outDir, { recursive: true });
(async () => {
  const W = +nw; const t0 = Date.now(); let done = 0;
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--allow-file-access-from-files'] });
  await Promise.all(Array.from({ length: W }, async (_, w) => {
    const page = await browser.newPage();
    page.on('console', m => console.log('[page]', m.text()));
    page.on('pageerror', e => console.log('[err]', e.message));
    await page.goto('file://' + path.resolve('index.html'));
    const info = await page.evaluate(() => window.ready);
    if (w === 0) console.log('ready', info);
    for (let k = w; k < frames.length; k += W) {
      const i = frames[k];
      const d = await page.evaluate(i => window.renderFrame(i), i);
      fs.writeFileSync(path.join(outDir, `f${String(i).padStart(4, '0')}.jpg`), Buffer.from(d.split(',')[1], 'base64'));
      if (++done % 50 === 0) console.log(done, 'frames', ((Date.now() - t0) / 1000).toFixed(1) + 's');
    }
  }));
  await browser.close();
  console.log('done', frames.length, ((Date.now() - t0) / 1000).toFixed(1) + 's');
})();
