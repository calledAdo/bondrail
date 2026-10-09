'use client';
import Link from 'next/link';
import { useAccount,useReadContract } from 'wagmi';
import { formatUnits } from 'viem';
import { Wallet,ArrowUpRight } from 'lucide-react';
import { markets,type Market } from '@/lib/data';
import { chain,deployment } from '@/lib/wallet';
import { bondAbi } from '@/lib/abi';
function Position({market}:{market:Market}){const {address}=useAccount();const bond=deployment.bonds[market.id];const read=useReadContract({address:bond,abi:bondAbi,functionName:'balanceOf',args:address?[address]:undefined,chainId:chain.id,query:{enabled:!!bond&&!!address}});return <section className="panel"><div className="section-heading"><h2>{market.name}</h2><span className="badge neutral">{market.symbol}</span></div><span className="help">Actual wallet claim balance</span><h2 style={{fontSize:32,marginTop:8}}>{!bond?'Not configured':read.isPending?'Reading…':read.data!==undefined?`${formatUnits(read.data,6)} units`:'Read unavailable'}</h2><p>Undrawn escrow is conditional. Recovery follows current token ownership and becomes redeemable only after settlement.</p><Link className="button" href={`/bonds/${market.id}`}>Open contract workspace <ArrowUpRight size={15}/></Link></section>}
export function Portfolio(){const {address}=useAccount();return <><div className="page-heading"><div><div className="crumb">Investor workspace</div><h1>Your positions</h1><p>Claim ownership, collection and recovery. No simulated wallet balances.</p></div></div>{!address?<section className="panel empty"><Wallet size={32}/><h2>Connect to view your holdings</h2><p>Use Connect wallet in the header. This view reads actual claim balances from configured testnet contracts.</p><Link href="/" className="button">Explore the preview markets</Link></section>:<div className="portfolio-grid">{markets.map(m=><Position key={m.id} market={m}/>)}</div>}</>}
