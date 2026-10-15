// Run against a local production build configured from apps/web/.env.example.
// All remote access is read-only. The injected review wallet cannot sign or send transactions.
import { chromium, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const out = fileURLToPath(new URL('.', import.meta.url));
const root = new URL('../../../', import.meta.url);
const deployment = JSON.parse(await readFile(new URL('docs/deployments/10143.json', root), 'utf8'));
const registry = JSON.parse(await readFile(new URL('./registry-snapshot.json', import.meta.url), 'utf8'));
const base = process.env.PHASE_A_BASE_URL || 'http://127.0.0.1:3210';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Use a local app build');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
const errors = [];

async function openPage(viewport, phase) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/registry?*', route => route.fulfill({ json: registry }));
  // The additional Closing/Closed checks change only an in-browser response, never the indexer.
  if (phase !== undefined) await page.route('**/v1/graphql', async route => {
    const body = route.request().postDataJSON();
    if (!body.query?.includes('CovenantCheck')) return route.continue();
    const response = await route.fetch();
    const json = await response.json();
    for (const b of json.data.Bond) if (b.id === deployment.issuers.agent.bond.toLowerCase()) b.phase = phase;
    await route.fulfill({ json });
  });
  await page.addInitScript(investor => {
    window.__reviewWalletWrites = 0;
    window.ethereum = {
      isMetaMask: true, on() {}, removeListener() {},
      async request({ method }) {
        if (['eth_accounts', 'eth_requestAccounts'].includes(method)) return [investor];
        if (method === 'eth_chainId') return '0x279f';
        if (method === 'net_version') return '10143';
        if (['wallet_requestPermissions', 'wallet_getPermissions'].includes(method)) return [{ parentCapability: 'eth_accounts' }];
        window.__reviewWalletWrites++;
        throw new Error('Read-only review wallet: method blocked: ' + method);
      },
    };
  }, deployment.roles.investor);
  return { context, page };
}
async function connect(page) {
  if (await page.getByRole('button', { name: 'Connect', exact: true }).isVisible()) {
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Browser wallet' }).click();
  }
  await expect(page.getByRole('button', { name: 'Disconnect wallet' })).toBeVisible();
}
async function noOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
async function reveal(page) {
  const height = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y < height; y += 650) {
    await page.evaluate(y => scrollTo(0, y), y);
    await page.waitForTimeout(60);
  }
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(600);
}
async function bond(page, key, title) {
  await page.goto(`${base}/bonds/${deployment.issuers[key].bond}`);
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible({ timeout: 90_000 });
  const maintenance = page.locator('details').filter({ has: page.getByText('Maintenance (anyone can run)', { exact: true }) });
  await expect(maintenance).not.toHaveAttribute('open', '');
  await expect(page.getByRole('button', { name: 'Book pending transfers (sweep)', exact: true })).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Record bond', exact: true })).not.toBeVisible();
  await noOverflow(page);
}

try {
  for (const [size, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 375, height: 844 }]]) {
    const { context, page } = await openPage(viewport);
    await page.goto(base);
    const stats = page.getByRole('region', { name: 'Live protocol numbers' });
    await expect(stats.getByText('Live bonds', { exact: true }).locator('..')).toContainText('[2]', { timeout: 60_000 });
    // Assert the regression before scrolling to the below-the-fold strip.
    expect(await page.evaluate(() => scrollY)).toBe(0);
    const text = await stats.innerText();
    expect(text).toMatch(/\[\$0\.\d+\]/);
    expect(text).not.toContain('[$0]');
    expect(text).not.toContain('[0]');
    await noOverflow(page);
    await reveal(page);
    await page.screenshot({ path: `${out}landing-${size}.png`, fullPage: true });
    results.push({ check: `${size}: stats render before scrolling; landing has no overflow`, stats: text });

    await bond(page, 'curvelab', 'CurveLab');
    await expect(page.getByText('Deployed from a reviewed template.', { exact: true })).toBeVisible();
    const yieldPanel = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Implied yield', exact: true }) });
    await expect(yieldPanel).toContainText('Raise price');
    await expect(yieldPanel).toContainText('$1.00');
    expect(await yieldPanel.innerText()).not.toMatch(/\n–\n/);
    await expect(page.getByRole('button', { name: 'Deposit', exact: true })).toHaveClass(/bg-primary/);
    await page.screenshot({ path: `${out}funding-${size}.png`, fullPage: true });
    results.push({ check: `${size}: Funding deposit primary, reviewed template, numeric par yield, collapsed maintenance` });

    await bond(page, 'agent', 'Oracle Agent');
    await expect(page.getByText('No market yet — yield appears once claims trade', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Implied yield', exact: true })).toHaveCount(0);
    await connect(page);
    await noOverflow(page);
    const amount = page.getByLabel('Amount (claims)', { exact: true });
    const redeem = page.getByRole('button', { name: 'Redeem early', exact: true });
    await amount.fill('3');
    await expect(redeem).toBeDisabled();
    await amount.fill('2'); // The investor owns the entire outstanding supply in this snapshot.
    await expect(redeem).toBeDisabled();
    await amount.fill('0.0000001'); // Reject values below the asset's precision.
    await expect(redeem).toBeDisabled();
    await amount.fill('0.1');
    await expect(redeem).toBeEnabled({ timeout: 30_000 });
    await expect(redeem).not.toHaveClass(/bg-primary/);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: `${out}active-${size}.png`, fullPage: true });
    await redeem.click();
    const dialog = page.getByRole('dialog', { name: 'Confirm early redemption' });
    const burn = dialog.getByRole('button', { name: 'Burn claims and redeem', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('0.003875 USDC');
    await expect(dialog).toContainText('Estimated additional revenue by maturity');
    await expect(burn).toBeDisabled();
    await dialog.getByRole('checkbox').check();
    await expect(burn).toBeEnabled();
    await dialog.getByRole('button', { name: 'Keep my claims' }).click();
    await expect(dialog).not.toBeVisible();
    await expect(redeem).toBeFocused();
    await amount.fill('0.2');
    await redeem.click();
    await expect(dialog.getByRole('checkbox')).not.toBeChecked();
    await expect(dialog).toContainText('0.00775 USDC');
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await amount.fill('0.1');
    await redeem.click();
    await expect(dialog.getByRole('checkbox')).not.toBeChecked();
    expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
    await noOverflow(page);
    await page.screenshot({ path: `${out}active-confirmation-${size}.png` });
    results.push({ check: `${size}: secondary redemption; quote, acknowledgement, cancel, Escape, changed amount, balance/precision/last-holder guards; modal focus; no overflow`, confirmation: await dialog.innerText() });
    expect(await page.evaluate(() => window.__reviewWalletWrites)).toBe(0);
    await context.close();
  }
  for (const [phase, name] of [[2, 'Closing'], [3, 'Closed']]) {
    const { context, page } = await openPage({ width: 1440, height: 1000 }, phase);
    await bond(page, 'agent', 'Oracle Agent');
    await connect(page);
    await page.getByLabel('Amount (claims)', { exact: true }).fill('0.1');
    if (phase === 2) {
      await page.getByRole('button', { name: 'Redeem early', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText('Revenue collection has ended');
      await expect(dialog).toContainText('$0.00');
      await expect(dialog.getByRole('button', { name: 'Burn claims and redeem' })).toBeDisabled();
    } else {
      await expect(page.getByRole('button', { name: 'Redeem', exact: true })).toHaveClass(/bg-primary/);
      await expect(page.getByRole('button', { name: 'Redeem early', exact: true })).toHaveCount(0);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.getByText('Early redemption burns claims for current backing and gives up their future receipts.')).toHaveCount(0);
    }
    expect(await page.evaluate(() => window.__reviewWalletWrites)).toBe(0);
    results.push({ check: `Synthetic ${name} phase response: correct action and warning behavior; no transaction attempted` });
    await context.close();
  }
  expect(errors).toEqual([]);
  await writeFile(`${out}browser-results.json`, JSON.stringify({ capturedAt: new Date().toISOString(), base, liveData: true, registry: 'Read-only snapshot from bondrail.vercel.app/api/registry', wallet: 'Injected read-only address; signing and sending blocked', errors, results }, null, 2) + '\n');
  console.log(`PASS: ${results.length} browser check groups; screenshots in ${out}`);
} finally {
  await browser.close();
}
