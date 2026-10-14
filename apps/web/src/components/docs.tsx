// MDX components for the docs that read the repository at build time, so the docs cannot drift from the
// code: snippets come from real (compiled, tested) files, reference tables from the generated ABIs, and
// addresses from the deployment manifest. A missing file or marker fails the build.
import fs from 'node:fs';
import { deploymentPath } from '../../../../scripts/deployment-path.mjs';
import path from 'node:path';
import { ServerCodeBlock } from 'fumadocs-ui/components/codeblock.rsc';
import * as abis from '@bondrail/sdk/abis';

// Repository root (the app runs from apps/web). Read at build time only; not traced into the server bundle.
const ROOT = path.resolve(/*turbopackIgnore: true*/ process.cwd(), '../..');
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const LANG: Record<string, string> = { sol: 'solidity', ts: 'ts', tsx: 'tsx', graphql: 'graphql', json: 'json' };

function dedent(lines: string[]) {
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)![0].length));
  return lines.map((l) => l.slice(indent)).join('\n');
}

/**
 * A snippet of a repository file. `from` is the first line to include (a substring); the snippet runs to
 * the end of that block (matching indentation), or through the first line containing `to`.
 */
export function Source({ file, from, to, title }: { file: string; from?: string; to?: string; title?: string }) {
  const lines = read(file).split('\n');
  let code = lines.join('\n').trim();
  if (from) {
    const start = lines.findIndex((l) => l.includes(from));
    if (start < 0) throw new Error(`docs: "${from}" not found in ${file}`);
    let end = start;
    if (to) {
      end = lines.findIndex((l, i) => i > start && l.includes(to));
      if (end < 0) throw new Error(`docs: "${to}" not found in ${file}`);
    } else {
      // The block opens on the first line ending in "{" (signatures may span lines) and closes on the
      // first later "}" line at the starting indentation.
      const indent = lines[start]!.match(/^ */)![0].length;
      const opener = lines.findIndex((l, i) => i >= start && l.trimEnd().endsWith('{'));
      end = lines.findIndex(
        (l, i) => i > opener && l.trimStart().startsWith('}') && l.match(/^ */)![0].length <= indent,
      );
      if (opener < 0 || end < 0) throw new Error(`docs: no block after "${from}" in ${file}`);
    }
    code = dedent(lines.slice(start, end + 1));
  }
  const ext = file.split('.').pop()!;
  return (
    <ServerCodeBlock
      code={code}
      lang={LANG[ext] ?? ext}
      codeblock={{ title: title ?? file }}
    />
  );
}

type Deployment = {
  chainId: number;
  network: string;
  deployedAt: string;
  factory: string;
  covenant: string;
  forwarder: string;
  asset: string;
  creditRegistry?: string;
  vault?: string;
  attester?: string;
  curator?: string;
  reviewer?: string;
  milestoneSigner?: string;
  observer?: string;
  minHistory?: number;
  issuers: Record<string, { name: string; tier: string; account: string; bond?: string; source?: string }>;
};

/** The live deployment, straight from docs/deployments/<chainId>.json. */
export function Deployments({ chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 10143) }: { chainId?: number }) {
  const d = JSON.parse(fs.readFileSync(deploymentPath(ROOT, chainId), 'utf8')) as Deployment;
  const explorer = (a: string) => `https://testnet.monadexplorer.com/address/${a}`;
  const row = (label: string, a?: string) =>
    a ? (
      <tr key={label}>
        <td>{label}</td>
        <td>
          <a href={chainId === 31337 ? undefined : explorer(a)} className="font-mono text-xs">
            {a}
          </a>
        </td>
      </tr>
    ) : null;
  return (
    <>
      <p>
        {d.network} (chain {d.chainId}), deployed {d.deployedAt.slice(0, 10)}.
        {d.minHistory !== undefined && ` Minimum history before a bond: ${d.minHistory} s.`}
      </p>
      <table>
        <thead>
          <tr>
            <th>Contract</th>
            <th>Address</th>
          </tr>
        </thead>
        <tbody>
          {row('BondrailFactory', d.factory)}
          {row('BondrailCovenant (CRE receiver)', d.covenant)}
          {row('CRE forwarder', d.forwarder)}
          {row('BondrailCreditRegistry', d.creditRegistry)}
          {row('BondrailVault', d.vault)}
          {row('Credit attester', d.attester)}
          {row('Vault curator', d.curator)}
          {row('Default asset (USDC)', d.asset)}
          {row('Native reviewer', d.reviewer)}
          {row('Milestone signer', d.milestoneSigner)}
          {row('Observer signer', d.observer)}
        </tbody>
      </table>
      <table>
        <thead>
          <tr>
            <th>Demo business</th>
            <th>Tier</th>
            <th>Account / bond</th>
          </tr>
        </thead>
        <tbody>
          {Object.values(d.issuers).map((i) => (
            <tr key={i.account}>
              <td>{i.name}</td>
              <td>{i.tier}</td>
              <td className="font-mono text-xs">
                {i.account}
                {i.bond && (
                  <>
                    <br />
                    {i.bond}
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

type AbiItem = {
  type: string;
  name?: string;
  stateMutability?: string;
  inputs?: { name: string; type: string; internalType?: string }[];
  outputs?: { name: string; type: string }[];
};
const params = (xs: AbiItem['inputs'] = []) => xs.map((x) => `${x.type}${x.name ? ' ' + x.name : ''}`).join(', ');

/** Every function, event and error of a protocol contract, from the SDK's generated ABIs. */
export function Abi({ contract }: { contract: 'BondrailFactory' | 'BondrailAccount' | 'BondrailBond' | 'BondrailCovenant' | 'BondrailEarner' }) {
  const id = `${contract[0]!.toLowerCase()}${contract.slice(1)}Abi` as keyof typeof abis;
  const abi = abis[id] as unknown as AbiItem[];
  const fns = abi.filter((x) => x.type === 'function').sort((a, b) => a.name!.localeCompare(b.name!));
  const writes = fns.filter((x) => x.stateMutability !== 'view' && x.stateMutability !== 'pure');
  const reads = fns.filter((x) => x.stateMutability === 'view' || x.stateMutability === 'pure');
  const sig = (x: AbiItem) =>
    `${x.name}(${params(x.inputs)})${x.outputs?.length ? ` → ${x.outputs.map((o) => o.type).join(', ')}` : ''}`;
  const list = (title: string, items: AbiItem[], f: (x: AbiItem) => string) =>
    items.length ? (
      <>
        <h3>{title}</h3>
        <ul>
          {items.map((x) => (
            <li key={f(x)}>
              <code>{f(x)}</code>
            </li>
          ))}
        </ul>
      </>
    ) : null;
  return (
    <>
      {list('Writes', writes, sig)}
      {list('Reads', reads, sig)}
      {list('Events', abi.filter((x) => x.type === 'event'), (x) => `${x.name}(${params(x.inputs)})`)}
      {list('Errors', abi.filter((x) => x.type === 'error'), (x) => `${x.name}(${params(x.inputs)})`)}
    </>
  );
}

export const docsComponents = { Source, Deployments, Abi };
