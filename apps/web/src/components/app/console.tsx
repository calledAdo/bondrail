'use client';
// The issuer console: one checklist, driven by what is on-chain and indexed, so it resumes anywhere.
//   (01) account  (02) source  (03) history  (04) profile  (05) review (Native)
//   (06) bond terms + create  (07) raise and activate  (08) Kuru market  (09) manage
import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAccount, useBlock, usePublicClient, useReadContract, useReadContracts, useWalletClient } from 'wagmi';
import {
  erc20Abi,
  getContractAddress,
  isAddress,
  keccak256,
  parseEventLogs,
  parseUnits,
  stringToHex,
  type Abi,
  type Address,
  type Hash,
  type Hex,
} from 'viem';
import { Check, Circle, ExternalLink, Lock } from 'lucide-react';
import { PARSER_VERSION, policyHash, type WatchPolicy } from '@slice/observer/protocol';
import { accountAbi, bondAbi, factoryAbi } from '@/lib/abi';
import { chain, deployment } from '@/lib/wallet';
import { LIMITS, profileDomain, profileTypes } from '@/lib/profile';
import { days, fmt, short, useProtocol, type AccountView, type BondView } from '@/lib/protocol';
import { cn } from '@/lib/cn';
import { Badge, Empty } from './ui';

const KURU_ROUTER: Address = '0x7EFbE105Ca7415dE98F96622173458ac1c054630';
const kuruAbi = [
  {
    type: 'function',
    name: 'deployProxy',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_type', type: 'uint8' },
      { name: '_baseAssetAddress', type: 'address' },
      { name: '_quoteAssetAddress', type: 'address' },
      { name: '_sizePrecision', type: 'uint96' },
      { name: '_pricePrecision', type: 'uint32' },
      { name: '_tickSize', type: 'uint32' },
      { name: '_minSize', type: 'uint96' },
      { name: '_maxSize', type: 'uint96' },
      { name: '_takerFeeBps', type: 'uint256' },
      { name: '_makerFeeBps', type: 'uint256' },
      { name: '_kuruAmmSpread', type: 'uint96' },
    ],
    outputs: [{ name: 'proxy', type: 'address' }],
  },
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'payable',
    inputs: [
      { name: 'baseDeposit', type: 'uint256' },
      { name: 'quoteDeposit', type: 'uint256' },
      { name: 'minQuoteConsumed', type: 'uint256' },
      { name: 'receiver', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
] as const;

type Status = 'done' | 'current' | 'blocked';
type Call = { address: Address; abi: Abi; functionName: string; args?: unknown[] };

/** Simulate, send, wait for the receipt; one status line per console. */
function useSend(onDone: () => void) {
  const { address } = useAccount();
  const client = usePublicClient();
  const { data: wallet } = useWalletClient();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; error?: boolean; hash?: Hash }>();
  async function send(label: string, call: Call) {
    setBusy(true);
    setStatus({ text: `${label}: confirm in your wallet…` });
    try {
      if (!client || !wallet || !address) throw new Error(`Connect a wallet on ${chain.name}.`);
      const sim = (await client.simulateContract({ account: address, ...call } as never)) as unknown as { request: never };
      const hash = await wallet.writeContract(sim.request);
      setStatus({ text: `${label}: waiting for the receipt…`, hash });
      const r = await client.waitForTransactionReceipt({ hash });
      if (r.status !== 'success') throw new Error('The transaction reverted.');
      setStatus({ text: `${label}: confirmed.`, hash });
      onDone();
      return r;
    } catch (e) {
      // viem puts the decoded contract error (e.g. "Error: InvalidTerms()") in metaMessages.
      const m = e as { shortMessage?: string; message?: string; metaMessages?: string[] };
      const reason = m.metaMessages?.find((x) => x.startsWith('Error:'))?.replace('Error: ', '');
      setStatus({ text: `${label}: ${(reason ? `reverted with ${reason}` : m.shortMessage ?? m.message ?? 'failed').slice(0, 280)}`, error: true });
    } finally {
      setBusy(false);
    }
  }
  return { send, busy, status, setStatus };
}

function Step({ index, title, status, summary, children }: { index: number; title: string; status: Status; summary?: ReactNode; children?: ReactNode }) {
  const [open, setOpen] = useState(status === 'current');
  useEffect(() => setOpen(status === 'current'), [status]);
  return (
    <li className={cn('rounded-xl border p-5 transition-colors', status === 'current' ? 'border-foreground/25' : 'border-foreground/10')}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-4 text-left" aria-expanded={open}>
        <span className="font-mono text-xs text-foreground/60">({String(index).padStart(2, '0')})</span>
        <span className="flex-1 font-medium">{title}</span>
        {summary && <span className="hidden text-sm text-foreground/60 sm:inline">{summary}</span>}
        {status === 'done' ? (
          <Check className="size-4 text-emerald-500" aria-label="Done" />
        ) : status === 'blocked' ? (
          <Lock className="size-4 text-foreground/30" aria-label="Waiting on an earlier step" />
        ) : (
          <Circle className="size-4 text-foreground/60" aria-label="To do" />
        )}
      </button>
      {open && children && <div className="mt-5 space-y-4 border-t border-foreground/10 pt-5 text-sm">{children}</div>}
    </li>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs text-foreground/60">{label}</span>
      {children}
      {hint && <span className="block text-xs text-foreground/50">{hint}</span>}
    </label>
  );
}
const input = 'h-10 w-full rounded-lg border border-foreground/15 bg-transparent px-3 text-sm outline-none focus:border-foreground/40';
function Action({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="h-10 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40">
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- the console

export function Console() {
  const { address } = useAccount();
  const { data, loading, configured } = useProtocol();
  const [refresh, setRefresh] = useState(0);
  const tx = useSend(() => setRefresh((n) => n + 1));
  const mine = useMemo(() => (data?.accounts ?? []).filter((a) => address && a.issuer.toLowerCase() === address.toLowerCase()), [data, address]);
  const [selected, setSelected] = useState<Address | 'new'>();
  const account = selected === 'new' ? undefined : mine.find((a) => a.address === selected) ?? mine[0];
  const bonds = (data?.bonds ?? []).filter((b) => account && b.account === account.address);
  const live = bonds.find((b) => b.phase === 'Funding' || b.phase === 'Active' || b.phase === 'Closing');

  if (!configured) return <Empty title="No indexer configured" />;
  if (!address) return <Empty title="Connect the issuer wallet">The console reads your accounts and bonds from the chain.</Empty>;
  if (loading) return <div className="h-96 animate-pulse rounded-xl border border-foreground/10" />;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div className="space-y-3">
          <p className="font-mono text-xs text-foreground/60">(console)</p>
          <h1 className="text-4xl font-semibold">Raise against revenue</h1>
          <p className="max-w-xl text-foreground/60">Each step reads its state from the chain, so you can leave and come back at any point.</p>
        </div>
        {mine.length > 0 && (
          <select
            value={selected ?? account?.address}
            onChange={(e) => setSelected(e.target.value as Address | 'new')}
            className={cn(input, 'w-auto font-mono')}
            aria-label="Account"
          >
            {mine.map((a) => (
              <option key={a.address} value={a.address}>
                {a.profile?.profile.name || short(a.address)}
              </option>
            ))}
            <option value="new">+ New account</option>
          </select>
        )}
      </header>
      <Checklist key={`${account?.address ?? 'new'}-${refresh}`} account={account} bonds={bonds} live={live} tx={tx} />
      {tx.status && (
        <p role={tx.status.error ? 'alert' : 'status'} className={cn('text-sm', tx.status.error ? 'text-red-500' : 'text-foreground/70')}>
          {tx.status.text}{' '}
          {tx.status.hash && (
            <a href={`${chain.blockExplorers?.default.url}/tx/${tx.status.hash}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline-offset-4 hover:underline">
              View <ExternalLink className="size-3" />
            </a>
          )}
        </p>
      )}
    </div>
  );
}

function Checklist({ account, bonds, live, tx }: { account?: AccountView; bonds: BondView[]; live?: BondView; tx: ReturnType<typeof useSend> }) {
  const { address } = useAccount();
  const { data: wallet } = useWalletClient();
  const factory = deployment.factory;
  const reads = useReadContracts({
    contracts: [
      { address: factory, abi: factoryAbi, functionName: 'minHistory', chainId: chain.id },
      { address: factory, abi: factoryAbi, functionName: 'nativeApproved', args: [account?.project ?? '0x0000000000000000000000000000000000000000'], chainId: chain.id },
      { address: account?.address, abi: accountAbi, functionName: 'issuerCredit', chainId: chain.id },
      { address: account?.address, abi: accountAbi, functionName: 'project', chainId: chain.id },
      { address: factory, abi: factoryAbi, functionName: 'covenant', chainId: chain.id },
      { address: factory, abi: factoryAbi, functionName: 'templateOf', args: [account?.project ?? '0x0000000000000000000000000000000000000000'], chainId: chain.id },
    ] as never[],
    query: { enabled: !!factory, refetchInterval: 10_000 },
  });
  const [minHistory, approvedDirect, credit, project, covenant, template] = (reads.data ?? []).map((r) => r.result) as [bigint?, boolean?, bigint?, Address?, Address?, Hex?];
  // A project deployed from a reviewed template (deployNative) needs no review of its own.
  const fromTemplate = !!template && !/^0x0{64}$/i.test(template);
  const { data: templateOk } = useReadContract({
    address: factory,
    abi: factoryAbi,
    functionName: 'nativeTemplate',
    args: [template ?? '0x0000000000000000000000000000000000000000000000000000000000000000'],
    chainId: chain.id,
    query: { enabled: !!factory && fromTemplate, refetchInterval: 10_000 },
  });
  const approved = !!approvedDirect || (fromTemplate && !!templateOk);
  const boundProject = project && !/^0x0{40}$/i.test(project) ? project : undefined;

  // (01) account
  const [asset, setAsset] = useState<string>(deployment.token ?? '');
  // (02) source
  const [tier, setTier] = useState<'Native' | 'Watched'>(account?.tier ?? 'Native');
  const [projectInput, setProjectInput] = useState('');
  const [manifestUrl, setManifestUrl] = useState('');
  const [manifest, setManifest] = useState<{ ok: boolean; note: string; endpoints: string[] }>();
  // (04) profile
  const p = account?.profile?.profile;
  const [profile, setProfile] = useState({ name: p?.name ?? '', description: p?.description ?? '', website: p?.website ?? '', x: p?.x ?? '', useOfFunds: p?.useOfFunds ?? '' });
  const [profileNote, setProfileNote] = useState('');

  // History age in chain time (what the factory checks), not the browser clock.
  const { data: block } = useBlock({ watch: true, chainId: chain.id });
  const chainNow = block ? Number(block.timestamp) : Date.now() / 1000;
  const age = account?.firstRevenueAt ? chainNow - account.firstRevenueAt : 0;
  const historyOk = !!account?.firstRevenueAt && age >= Number(minHistory ?? 0n);
  const sourceOk = tier === 'Native' ? !!boundProject : !!manifest?.ok;
  const reviewed = tier === 'Watched' || !!approved;
  const s = (done: boolean, ready: boolean): Status => (done ? 'done' : ready ? 'current' : 'blocked');

  async function checkManifest() {
    try {
      const u = new URL(manifestUrl);
      const r = await fetch(`${u.origin}/.well-known/slice.json`, { cache: 'no-store' });
      const m = (await r.json()) as { account?: string; chainId?: number; endpoints?: string[] };
      const ok = !!account && m.account?.toLowerCase() === account.address.toLowerCase() && m.chainId === chain.id;
      setManifest({ ok, endpoints: m.endpoints ?? [], note: ok ? `Lists your account and ${m.endpoints?.length ?? 0} paid endpoint(s).` : 'The manifest does not name this account on this chain.' });
    } catch {
      setManifest({ ok: false, endpoints: [], note: 'No readable /.well-known/slice.json at that origin.' });
    }
  }

  async function signProfile() {
    setProfileNote('');
    try {
      if (!account || !wallet) throw new Error('Connect the issuer wallet.');
      const message = { account: account.address, ...profile, updatedAt: BigInt(Math.floor(Date.now() / 1000)) };
      const signature = await wallet.signTypedData({ domain: profileDomain(chain.id), types: profileTypes, primaryType: 'Profile', message });
      const r = await fetch('/api/registry', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'profile', profile: { ...message, updatedAt: String(message.updatedAt) }, signature }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setProfileNote(j.domainVerified ? 'Saved. Domain verified.' : 'Saved. Domain not verified: serve /.well-known/slice.json naming your account on your website.');
    } catch (e) {
      setProfileNote((e as Error).message);
    }
  }

  return (
    <ol className="space-y-3">
      <Step index={1} title="Create your SliceAccount" status={s(!!account, true)} summary={account && <span className="font-mono">{short(account.address)} · {account.asset.symbol}</span>}>
        <p className="text-foreground/70">Your revenue address from day one. Pick the token you charge fees in; your bonds raise and repay in it too.</p>
        <Field label="Fee token" hint="Any ERC-20. Defaults to USDC; the market promotes well-known assets.">
          <input value={asset} onChange={(e) => setAsset(e.target.value)} placeholder="0x…" className={cn(input, 'font-mono')} spellCheck={false} />
        </Field>
        <Action disabled={tx.busy || !factory || !isAddress(asset)} onClick={() => tx.send('Create account', { address: factory!, abi: factoryAbi as Abi, functionName: 'createAccount', args: [asset] })}>
          Create account
        </Action>
      </Step>

      <Step index={2} title="Connect your revenue" status={s(sourceOk, !!account)} summary={boundProject ? <span className="font-mono">project {short(boundProject)}</span> : manifest?.ok ? 'manifest checked' : undefined}>
        <div className="flex gap-2">
          {(['Native', 'Watched'] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTier(t)} className={cn('rounded-lg border px-3 py-1.5', tier === t ? 'border-foreground/40' : 'border-foreground/10 text-foreground/60')}>
              {t === 'Native' ? 'Contract built on Slice' : 'Paid API (x402)'}
            </button>
          ))}
        </div>
        {tier === 'Native' ? (
          boundProject ? (
            <p className="text-foreground/70">Bound to <span className="font-mono">{boundProject}</span>. Every fee it charges builds this account&apos;s history.</p>
          ) : (
            <>
              <p className="text-foreground/70">
                Deploy your contract inheriting <code>SliceEarner(account)</code>, then bind it here (once). <Link href="/docs/guides/native" className="underline-offset-4 hover:underline">Guide</Link>
              </p>
              <Field label="Project contract">
                <input value={projectInput} onChange={(e) => setProjectInput(e.target.value)} placeholder="0x…" className={cn(input, 'font-mono')} spellCheck={false} />
              </Field>
              <Action disabled={tx.busy || !account || !isAddress(projectInput)} onClick={() => tx.send('Bind project', { address: account!.address, abi: accountAbi as Abi, functionName: 'bindProject', args: [projectInput] })}>
                Bind project
              </Action>
            </>
          )
        ) : (
          <>
            <p className="text-foreground/70">
              Set your x402 <code>payTo</code> to <span className="font-mono">{account ? short(account.address) : 'your account'}</span> and serve <code>/.well-known/slice.json</code> listing every paid endpoint.{' '}
              <Link href="/docs/guides/x402" className="underline-offset-4 hover:underline">Guide</Link>
            </p>
            <Field label="Your API's base URL">
              <input value={manifestUrl} onChange={(e) => setManifestUrl(e.target.value)} placeholder="https://api.example.com" className={input} />
            </Field>
            <Action disabled={!manifestUrl} onClick={checkManifest}>
              Check manifest
            </Action>
            {manifest && <p className={manifest.ok ? 'text-foreground/70' : 'text-orange-500'}>{manifest.note}</p>}
          </>
        )}
      </Step>

      <Step
        index={3}
        title="Build history"
        status={s(historyOk, sourceOk)}
        summary={account?.firstRevenueAt ? `${account.payments} payments · ${days(age / 86_400)}` : undefined}
      >
        {!account?.firstRevenueAt ? (
          <p className="text-foreground/70">No payments booked yet. Real traffic through your source starts the clock.</p>
        ) : (
          <p className="text-foreground/70">
            {account.payments} payments, {account.uniquePayers} attributed payers, {fmt(account.verified, account.asset)} attributed revenue.{' '}
            {historyOk ? 'Old enough to raise.' : `The factory needs ${Math.ceil((Number(minHistory ?? 0n) - age) / 60)} more minute(s) of history.`}
          </p>
        )}
      </Step>

      <Step index={4} title="Sign your profile" status={s(!!account?.profile, !!account)} summary={account?.profile && (account.profile.domainVerified ? 'domain verified' : 'signed')}>
        <p className="text-foreground/70">Signed by your issuer wallet; anyone can verify it. Listings without a profile are hidden from the default market view.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {(Object.keys(LIMITS) as (keyof typeof LIMITS)[]).map((k) => (
            <Field key={k} label={{ name: 'Name', description: 'What you do', website: 'Website (domain proof)', x: 'X handle', useOfFunds: 'Use of funds' }[k]}>
              {k === 'description' || k === 'useOfFunds' ? (
                <textarea rows={3} maxLength={LIMITS[k]} value={profile[k]} onChange={(e) => setProfile({ ...profile, [k]: e.target.value })} className={cn(input, 'h-auto py-2')} />
              ) : (
                <input maxLength={LIMITS[k]} value={profile[k]} onChange={(e) => setProfile({ ...profile, [k]: e.target.value })} className={input} />
              )}
            </Field>
          ))}
        </div>
        <Action disabled={!account || !profile.name.trim()} onClick={signProfile}>
          Sign and save profile
        </Action>
        {profileNote && <p className="text-foreground/70">{profileNote}</p>}
      </Step>

      {tier === 'Native' && (
        <Step index={5} title="Code review" status={s(!!approved, !!boundProject)} summary={approved ? 'approved' : undefined}>
          <p className="text-foreground/70">
            Deploy a reviewed template (<code>SliceFactory.deployNative</code>) and you qualify at once; a custom contract waits for the disclosed reviewer to check that every fee goes through <code>SliceEarner</code>. History keeps accruing meanwhile.{' '}
            {approved ? (fromTemplate ? 'Reviewed template.' : 'Approved.') : 'Not yet approved.'}
          </p>
        </Step>
      )}

      <Step index={6} title="Issue a bond" status={s(!!live || bonds.length > 0, historyOk && reviewed && sourceOk && !!account?.profile)} summary={live && <span className="font-mono">{live.symbol}</span>}>
        {account && !live && (
          <TermsBuilder account={account} tier={tier} covenant={covenant} manifest={manifest} project={boundProject} tx={tx} />
        )}
        {live && <p className="text-foreground/70">{live.name} ({live.symbol}) is {live.phase === 'Funding' ? 'raising' : 'live'}.</p>}
      </Step>

      <Step index={7} title="Raise and activate" status={s(!!live && live.phase !== 'Funding', !!live)} summary={live && `${fmt(live.raised, live.asset)} / ${fmt(live.raise, live.asset)}`}>
        {live && (
          <>
            <p className="text-foreground/70">
              Share <Link href={`/bonds/${live.address}`} className="font-mono underline-offset-4 hover:underline">/bonds/{short(live.address)}</Link>. Activate once the raise is full: {live.firstReleasePct}% is released to you and investors start receiving {live.revenueShare}% of every payment.
            </p>
            {live.phase === 'Funding' && (
              <Action disabled={tx.busy || live.raised < live.raise || !factory} onClick={() => tx.send('Activate', { address: factory!, abi: factoryAbi as Abi, functionName: 'activate', args: [live.address] })}>
                Activate
              </Action>
            )}
          </>
        )}
      </Step>

      <Step index={8} title="Open a Kuru market (optional)" status={s(!!live?.kuru, !!live && live.phase !== 'Funding')} summary={live?.kuru && <span className="font-mono">{short(live.kuru.market)}</span>}>
        {live && <KuruStep b={live} tx={tx} />}
      </Step>

      <Step index={9} title="Manage" status={account ? 'current' : 'blocked'} summary={credit !== undefined && account ? `${fmt(Number(credit) / 10 ** account.asset.decimals, account.asset)} to withdraw` : undefined}>
        {account && (
          <>
            <p className="text-foreground/70">Your share of revenue accrues as credit in the account. Withdraw it at any time; the second release and housekeeping are on the bond page.</p>
            <Action
              disabled={tx.busy || !credit || !address}
              onClick={() => tx.send('Withdraw', { address: account.address, abi: accountAbi as Abi, functionName: 'withdraw', args: [address, credit] })}
            >
              Withdraw all credit
            </Action>
          </>
        )}
      </Step>
    </ol>
  );
}

// ---------------------------------------------------------------- (06) terms builder

function TermsBuilder({
  account,
  tier,
  covenant,
  manifest,
  project,
  tx,
}: {
  account: AccountView;
  tier: 'Native' | 'Watched';
  covenant?: Address;
  manifest?: { ok: boolean; endpoints: string[] };
  project?: Address;
  tx: ReturnType<typeof useSend>;
}) {
  const client = usePublicClient();
  const factory = deployment.factory!;
  const [t, setT] = useState({
    name: '', // empty: falls back to "<profile name> Revenue Claim", even if the profile loads later
    symbol: 'SLC-01',
    raise: '100',
    share: '20',
    cap: '',
    fundingHours: '24',
    termHours: '720',
    opHours: '24',
    windowHours: '240',
    firstRelease: '50',
    mode: 'Onchain',
    minRevenue: '10',
    stake: tier === 'Watched' ? '10' : '0',
    minFeeBps: '0',
    priceFloor: '10000',
  });
  const set = (k: keyof typeof t) => (e: { target: { value: string } }) => setT({ ...t, [k]: e.target.value });
  const raise = Number(t.raise) || 0;
  const share = Number(t.share) / 100;
  const projected = account.verifiedDaily * share * (Number(t.termHours) / 24);
  const suggested = Math.max(raise * 1.05, Math.min(raise * 2, projected / 1.5));
  const cap = Number(t.cap) || suggested;
  const coverage = cap > 0 ? projected / cap : 0;
  const now = Math.floor(Date.now() / 1000);
  const H = 3600;
  const funding = now + Number(t.fundingHours) * H;
  const notBefore = funding + Number(t.opHours) * H;
  const deadline = notBefore + Number(t.windowHours) * H;
  const maturity = funding + Number(t.termHours) * H;
  const minOp = Number(t.opHours) * H;
  const errors = [
    raise <= 0 && 'Raise must be positive.',
    cap < raise && 'The cap must be at least the raise.',
    !(Number(t.minRevenue) > 0) && 'The milestone revenue must be positive.',
    !(Number(t.share) >= 1 && Number(t.share) <= 50) && 'Revenue share must be 1–50%.',
    minOp < 30 && 'The operating period must be at least 30 seconds.',
    !(deadline < maturity) && 'The second-release window must end before maturity.',
    !(maturity - funding >= minOp) && 'The term must be at least the operating period.',
    tier === 'Watched' && !(Number(t.stake) > 0) && 'A Watched bond needs a stake.',
    tier === 'Watched' && !manifest?.ok && 'Check your manifest in step 2 first.',
    !/^[A-Z0-9-]{2,16}$/.test(t.symbol) && 'Symbol: 2–16 characters, A–Z, 0–9 and -.',
    !(Number(t.minFeeBps) >= 0 && Number(t.minFeeBps) <= 10_000) && 'Fee floor is 0–10000 bps.',
  ].filter(Boolean) as string[];
  const u = (x: string | number) => parseUnits(String(x), account.asset.decimals);
  const claimName = t.name.trim() || `${account.profile?.profile.name || 'Revenue'} Revenue Claim`;

  async function create() {
    if (!client) return;
    let policy: `0x${string}`;
    if (tier === 'Watched') {
      // The policy commits to the bond address, which the factory creates next (CREATE nonce).
      const nonce = await client.getTransactionCount({ address: factory });
      const bond = getContractAddress({ from: factory, nonce: BigInt(nonce) });
      const origin = new URL(manifest!.endpoints[0]!).origin;
      const watch: WatchPolicy = {
        id: `slice-${account.address.slice(2, 10).toLowerCase()}`,
        chainId: chain.id as 10143,
        chainSelector: '2183018362218727504',
        covenant: covenant!,
        bond,
        manifestUrl: `${origin}/.well-known/slice.json`,
        endpoints: manifest!.endpoints.map((url) => ({ url, minAmount: t.priceFloor })),
        method: 'GET',
        headers: { accept: 'application/json' },
        network: `eip155:${chain.id}`,
        asset: account.asset.address,
        expectedPayTo: account.address,
        maxTimeoutSeconds: 300,
        parserVersion: PARSER_VERSION,
        epochSeconds: 30,
        freshnessSeconds: 90,
      };
      policy = policyHash(watch);
      // The observer operator needs the exact policy to start monitoring this bond.
      const blob = new Blob([JSON.stringify(watch, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `slice-watch-policy-${bond}.json`;
      a.click();
    } else {
      policy = keccak256(stringToHex(JSON.stringify({ kind: 'native', account: account.address, project })));
    }
    if (Number(t.stake) > 0) {
      const ok = await tx.send('Approve stake', { address: account.asset.address, abi: erc20Abi as Abi, functionName: 'approve', args: [factory, u(t.stake)] });
      if (!ok) return;
    }
    const r = await tx.send('Create bond', {
      address: factory,
      abi: factoryAbi as Abi,
      functionName: 'createBond',
      args: [
        account.address,
        {
          raiseAmount: u(raise),
          repayCap: u(cap.toFixed(account.asset.decimals > 6 ? 6 : account.asset.decimals)),
          stake: u(t.stake || 0),
          minRevenue: u(t.minRevenue),
          fundingDeadline: BigInt(funding),
          maturity: BigInt(maturity),
          secondReleaseNotBefore: BigInt(notBefore),
          secondReleaseDeadline: BigInt(deadline),
          minOperatingPeriod: minOp,
          revenueBps: Math.round(Number(t.share) * 100),
          firstReleaseBps: Number(t.firstRelease) * 100,
          milestoneMode: t.mode === 'Onchain' ? 0 : 1,
          minFeeBps: tier === 'Native' ? Number(t.minFeeBps) : 0,
        },
        { adapter: tier === 'Native' ? 0 : 1, source: tier === 'Native' ? project : '0x0000000000000000000000000000000000000000', policyHash: policy },
        claimName,
        t.symbol,
      ],
    });
    if (r) parseEventLogs({ abi: factoryAbi, logs: r.logs, eventName: 'BondCreated' });
  }

  const n = (k: keyof typeof t, label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <input inputMode="decimal" value={t[k]} onChange={set(k)} className={cn(input, 'font-mono')} />
    </Field>
  );
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Claim name">
          <input value={t.name} onChange={set('name')} placeholder={claimName} className={input} />
        </Field>
        <Field label="Symbol">
          <input value={t.symbol} onChange={(e) => setT({ ...t, symbol: e.target.value.toUpperCase() })} className={cn(input, 'font-mono')} />
        </Field>
        {n('raise', `Raise (${account.asset.symbol})`)}
        {n('share', 'Revenue share (%)', 'Of every payment while the bond is live')}
        {n('termHours', 'Term (hours after funding)')}
        {n('fundingHours', 'Funding window (hours)')}
        <Field label={`Repayment cap (${account.asset.symbol})`} hint={`Suggested ${suggested.toFixed(2)} from your attributed revenue (coverage 1.5×)`}>
          <input inputMode="decimal" value={t.cap} onChange={set('cap')} placeholder={suggested.toFixed(2)} className={cn(input, 'font-mono')} />
        </Field>
        <Field label="Released at activation">
          <select value={t.firstRelease} onChange={set('firstRelease')} className={input}>
            <option value="50">50% now, 50% at the milestone</option>
            <option value="25">25% now, 75% at the milestone</option>
          </select>
        </Field>
        <Field label="Milestone proof">
          <select value={t.mode} onChange={set('mode')} className={input}>
            <option value="Onchain">On-chain: the account&apos;s own revenue counter</option>
            <option value="Signed">Signed: wash-adjusted, by the milestone signer</option>
          </select>
        </Field>
        {n('minRevenue', `Milestone revenue (${account.asset.symbol})`)}
        {n('opHours', 'Operating period before the second release (hours)')}
        {n('windowHours', 'Second-release window (hours)')}
        {n('stake', `Stake (${account.asset.symbol})`, tier === 'Watched' ? 'Required: slashed to investors on default' : 'Optional')}
        {tier === 'Native' ? n('minFeeBps', 'Fee floor while live (bps)', 'Payments below it revert while the bond is live') : n('priceFloor', 'Price floor per call (atomic units)', 'Applied to every endpoint in your manifest')}
      </div>
      <div className={cn('rounded-lg border p-4', coverage >= 1.2 ? 'border-foreground/10' : 'border-orange-500/30')}>
        <p className="font-mono text-sm tabular">
          [{coverage.toFixed(2)}×] coverage · {(cap / Math.max(raise, 1e-9)).toFixed(2)}× multiple
        </p>
        <p className={cn('mt-1 text-xs', coverage >= 1.2 ? 'text-foreground/60' : 'text-orange-500')}>
          {coverage >= 1.2
            ? `At ${fmt(account.verifiedDaily, account.asset)}/day attributed, investors are projected to be repaid within the term.`
            : 'Below 1.2×: at your current attributed revenue, investors are projected not to be repaid in full. Lower the raise or cap, or extend the term.'}
        </p>
      </div>
      {errors.length > 0 && (
        <ul className="space-y-1 text-xs text-orange-500">
          {errors.map((e) => (
            <li key={e}>· {e}</li>
          ))}
        </ul>
      )}
      <Action disabled={tx.busy || errors.length > 0} onClick={create}>
        {Number(t.stake) > 0 ? 'Approve stake and create bond' : 'Create bond'}
      </Action>
      {tier === 'Watched' && <p className="text-xs text-foreground/60">Creating downloads your watch policy: send it to the Slice observer operator so monitoring starts.</p>}
    </div>
  );
}

// ---------------------------------------------------------------- (08) Kuru

function KuruStep({ b, tx }: { b: BondView; tx: ReturnType<typeof useSend> }) {
  const { address } = useAccount();
  const [seed, setSeed] = useState('');
  const [note, setNote] = useState('');
  if (b.kuru)
    return (
      <div className="space-y-3">
        <p className="text-foreground/70">
          Claims trade on Kuru: market <span className="font-mono">{short(b.kuru.market)}</span>, AMM vault <span className="font-mono">{short(b.kuru.vault)}</span>.
        </p>
        <Field label="Seed the vault with claims and the same amount of the asset (1:1)">
          <input inputMode="decimal" value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="1" className={cn(input, 'font-mono')} />
        </Field>
        <Action
          disabled={tx.busy || !Number(seed) || !address}
          onClick={async () => {
            const amount = parseUnits(seed, b.asset.decimals);
            if (!(await tx.send('Approve claims', { address: b.address, abi: bondAbi as Abi, functionName: 'approve', args: [b.kuru!.vault, amount] }))) return;
            if (!(await tx.send('Approve asset', { address: b.asset.address, abi: erc20Abi as Abi, functionName: 'approve', args: [b.kuru!.vault, amount] }))) return;
            await tx.send('Seed vault', { address: b.kuru!.vault, abi: kuruAbi as Abi, functionName: 'deposit', args: [amount, amount, (amount * 9970n) / 10_000n, address] });
          }}
        >
          Seed vault
        </Action>
      </div>
    );
  return (
    <div className="space-y-3">
      <p className="text-foreground/70">
        A claim / {b.asset.symbol} order book with an AMM vault, starting near 1 {b.asset.symbol} per claim (1% ticks). The claim price becomes a live market forecast of your remaining repayment.
      </p>
      {b.asset.decimals !== 6 && <Badge tone="warn">Market parameters are tuned for 6-decimal assets</Badge>}
      <Action
        disabled={tx.busy}
        onClick={async () => {
          const r = await tx.send('Open market', {
            address: KURU_ROUTER,
            abi: kuruAbi as Abi,
            functionName: 'deployProxy',
            args: [0, b.address, b.asset.address, 10_000n, 10_000, 100, 100n, 1_000_000_000n, 30n, 10n, 100n],
          });
          if (!r) return;
          const res = await fetch('/api/registry', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'kuru', tx: r.transactionHash }) });
          setNote(res.ok ? 'Market recorded.' : (await res.json()).error);
        }}
      >
        Open Kuru market
      </Action>
      {note && <p className="text-foreground/70">{note}</p>}
    </div>
  );
}
