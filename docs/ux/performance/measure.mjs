// Read-only browser measurement against real services. No route mocks or saved responses.
// PERF_BASE=http://localhost:3213 PERF_LABEL=after node docs/ux/performance/measure.mjs
import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const base = process.env.PERF_BASE || 'https://bondrail.vercel.app';
const label = process.env.PERF_LABEL || 'before-production';
const bond = '0x66A9aAfad577A6319645F4E2E2daAad42a987343';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 375, height: 812 }, reducedMotion: 'reduce' });
const page = await context.newPage();
await page.addInitScript(() => {
  window.__summaryMs = null;
  window.__fullSummaryMs = null;
  const observer = new MutationObserver(() => {
    const summary = document.querySelector('[data-testid="bond-sentence"], [data-testid="indexed-bond-summary"][data-ready="true"]');
    if (summary && window.__summaryMs === null) requestAnimationFrame(() => { window.__summaryMs ??= performance.now(); });
    if (document.querySelector('[data-testid="bond-sentence"]') && window.__fullSummaryMs === null) requestAnimationFrame(() => { window.__fullSummaryMs ??= performance.now(); });
  });
  observer.observe(document, { subtree: true, childList: true });
});
const runs = [];
for (const state of ['cold', 'warm']) {
  const requests = [], pending = new Map(), errors = [];
  const request = r => {
    const url = r.url();
    const kind = url.includes('/graphql') ? 'GraphQL' : url.includes('/api/registry') ? 'registry' : url.includes('testnet-rpc.monad.xyz') ? 'RPC' : null;
    if (!kind) return;
    const payload = r.postData();
    const row = { kind, url, startMs: Date.now() - epoch, durationMs: null, status: null, payload: payload ? JSON.parse(payload) : null };
    requests.push(row); pending.set(r, row);
  };
  const finished = async r => {
    const row = pending.get(r); if (!row) return;
    row.durationMs = Date.now() - epoch - row.startMs;
    row.status = (await r.response())?.status() || r.failure()?.errorText;
  };
  const error = e => errors.push(e.message);
  page.on('request', request); page.on('requestfinished', finished); page.on('requestfailed', finished); page.on('pageerror', error);
  const epoch = Date.now();
  await page.goto(`${base}/bonds/${bond}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__summaryMs !== null, { timeout: 60000 }).catch(() => {});
  // Fixed observation window includes progressive section reads, excludes late polling in navigation checks.
  const remaining = Math.max(0, 25000 - (Date.now() - epoch));
  if (remaining) await page.waitForTimeout(remaining);
  const timings = await page.evaluate(() => ({ serverIndexerMs: Number(document.querySelector('meta[name="bondrail:indexer-ms"]')?.content || 0), serverIndexerRequests: Number(document.querySelector('meta[name="bondrail:indexer-requests"]')?.content || 0), summaryMs: window.__summaryMs, fullSummaryMs: window.__fullSummaryMs, navigation: performance.getEntriesByType('navigation')[0].toJSON(), resources: performance.getEntriesByType('resource').map(r => r.toJSON()) }));
  const text = await page.locator('main').innerText().catch(() => page.locator('body').innerText());
  await page.screenshot({ path: `docs/ux/performance/${label}-${state}-375.png`, fullPage: true });
  const run = { state, base, measuredAt: new Date().toISOString(), viewport: '375x812', network: 'Host network; no artificial throttling; Chrome headless; same machine', ...timings, requests, errors, text };
  runs.push(run);
  await writeFile(`docs/ux/performance/${label}.json`, JSON.stringify(runs, null, 2) + '\n');
  console.log(JSON.stringify({ label, state, summaryMs: run.summaryMs, fullSummaryMs: run.fullSummaryMs, requests: requests.map(({kind,startMs,durationMs,status})=>({kind,startMs,durationMs,status})), errors }));
  page.off('request', request); page.off('requestfinished', finished); page.off('requestfailed', finished); page.off('pageerror', error);
}
await context.close(); await browser.close();
