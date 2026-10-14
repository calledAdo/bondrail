'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';
import { erc20Abi, formatUnits, isAddress, zeroAddress, type Address } from 'viem';
import { getCreditProfile } from '@bondrail/sdk/credit';
import { chain, deployment, safeNetwork } from '@/lib/wallet';
import { Badge, Figure, Panel } from './ui';

const date = (value: bigint) => value === 0n ? '—' : new Date(Number(value) * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
const phases = ['Funding', 'Active', 'Closing', 'Closed', 'Cancelled'];

export function RegistryCreditProfile({ account }: { account: string }) {
  const registry = deployment.creditRegistry;
  const client = usePublicClient({ chainId: chain.id });
  const validAccount = isAddress(account);
  const query = useQuery({
    queryKey: ['registry-credit', chain.id, registry, account.toLowerCase()],
    enabled: !!client && !!registry && validAccount && safeNetwork,
    refetchInterval: 30_000,
    queryFn: async () => {
      const profile = await getCreditProfile(client!, registry!, account as Address);
      const [decimals, symbol] = await Promise.all([
        client!.readContract({ address: profile.onchain.asset, abi: erc20Abi, functionName: 'decimals', blockNumber: profile.blockNumber }),
        client!.readContract({ address: profile.onchain.asset, abi: erc20Abi, functionName: 'symbol', blockNumber: profile.blockNumber }),
      ]);
      return { ...profile, decimals, symbol };
    },
  });
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);
  const data = query.data;
  const p = data?.onchain;
  const repayment = p?.repayment;
  const signed = data?.attested;
  const a = signed?.attestation;
  const present = signed && signed.signer !== zeroAddress;
  // An expired cached signature must not continue to look current while a refresh fails.
  const valid = !!signed?.valid && !!a && a.expiresAt > BigInt(now);
  const amount = (v: bigint | undefined) => data && v !== undefined ? `${formatUnits(v, data.decimals)} ${data.symbol}` : '—';
  const count = (v: bigint | undefined) => v?.toString() ?? '—';
  const configuredInvalid = !!process.env.NEXT_PUBLIC_CREDIT_REGISTRY_ADDRESS && !registry;
  return (
    <section aria-label="Registry credit profile" className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold">Portable credit profile</h2>
        <Badge>{registry ? 'Registry reads' : 'Not deployed'}</Badge>
        {data && <span className="text-xs text-foreground/60">Block {data.blockNumber.toString()}</span>}
      </div>
      <p className="max-w-3xl text-sm text-foreground/70">Other lenders can read both layers from one registry. Recorded bond history may be incomplete; compare factory issuance before lending. Each account is limited to 64 recorded bonds.</p>
      {!validAccount ? <p role="alert">Invalid account address.</p>
        : !safeNetwork ? <p role="alert">Unsupported network configuration.</p>
        : configuredInvalid ? <p role="alert">Invalid credit registry address.</p>
        : !registry ? <p className="text-sm text-foreground/60">The credit registry is not deployed on {chain.name}. No registry profile or signed assessment is available yet.</p>
        : query.isPending ? <p role="status">Reading credit registry…</p> : null}
      {query.isError && <div role="alert" className="text-sm">
        <p>{data ? 'Refresh failed. Showing the last successful snapshot; validity below also checks the current time.' : 'Could not read the registry. Check the account, registry address and network.'}</p>
        <button type="button" onClick={() => void query.refetch()} className="min-h-11 underline underline-offset-4">Retry</button>
      </div>}
      <Panel title="On-chain record" aside={<Badge>Trustless reads</Badge>}>
        <p className="mb-5 text-sm text-foreground/60">Direct account and bond state. Booked revenue includes self-payments; payer addresses are not verified independent customers. Default flags retain the covenant observer’s trust.</p>
        <dl className="grid min-w-0 grid-cols-2 gap-5 [overflow-wrap:anywhere] lg:grid-cols-4">
          <Figure label="Booked revenue" value={amount(p?.cumulativeRevenue)} />
          <Figure label="Gross volume" value={amount(p?.cumulativeVolume)} />
          <Figure label="Payments" value={count(p?.paymentCount)} />
          <Figure label="Collected payments" value={count(p?.collectedCount)} />
          <Figure label="Unique payer addresses" value={count(p?.uniquePayers)} />
          <Figure label="History age" value={p ? `${(Number(p.historyAge) / 86400).toFixed(1)} days` : '—'} />
          <Figure label="First revenue" value={p ? date(p.firstRevenueAt) : '—'} />
          <Figure label="Account tier" value={p ? ['Native', 'Watched', 'Unknown'][p.tier] : '—'} />
        </dl>
        {p && <dl className="mt-5 space-y-2 break-all text-xs">
          <div><dt className="text-foreground/60">Asset</dt><dd className="font-mono">{p.asset}</dd></div>
          <div><dt className="text-foreground/60">Issuer</dt><dd className="font-mono">{p.issuer}</dd></div>
          <div><dt className="text-foreground/60">Project</dt><dd className="font-mono">{p.project === zeroAddress ? 'No bound project' : p.project}</dd></div>
        </dl>}
      </Panel>
      <Panel title="Repayment record">
        <dl className="grid grid-cols-2 gap-5 [overflow-wrap:anywhere] lg:grid-cols-4">
          <Figure label="Bonds issued (recorded)" value={count(repayment?.bondsIssued)} />
          <Figure label="Funding" value={count(repayment?.funding)} />
          <Figure label="Active" value={count(repayment?.active)} />
          <Figure label="Closing settlement" value={count(repayment?.closing)} />
          <Figure label="Fully repaid by cap" value={count(repayment?.fullyRepaid)} />
          <Figure label="Closed at maturity" value={count(repayment?.closedAtMaturity)} />
          <Figure label="Cancelled" value={count(repayment?.cancelled)} />
          <Figure label="Default flagged" value={count(repayment?.defaulted)} />
          <Figure label="Total raised (activated)" value={amount(repayment?.totalRaised)} />
          <Figure label="Revenue collected" value={amount(repayment?.totalCollected)} />
          <Figure label="Paid to investors" value={amount(repayment?.totalRepaidToInvestors)} />
        </dl>
        <p className="mt-4 text-xs text-foreground/60">Cap and maturity describe collection closure, including bonds still settling. Defaults can overlap either. Paid to investors means redeemed assets, including recovered principal and stake.</p>
        {p && p.bonds.length > 0 && <div className="mt-5 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Recorded bond repayment details</caption>
            <thead><tr className="border-b border-foreground/10">{['Bond', 'State', 'Closure', 'Collected / effective cap', 'Paid out'].map(label => <th key={label} scope="col" className="p-2 font-normal">{label}</th>)}</tr></thead>
            <tbody>{p.bonds.map(b => <tr key={b.bond} className="border-b border-foreground/5">
              <td className="p-2 font-mono"><Link href={`/bonds/${b.bond}`} className="underline">{b.bond.slice(0, 6)}…{b.bond.slice(-4)}</Link><span className="block text-xs text-foreground/60">{b.adapter === 0 ? 'Native' : 'Watched'}</span></td>
              <td className="p-2">{phases[b.phase]}{b.defaultedAt > 0n && <span className="block">Default flagged</span>}</td>
              <td className="p-2">{['Open', 'Revenue cap', 'Maturity'][b.closeReason]}</td>
              <td className="p-2">{amount(b.collected)} / {amount(b.effectiveCap)}<span className="block text-xs">{b.effectiveCap > 0n ? `${(Number(b.repaidRatioBps) / 100).toFixed(2)}%` : 'No effective cap yet'}</span></td>
              <td className="p-2">{amount(b.repaidToInvestors)}</td>
            </tr>)}</tbody>
          </table>
        </div>}
      </Panel>
      <Panel title="Attested" aside={<Badge>{!present ? 'No attestation' : valid ? 'Unexpired signature' : 'Expired'}</Badge>}>
        <p className="mb-5 text-sm text-foreground/60">Trust the disclosed attester for attribution, exclusions, distinct payers, concentration and the recommended credit line. The evidence hash binds its inputs; it does not prove their truth or availability.</p>
        <dl className="grid grid-cols-2 gap-5 [overflow-wrap:anywhere] lg:grid-cols-3">
          <Figure label="Attributed revenue" value={present ? amount(a?.attributedRevenue) : '—'} />
          <Figure label="Excluded revenue" value={present ? amount(a?.excludedRevenue) : '—'} />
          <Figure label="Distinct attributed payers" value={present ? count(a?.distinctPayers) : '—'} />
          <Figure label="Top payer share" value={present && a ? `${(a.topPayerShareBps / 100).toFixed(2)}%` : '—'} />
          <Figure label="Attested credit line" value={present ? amount(a?.creditLine) : '—'} />
          <Figure label="Expires" value={present && a ? date(a.expiresAt) : '—'} />
        </dl>
        {present && a && <dl className="mt-5 space-y-3 break-all text-xs">
          <div><dt className="text-foreground/60">Attester who signed</dt><dd className="font-mono">{signed.signer}</dd></div>
          <div><dt className="text-foreground/60">Period / issued</dt><dd>{date(a.periodStart)} – {date(a.periodEnd)} / {date(a.issuedAt)}</dd></div>
          <div><dt className="text-foreground/60">Evidence hash</dt><dd className="font-mono">{a.evidenceHash}</dd></div>
          {signed.signer.toLowerCase() !== data?.currentAttester.toLowerCase() && <div><dt className="text-foreground/60">Current registry attester (rotated)</dt><dd className="font-mono">{data?.currentAttester}</dd></div>}
        </dl>}
        {data && !present && <p className="mt-5 break-all text-xs text-foreground/60">Configured attester: {data.currentAttester}</p>}
      </Panel>
    </section>
  );
}
