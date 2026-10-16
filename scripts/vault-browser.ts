// Phase C browser acceptance against isolated Anvil only. Never signs for a remote chain.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { encodeFunctionData, parseAbi, type Address } from 'viem';
import type { DeploymentFile } from './lib.ts';

export async function verifyVaultBrowser(o: { browser: Browser; origin: string; rpc: string; deployment: DeploymentFile; investor: Address; curator: Address; output: string }) {
  assert.equal(o.deployment.chainId, 31337);
  assert.match(o.rpc, /^http:\/\/127\.0\.0\.1:\d+$/);
  fs.mkdirSync(o.output, { recursive: true });
  const results: string[] = [];
  const errors: string[] = [];
  async function walletContext(who: Address): Promise<BrowserContext> {
    const ctx = await o.browser.newContext({ reducedMotion: 'reduce' });
    const installWallet = ({ who, rpc }: { who: string; rpc: string }) => {
      const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
      let walletChain = '0x7a69';
      const provider = {
        isMetaMask: true,
        on: (event: string, listener: (...args: unknown[]) => void) => listeners.set(event, [...listeners.get(event) ?? [], listener]),
        removeListener: (event: string, listener: (...args: unknown[]) => void) => listeners.set(event, (listeners.get(event) ?? []).filter(l => l !== listener)),
        request: async ({ method, params = [] }: { method: string; params?: unknown[] }) => {
          if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [who];
          if (method === 'eth_chainId') return walletChain;
          if (method === 'wallet_switchEthereumChain') {
            walletChain = '0x7a69';
            for (const fn of listeners.get('chainChanged') ?? []) fn(walletChain);
            return null;
          }
          if (method === 'wallet_requestPermissions' || method === 'wallet_getPermissions') return [{ parentCapability: 'eth_accounts' }];
          if (method === 'wallet_revokePermissions') return null;
          if (method.startsWith('wallet_') || method.includes('sign')) throw new Error(`Unsupported test-wallet method ${method}`);
          if (method === 'eth_sendTransaction' && walletChain !== '0x7a69') throw new Error('Only local Anvil writes are allowed');
          const r = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
          const body = await r.json();
          if (body.error) throw new Error(body.error.message);
          return body.result;
        },
      };
      Object.defineProperty(window, 'ethereum', { value: provider });
      Object.assign(window, { phaseCWrongNetwork: () => {
        walletChain = '0x1'; for (const fn of listeners.get('chainChanged') ?? []) fn(walletChain);
      } });
    };
    await ctx.addInitScript({ content: `globalThis.__name = value => value; (${installWallet.toString()})(${JSON.stringify({ who, rpc: o.rpc })});` });
    return ctx;
  }
  const ctx = await walletContext(o.investor);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  const connect = async (p: Page) => {
    await p.getByRole('button', { name: 'Connect', exact: true }).click();
    await p.getByRole('menuitem', { name: 'Browser wallet', exact: true }).click();
    await p.getByRole('button', { name: 'Disconnect wallet' }).waitFor();
  };
  const overflow = async (p: Page) => assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'No horizontal overflow');
  const shot = async (name: string, width: number) => {
    await page.evaluate(() => { window.scrollTo(0, 0); });
    await page.waitForTimeout(80);
    await overflow(page);
    await page.screenshot({ path: path.join(o.output, `${name}-${width}.png`), fullPage: true });
  };
  try {
    for (const width of [375, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${o.origin}/vaults`);
      await page.getByRole('link', { name: 'Patient revenue', exact: true }).waitFor({ timeout: 45_000 });
      await page.getByRole('link', { name: 'Bondrail Credit', exact: true }).waitFor();
      assert.equal(await page.getByText('Anyone can create a vault.', { exact: false }).count(), 2);
      assert.equal(await page.getByText('Created by the Bondrail team', { exact: true }).count(), 1);
      await page.getByText(/30-day exit price · [2-9] observations/).first().waitFor({ timeout: 60_000 });
      await shot('vaults', width);
      await page.getByLabel('Strategy', { exact: true }).fill('Patient');
      assert.equal(await page.getByRole('link', { name: 'Bondrail Credit', exact: true }).count(), 0);
      await page.getByLabel('Strategy', { exact: true }).fill('');
      await page.goto(`${o.origin}/vault`);
      await page.getByRole('heading', { name: 'Bondrail Credit', exact: true }).waitFor({ timeout: 45_000 });
      await page.getByText('Anyone can create a vault.', { exact: false }).waitFor();
      await page.getByText('Created by the Bondrail team', { exact: true }).waitFor();
      assert.match(page.url().toLowerCase(), new RegExp(`/vaults/${o.deployment.vault!.toLowerCase()}`));
      await page.getByRole('link', { name: 'PumpLab Revenue Claim', exact: true }).waitFor();
      await page.getByText(/30-day exit price · [2-9] observations/).waitFor({ timeout: 60_000 });
      assert.equal(await page.getByRole('heading', { name: 'Curator console' }).count(), 0);
      assert.equal(await page.locator('details').getByText('Technical details', { exact: true }).count(), 1);
      if (width === 375) {
        await page.getByText('Connect a wallet to continue.', { exact: false }).waitFor();
        await connect(page);
      }
      await page.getByText('Balance: 1 testUSDC', { exact: false }).waitFor({ timeout: 45_000 });
      await shot('vault', width);
      await page.getByLabel('Amount (testUSDC)', { exact: true }).fill('0.1');
      await page.getByText('You receive ≈', { exact: false }).waitFor();
      await page.getByRole('button', { name: 'Approve testUSDC', exact: true }).waitFor();
      await page.getByText(/If you withdrew right away you'd get ≈ 0\.08750\d testUSDC \(12\.5% less\)/).waitFor();
      const acknowledge = page.getByRole('checkbox', { name: 'I understand that withdrawing right away would return less than I deposit.' });
      assert.equal(await acknowledge.isChecked(), false);
      assert.equal(await page.locator('#vault-submit').isEnabled(), false);
      await shot('deposit-preview', width);
      await acknowledge.check();
      await page.locator('#vault-submit:enabled').waitFor();
      await page.getByLabel('Amount (testUSDC)', { exact: true }).fill('0.2');
      assert.equal(await acknowledge.isChecked(), false);
      assert.equal(await page.locator('#vault-submit').isEnabled(), false);
      await page.getByRole('button', { name: 'Withdraw', exact: true }).first().click();
      await page.getByLabel('Amount (testUSDC)', { exact: true }).fill('2');
      await page.getByText('This exceeds what you can withdraw now.', { exact: false }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Withdraw', exact: true }).last().isEnabled(), false);
      await shot('withdraw-capped', width);
      await page.getByLabel('Shares', { exact: true }).check();
      await page.getByRole('button', { name: 'Max', exact: true }).click();
      await page.getByText('You receive ≈', { exact: false }).waitFor();
      await page.goto(`${o.origin}/portfolio`);
      await page.getByRole('link', { name: 'Review withdrawal →', exact: true }).waitFor({ timeout: 60_000 });
      await page.getByText('Remaining deposit cost', { exact: true }).waitFor();
      await page.getByText('2 testUSDC', { exact: true }).waitFor({ timeout: 60_000 });
      await shot('portfolio-vault-position', width);
      await page.getByRole('link', { name: 'Review withdrawal →', exact: true }).click();
      await page.getByText('You can withdraw up to', { exact: false }).waitFor();
    }
    results.push('Two strategies, filtering, legacy redirect, real previews/caps/positions, hidden curator, 375/1280 screenshots and no overflow');
    results.push('Every card/detail discloses permissionless listing; only original operator-owned vault has team badge; real 12.5% exit gap blocks approval until acknowledged and resets on amount change');
    // Exercise defensive states using read-only RPC overrides on the local chain.
    // Real transaction checks below restore the untouched Anvil responses.
    const maxSelector = encodeFunctionData({ abi: parseAbi(['function maxDeposit(address) view returns (uint256)']), functionName: 'maxDeposit', args: [o.investor] }).slice(0, 10);
    const previewSelector = encodeFunctionData({ abi: parseAbi(['function previewDeposit(uint256) view returns (uint256)']), functionName: 'previewDeposit', args: [1n] }).slice(0, 10);
    let zeroSelector = maxSelector;
    await ctx.route(o.rpc, async route => {
      const payload = route.request().postDataJSON();
      const calls = Array.isArray(payload) ? payload : [payload];
      const response = await route.fetch();
      const original = await response.json();
      const replies = Array.isArray(original) ? original : [original];
      for (const call of calls) {
        if (call.method !== 'eth_call' || !String(call.params[0].data).startsWith(zeroSelector)) continue;
        const reply = replies.find((r: { id: unknown }) => r.id === call.id);
        if (reply) reply.result = `0x${'0'.repeat(64)}`;
      }
      await route.fulfill({ response, json: Array.isArray(original) ? replies : replies[0] });
    });
    await page.goto(`${o.origin}/vaults/${o.deployment.vault}`);
    await page.getByText('Closed to deposits: the vault currently reports a zero deposit limit.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Closed to deposits', exact: true }).isEnabled(), false);
    zeroSelector = previewSelector;
    await page.reload();
    await page.getByLabel('Amount (testUSDC)', { exact: true }).fill('0.1');
    await page.getByText('This amount rounds to zero shares. Increase the deposit.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Approve testUSDC', exact: true }).isEnabled(), false);
    await ctx.unrouteAll({ behavior: 'wait' });
    results.push('Closed-deposit reason and zero-share rejection verified through local read-only RPC overrides');

    const exitSelector = encodeFunctionData({ abi: parseAbi(['function previewRedeem(uint256) view returns (uint256)']), functionName: 'previewRedeem', args: [1n] }).slice(0, 10);
    const ownerSelector = encodeFunctionData({ abi: parseAbi(['function owner() view returns (address)']), functionName: 'owner' });
    let exitValue: bigint | undefined = 98_000n;
    let failExit = false;
    await ctx.route(o.rpc, async route => {
      const payload = route.request().postDataJSON();
      const calls = Array.isArray(payload) ? payload : [payload];
      const response = await route.fetch();
      const original = await response.json();
      const replies = Array.isArray(original) ? original : [original];
      for (const call of calls) {
        if (call.method !== 'eth_call') continue;
        const reply = replies.find((r: { id: unknown }) => r.id === call.id);
        if (!reply) continue;
        if (call.params[0].data === ownerSelector) reply.result = `0x${o.investor.slice(2).padStart(64, '0')}`;
        if (String(call.params[0].data).startsWith(exitSelector) && BigInt(`0x${String(call.params[0].data).slice(10)}`) === 100_000_000_000n) {
          if (failExit) { delete reply.result; reply.error = { code: -32000, message: 'Exit preview unavailable' }; }
          else if (exitValue !== undefined) reply.result = `0x${exitValue.toString(16).padStart(64, '0')}`;
        }
      }
      await route.fulfill({ response, json: Array.isArray(original) ? replies : replies[0] });
    });
    for (const [value, percent, required] of [[100_000n, undefined, false], [98_001n, '2', false], [98_000n, '2', false], [97_999n, '2.01', true]] as const) {
      exitValue = value;
      await page.reload();
      await page.getByRole('heading', { name: 'Bondrail Credit', exact: true }).waitFor();
      assert.equal(await page.getByText('Created by the Bondrail team', { exact: true }).count(), 0, 'Owner mismatch suppresses team badge');
      await page.getByLabel('Amount (testUSDC)', { exact: true }).fill('0.1');
      await page.getByText('You receive ≈', { exact: false }).waitFor();
      if (percent) await page.getByText(`(${percent}% less)`, { exact: false }).waitFor();
      else assert.equal(await page.locator('#vault-gap-warning').count(), 0);
      const ack = page.getByRole('checkbox');
      assert.equal(await ack.count(), required ? 1 : 0);
      if (required) {
        assert.equal(await page.locator('#vault-submit').isEnabled(), false);
        await ack.check(); await page.locator('#vault-submit:enabled').waitFor();
        exitValue = 95_000n;
        await page.getByText('(5% less)', { exact: false }).waitFor({ timeout: 15_000 });
        assert.equal(await ack.isChecked(), false, 'Changed exit quote requires fresh acknowledgement');
        assert.equal(await page.locator('#vault-submit').isEnabled(), false);
      } else await page.locator('#vault-submit:enabled').waitFor();
    }
    failExit = true;
    await page.reload();
    await page.getByLabel('Amount (testUSDC)', { exact: true }).fill('0.1');
    await page.getByText('Could not refresh balances or preview. Retry before continuing.', { exact: true }).waitFor();
    assert.equal(await page.locator('#vault-submit').isEnabled(), false);
    await ctx.unrouteAll({ behavior: 'wait' });
    results.push('Local read-only overrides: owner mismatch removes badge; zero/below/exactly/above 2% gaps; changed quote resets acknowledgement; failed exit preview blocks submission');

    await page.reload();
    await page.getByRole('heading', { name: 'Bondrail Credit', exact: true }).waitFor();
    await page.getByLabel('Amount (testUSDC)', { exact: true }).fill('5');
    await page.getByText('Insufficient asset balance.', { exact: true }).waitFor();
    await page.evaluate(() => (window as unknown as { phaseCWrongNetwork(): void }).phaseCWrongNetwork());
    await page.getByText('Switch your wallet to the configured network to continue.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Switch to Local development', exact: true }).last().click();
    await page.getByLabel('Amount (testUSDC)', { exact: true }).fill('0.1');
    const approve = page.getByRole('button', { name: 'Approve testUSDC', exact: true });
    await approve.waitFor();
    await page.getByRole('checkbox', { name: 'I understand that withdrawing right away would return less than I deposit.' }).check();
    await approve.click();
    await page.getByText(/Approval confirmed in/).waitFor({ timeout: 30_000 });
    const deposit = page.locator('#vault-submit').filter({ hasText: /^Deposit$/ });
    await page.getByRole('checkbox', { name: 'I understand that withdrawing right away would return less than I deposit.' }).check();
    // Approval waits for all vault queries (including indexer history) to refresh before clearing busy.
    await deposit.click({ timeout: 60_000 });
    await page.getByText(/Deposit confirmed in/).waitFor({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Withdraw', exact: true }).first().click({ timeout: 60_000 });
    await page.getByLabel('Amount (testUSDC)', { exact: true }).fill('0.05');
    await page.getByRole('button', { name: 'Withdraw', exact: true }).last().click();
    await page.getByText(/Withdrawal confirmed in/).waitFor({ timeout: 30_000 });
    results.push('Injected wallet: wrong-network recovery, insufficient balance, approval → deposit → withdrawal with measured receipts on local Anvil');
    const curatorContext = await walletContext(o.curator);
    const cp = await curatorContext.newPage();
    cp.on('pageerror', e => errors.push(e.message));
    try {
      await cp.goto(`${o.origin}/vaults/${o.deployment.vault}`);
      await cp.getByRole('heading', { name: 'Bondrail Credit', exact: true }).waitFor();
      await connect(cp);
      await cp.getByRole('heading', { name: 'Curator console', exact: true }).waitFor();
      await cp.locator('#curator-bond').selectOption(o.deployment.issuers.curvelab!.bond!.toLowerCase());
      await cp.getByText('Allocation headroom:', { exact: false }).waitFor();
      await cp.getByLabel('Allocation / raise withdrawal (testUSDC)', { exact: true }).fill('0.01');
      await cp.getByRole('button', { name: 'Allocate', exact: true }).click();
      await cp.getByText(/Allocation confirmed in/).waitFor({ timeout: 30_000 });
      await cp.getByRole('button', { name: 'Withdraw from raise', exact: true }).click();
      await cp.getByText(/Raise withdrawal confirmed in/).waitFor({ timeout: 30_000 });
      results.push('Curator-only console verifies headroom, allocates and withdraws from raise on local Anvil');
    } catch (error) {
      fs.writeFileSync(path.join(o.output, 'curator-failure.txt'), await cp.locator('body').innerText());
      await cp.screenshot({ path: path.join(o.output, 'curator-failure.png'), fullPage: true });
      throw error;
    } finally { await curatorContext.close(); }
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(o.output, 'browser-results.json'), JSON.stringify({ chainId: 31337, results, errors, screenshots: 10 }, null, 2) + '\n');
  } catch (error) {
    fs.writeFileSync(path.join(o.output, 'browser-errors.json'), JSON.stringify(errors));
    fs.writeFileSync(path.join(o.output, 'browser-failure.txt'), await page.locator('body').innerText());
    await page.screenshot({ path: path.join(o.output, 'browser-failure.png'), fullPage: true });
    throw error;
  } finally { await ctx.close(); }
}
