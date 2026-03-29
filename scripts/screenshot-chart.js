const puppeteer = require('puppeteer');
const symbol = process.argv[2] || 'SOLUSDT';
const outPath = process.argv[3] || '/tmp/chart.png';

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 600 });
  await page.goto(`http://34.206.128.225:3333/chart-preview/${symbol}`, { waitUntil: 'networkidle2', timeout: 25000 });
  await page.waitForSelector('#chart-preview[data-loaded]', { timeout: 20000 });
  const el = await page.$('#chart-preview');
  if (!el) { console.error('element not found'); process.exit(1); }
  await el.screenshot({ path: outPath, type: 'png' });
  await browser.close();
  console.log('done:' + outPath);
})().catch(e => { console.error(e.message); process.exit(1); });
