'use client';
import { useState } from 'react';
import { useAccount, usePublicClient, useWalletClient } from 'wagmi';
import { erc20Abi, isAddress, parseUnits, type Address, type Hash } from 'viem';
import { ShieldCheck, Radio, ArrowRight, ArrowLeft, Download } from 'lucide-react';
import { chain, deployment, safeNetwork } from '@/lib/wallet';
import { factoryAbi } from '@/lib/abi';
import { money } from '@/lib/data';
import { SourceSetup } from './source-setup';
export function IssueWizard() {
  const [step, setStep] = useState(0);
  const [adapter, setAdapter] = useState<'Native' | 'Watched'>('Native');
  const [milestoneMode, setMilestoneMode] = useState<'Onchain' | 'Signed'>('Onchain');
  const [ratio, setRatio] = useState('50');
  const [fields, setFields] = useState({
    claimName: 'PumpLab Revenue Claim',
    claimSymbol: 'PLAB-RC',
    raise: '100',
    cap: '120',
    stake: '20',
    share: '20',
    minimum: '5',
    interval: '60',
    account: '',
    source: '',
    policy: '',
    funding: '',
    notBefore: '',
    deadline: '',
    maturity: '',
  });
  const [ack, setAck] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [hash, setHash] = useState<Hash>();
  const { address, chainId } = useAccount();
  const client = usePublicClient();
  const { data: wallet } = useWalletClient();
  const update = (key: keyof typeof fields, value: string) => setFields((f) => ({ ...f, [key]: value }));
  const ready =
    !!address && chainId === chain.id && !!deployment.factory && !!deployment.token && safeNetwork;
  function validate(all = false) {
    const numeric = ['raise', 'cap', 'stake', 'minimum'] as const;
    for (const key of numeric)
      if (!/^\d+(\.\d{1,6})?$/.test(fields[key]) || Number(fields[key]) <= 0)
        throw Error(
          `${key === 'cap' ? 'Full-release cap' : key} must be positive with at most six decimal places.`,
        );
    if (Number(fields.cap) < Number(fields.raise))
      throw Error('Full-release cap must be at least the raise amount.');
    if (!/^\d+$/.test(fields.share) || Number(fields.share) < 1 || Number(fields.share) > 50)
      throw Error('Revenue share must be a whole percentage from 1 to 50.');
    if (!/^\d+$/.test(fields.interval) || Number(fields.interval) < 30)
      throw Error('Minimum operating interval must be at least 30 seconds.');
    if (!fields.claimName.trim() || !/^[A-Z0-9-]{2,16}$/.test(fields.claimSymbol.trim()))
      throw Error('Give the claim token a name and a 2-16 character symbol (A-Z, 0-9, -).');
    if (all) {
      for (const key of ['account', 'source'] as const) {
        if (key === 'source' && adapter === 'Watched') continue;
        if (!isAddress(fields[key])) throw Error(`Enter a valid ${key} address from your source setup.`);
      }
      if (!/^0x[\da-fA-F]{64}$/.test(fields.policy) || /^0x0{64}$/.test(fields.policy))
        throw Error('Policy hash must be a 32-byte hexadecimal commitment.');
      const times = [fields.funding, fields.notBefore, fields.deadline, fields.maturity].map((x) =>
        new Date(x).getTime(),
      );
      if (
        times.some((x) => !Number.isFinite(x)) ||
        times[0] <= Date.now() ||
        !times.every((x, i) => i === 0 || x > times[i - 1])
      )
        throw Error(
          'Set future dates in order: funding deadline, second-release opening, second-release deadline, maturity.',
        );
      if (!ack) throw Error('Confirm the staged-release and evaluator terms.');
    }
  }
  function next() {
    try {
      setError('');
      if (step === 1) validate();
      setStep((s) => Math.min(2, s + 1));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function exportDraft() {
    setError('');
    const blob = new Blob(
      [
        JSON.stringify(
          {
            schemaVersion: 1,
            network: chain.id,
            adapter,
            firstReleaseBps: Number(ratio) * 100,
            ...fields,
            classification: 'unsigned draft; no issuance or authorization',
          },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'slice-issuance-draft.json';
    a.click();
    URL.revokeObjectURL(url);
  }
  async function send(kind: 'approve' | 'create') {
    setError('');
    setStatus('');
    setHash(undefined);
    setBusy(true);
    try {
      validate(true);
      if (!ready || !address || !client || !wallet || !deployment.factory || !deployment.token)
        throw Error(
          'Configure the testnet factory and token, then connect a wallet on the selected network.',
        );
      let simulation;
      if (kind === 'approve') {
        simulation = await client.simulateContract({
          account: address,
          address: deployment.token,
          abi: erc20Abi,
          functionName: 'approve',
          args: [deployment.factory, parseUnits(fields.stake, 6)],
        });
      } else {
        const unix = (x: string) => BigInt(Math.floor(new Date(x).getTime() / 1000));
        simulation = await client.simulateContract({
          account: address,
          address: deployment.factory,
          abi: factoryAbi,
          functionName: 'createBond',
          args: [
            fields.account as Address,
            {
              raiseAmount: parseUnits(fields.raise, 6),
              repayCap: parseUnits(fields.cap, 6),
              stake: parseUnits(fields.stake, 6),
              minRevenue: parseUnits(fields.minimum, 6),
              fundingDeadline: unix(fields.funding),
              maturity: unix(fields.maturity),
              secondReleaseNotBefore: unix(fields.notBefore),
              secondReleaseDeadline: unix(fields.deadline),
              minOperatingPeriod: Number(fields.interval),
              revenueBps: Number(fields.share) * 100,
              firstReleaseBps: Number(ratio) * 100,
              milestoneMode: milestoneMode === 'Onchain' ? 0 : 1,
            },
            {
              adapter: adapter === 'Native' ? 0 : 1,
              source: (adapter === 'Watched' ? '0x0000000000000000000000000000000000000000' : fields.source) as Address,
              policyHash: fields.policy as Hash,
            },
            fields.claimName.trim(),
            fields.claimSymbol.trim(),
          ],
        });
      }
      setStatus('Approve the transaction in your wallet.');
      const tx = await wallet.writeContract(simulation.request as Parameters<typeof wallet.writeContract>[0]);
      setHash(tx);
      setStatus('Transaction submitted. Waiting for a chain receipt…');
      const receipt = await client.waitForTransactionReceipt({ hash: tx });
      if (receipt.status !== 'success') throw Error('Transaction reverted. No issuance was recorded.');
      setStatus(
        kind === 'approve'
          ? 'Stake approval confirmed by receipt. You can now create the financing.'
          : 'Creation receipt confirmed. Inspect the Factory event for the new bond address; add it to the deployment directory. Verified checkpoint not established here.',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message.slice(0, 420) : 'Request failed.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="crumb">Issuer workspace / New financing</div>
          <h1>Raise against revenue.</h1>
          <p>Set the source, capital stages and immutable release conditions.</p>
        </div>
      </div>
      <div className="wizard-layout">
        <section className="panel">
          <div className="wizard-steps">
            {['Revenue source', 'Capital & schedule', 'Review & create'].map((s, i) => (
              <span key={s} className={step === i ? 'current' : ''}>
                <i>{i + 1}</i>
                {s}
              </span>
            ))}
          </div>
          {step === 0 && (
            <>
              <h2>What produces the receipts?</h2>
              <p>
                Choose the adapter matching your actual source. The Factory validates supported source
                configuration.
              </p>
              <div className="source-options">
                {(['Native', 'Watched'] as const).map((a) => (
                  <button
                    key={a}
                    className={`source-option ${adapter === a ? 'selected' : ''}`}
                    onClick={() => setAdapter(a)}
                    aria-pressed={adapter === a}
                  >
                    {a === 'Watched' ? <Radio size={25} /> : <ShieldCheck size={25} />}
                    <strong>
                      {a === 'Native' ? 'Built on Slice' : 'x402 service'}
                    </strong>
                    <small>
                      {a === 'Native'
                        ? 'Every fee is pulled through your SliceAccount. Diversion is impossible by construction.'
                        : 'Chainlink CRE checks your payTo every 30 s; a diversion defaults the bond and slashes your stake.'}
                    </small>
                  </button>
                ))}
              </div>
              <SourceSetup
                account={fields.account}
                adapter={adapter}
                onCreated={(values) => setFields((f) => ({ ...f, ...values }))}
              />
              <div className="form-grid">
                {(['account', 'source', 'policy'] as const).map((k) => (
                  <label className="field-label wide" key={k}>
                    {k === 'policy'
                      ? 'Immutable policy hash'
                      : k === 'account'
                        ? 'SliceAccount address'
                        : `${k[0].toUpperCase() + k.slice(1)} address${k === 'source' && adapter === 'Watched' ? ' (not used)' : ''}`}
                    <input
                      value={fields[k]}
                      onChange={(e) => update(k, e.target.value)}
                      placeholder={k === 'policy' ? '0x… 32-byte policy commitment' : '0x…'}
                      spellCheck={false}
                    />
                  </label>
                ))}
              </div>
              <p className="notice">
                Use the setup actions above or an existing deployment on the configured network. A profile
                name or an uploaded URL cannot create a recognized revenue source.
              </p>
            </>
          )}
          {step === 1 && (
            <>
              <h2>Give each capital release a boundary</h2>
              <div className="form-grid">
                <label className="field-label">
                  Claim token name
                  <input value={fields.claimName} onChange={(e) => update('claimName', e.target.value)} />
                </label>
                <label className="field-label">
                  Claim token symbol
                  <input
                    value={fields.claimSymbol}
                    onChange={(e) => update('claimSymbol', e.target.value.toUpperCase())}
                  />
                </label>
                {[
                  ['raise', 'Raise amount · USDC'],
                  ['cap', 'Full-release revenue cap · USDC'],
                  ['stake', 'Issuer stake · USDC'],
                  ['share', 'Revenue share · %'],
                  ['minimum', 'Second-draw eligible revenue · USDC'],
                  ['interval', 'Minimum operating interval · seconds'],
                ].map(([k, label]) => (
                  <label className="field-label" key={k}>
                    {label}
                    <input
                      inputMode="decimal"
                      value={fields[k as keyof typeof fields]}
                      onChange={(e) => update(k as keyof typeof fields, e.target.value)}
                    />
                  </label>
                ))}
                <label className="field-label wide">
                  How the second release is proven
                  <select
                    value={milestoneMode}
                    onChange={(e) => setMilestoneMode(e.target.value as 'Onchain' | 'Signed')}
                  >
                    <option value="Onchain">On-chain: my account's own revenue counter (trustless)</option>
                    <option value="Signed">Signed: wash-adjusted revenue attested by the evaluator</option>
                  </select>
                </label>
                <label className="field-label wide">
                  Capital release split
                  <select value={ratio} onChange={(e) => setRatio(e.target.value)}>
                    <option value="50">50% at activation / 50% after milestone</option>
                    <option value="25">25% at activation / 75% after milestone</option>
                  </select>
                </label>
                {[
                  ['funding', 'Funding deadline'],
                  ['notBefore', 'Second release opens'],
                  ['deadline', 'Second release deadline'],
                  ['maturity', 'Maturity'],
                ].map(([k, label]) => (
                  <label className="field-label" key={k}>
                    {label}
                    <input
                      type="datetime-local"
                      value={fields[k as keyof typeof fields]}
                      onChange={(e) => update(k as keyof typeof fields, e.target.value)}
                    />
                  </label>
                ))}
              </div>
              <p className="help">
                Dates use your browser’s local timezone and are converted to UTC seconds before signing. The
                release deadline must precede maturity.
              </p>
            </>
          )}
          {step === 2 && (
            <>
              <h2>Review the commitment</h2>
              <dl className="fact-list roomy">
                <div>
                  <dt>Source</dt>
                  <dd>{adapter}</dd>
                </div>
                <div>
                  <dt>Raised / released at activation</dt>
                  <dd>
                    {money(Number(fields.raise))} / {money((Number(fields.raise) * Number(ratio)) / 100)}
                  </dd>
                </div>
                <div>
                  <dt>Conditional second release</dt>
                  <dd>{money((Number(fields.raise) * (100 - Number(ratio))) / 100)}</dd>
                </div>
                <div>
                  <dt>Cap after first release</dt>
                  <dd>{money((Number(fields.cap) * Number(ratio)) / 100)}</dd>
                </div>
                <div>
                  <dt>Revenue participation</dt>
                  <dd>{fields.share}%</dd>
                </div>
                <div>
                  <dt>Second-release proof</dt>
                  <dd>
                    {milestoneMode === 'Onchain'
                      ? `Account revenue ≥ ${fields.minimum} USDC since activation (on-chain)`
                      : `Signed, wash-adjusted revenue ≥ ${fields.minimum} USDC`}
                  </dd>
                </div>
                <div>
                  <dt>Minimum operating interval</dt>
                  <dd>{fields.interval} seconds</dd>
                </div>
                {[
                  ['Funding deadline', fields.funding],
                  ['Second release opens', fields.notBefore],
                  ['Second release expires', fields.deadline],
                  ['Maturity', fields.maturity],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value ? new Date(value).toLocaleString() : 'Not set'}</dd>
                  </div>
                ))}
              </dl>
              <p className="notice warning">
                The milestone signer is a trusted evaluator. A successful signature does not prove independent
                customer demand. Default, deadline expiry or collection close cancels undrawn capital into
                final investor recovery.
              </p>
              <label className="check-label">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                <span>
                  I understand the fixed two-stage release, scaled cap, trusted evaluator and final-only
                  redemption. A missed milestone alone does not slash stake.
                </span>
              </label>
              <div className="transaction-buttons">
                <button className="button" disabled={!ready || busy || !ack} onClick={() => send('approve')}>
                  1. Approve issuer stake
                </button>
                <button
                  className="button primary"
                  disabled={!ready || busy || !ack}
                  onClick={() => send('create')}
                >
                  2. Create financing on testnet
                </button>
                <button className="button subtle" onClick={exportDraft}>
                  <Download size={15} />
                  Save unsigned draft
                </button>
              </div>
              {!ready && (
                <p className="help">
                  Wallet issuance is disabled until a testnet factory/token and connected wallet are
                  available. Draft export remains available.
                </p>
              )}
            </>
          )}
          {error && (
            <p className="notice danger" role="alert">
              {error}
            </p>
          )}
          {status && (
            <p className="notice" role="status">
              {status}
              {hash && chain.blockExplorers && (
                <a
                  className="transaction-link"
                  href={`${chain.blockExplorers.default.url}/tx/${hash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View actual transaction
                </a>
              )}
            </p>
          )}
          <div className="wizard-actions">
            <button
              className="button subtle"
              disabled={step === 0 || busy}
              onClick={() => {
                setStep((s) => s - 1);
                setError('');
              }}
            >
              <ArrowLeft size={15} />
              Back
            </button>
            {step < 2 && (
              <button className="button primary" onClick={next}>
                Continue
                <ArrowRight size={15} />
              </button>
            )}
          </div>
        </section>
        <aside>
          <section className="panel decision-panel">
            <h2>Your capital structure</h2>
            <div className="allocation-example">
              <div>
                <strong>{ratio}%</strong>
                <small>Initial release</small>
              </div>
              <div>
                <strong>{100 - Number(ratio)}%</strong>
                <small>Conditional</small>
              </div>
            </div>
            <p>
              One token class carries rights to collected revenue, principal recovery and any slashed stake.
            </p>
            <dl className="fact-list">
              <div>
                <dt>First release</dt>
                <dd>Fully funded + activated</dd>
              </div>
              <div>
                <dt>Second release</dt>
                <dd>Time + evidence + health</dd>
              </div>
              <div>
                <dt>Redemption</dt>
                <dd>After final settlement</dd>
              </div>
            </dl>
            <p className="footnote">
              No live score or raise recommendation is fabricated. A production recommendation needs 30
              complete days of eligible evidence.
            </p>
          </section>
        </aside>
      </div>
    </>
  );
}
