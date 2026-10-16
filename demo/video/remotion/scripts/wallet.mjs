// The only secret input is ~/.bondrail-video/demo.key. Never import scripts/lib.ts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPublicClient, createWalletClient, http, erc20Abi, parseAbi, decodeFunctionData, keccak256, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { monadTestnet } from 'viem/chains';
export const root = path.resolve(import.meta.dirname, '../../../..');
export const out = path.join(root, 'demo/video/output/update');
export const deployment = JSON.parse(fs.readFileSync(path.join(root, 'docs/deployments/10143.json')));
export const ADDRESS = '0xF62d1CBb1E11aC090a1060022f519c6A1381761b';
export const LIVE = 'https://bondrail.vercel.app';
export const RPC = 'https://testnet-rpc.monad.xyz';
export const client = createPublicClient({chain: monadTestnet, transport: http(RPC, {timeout: 20000, retryCount: 2})});
export const vaultAbi = parseAbi(['function deposit(uint256 assets,address receiver) returns(uint256)', 'function withdraw(uint256 assets,address receiver,address owner) returns(uint256)', 'function previewDeposit(uint256) view returns(uint256)', 'function maxWithdraw(address) view returns(uint256)', 'event Deposit(address indexed sender,address indexed owner,uint256 assets,uint256 shares)', 'event Withdraw(address indexed sender,address indexed receiver,address indexed owner,uint256 assets,uint256 shares)']);
const dir = path.join(os.homedir(), '.bondrail-video');
export const ledgerFile = path.join(dir, 'update-budget.json');
export const json = v => JSON.stringify(v, (_, x) => typeof x === 'bigint' ? x.toString() : x, 2) + '\n';
export const save = (file, v) => { fs.mkdirSync(path.dirname(file), {recursive:true}); fs.writeFileSync(file + '.tmp', json(v)); fs.renameSync(file + '.tmp', file); };
export function ledger() { return fs.existsSync(ledgerFile) ? JSON.parse(fs.readFileSync(ledgerFile)) : {wallet:ADDRESS, chainId:10143, actions:[]}; }
export function reserve(kind, detail={}) {
 const state=ledger();
 if(state.wallet !== ADDRESS || state.chainId!==10143) throw Error('Journal identity mismatch');
 const limit=kind==='x402'?5:1;
 if(state.actions.filter(x=>x.kind===kind).length >= limit) throw Error(`${kind} budget already reserved; reconcile journal, never retry payment`);
 const entry={id:state.actions.length,kind,status:'reserved',at:new Date().toISOString(),...detail};
 state.actions.push(entry);save(ledgerFile,state);return entry.id;
}
export function update(id, detail) {const state=ledger();Object.assign(state.actions.find(x=>x.id===id),detail);save(ledgerFile,state);save(path.join(out,'transactions.json'),state);}
export function validate(tx) {
 if(tx.from?.toLowerCase()!==ADDRESS.toLowerCase() || BigInt(tx.value??0)!==0n || tx.chainId && BigInt(tx.chainId)!==10143n) throw Error('Unauthorized sender, value or chain');
 const to=tx.to?.toLowerCase();
 if(to===deployment.asset.toLowerCase()) {
  const a=decodeFunctionData({abi:erc20Abi,data:tx.data});
  if(a.functionName!=='approve'||a.args[0].toLowerCase()!==deployment.vault.toLowerCase()||a.args[1]!==1000000n) throw Error('Only exact 1 USDC vault approval permitted');
  return {kind:'approve',args:a.args};
 }
 if(to!==deployment.vault.toLowerCase()) throw Error('Unauthorized destination');
 const a=decodeFunctionData({abi:vaultAbi,data:tx.data});
 if(!['deposit','withdraw'].includes(a.functionName)||a.args[1].toLowerCase()!==ADDRESS.toLowerCase()) throw Error('Unauthorized vault call or receiver');
 if(a.functionName==='deposit' && a.args[0]!==1000000n) throw Error('Only one 1 USDC deposit permitted');
 if(a.functionName==='withdraw' && (a.args[0]<=0n||a.args[0]>100000n||a.args[2].toLowerCase()!==ADDRESS.toLowerCase())) throw Error('Withdrawal cap 0.1 USDC, own position only');
 return {kind:a.functionName,args:a.args};
}
export async function balances() {
 if(await client.getChainId()!==10143) throw Error('Wrong chain');
 const blockNumber=await client.getBlockNumber({cacheTime:0});
 const [gas,cash,idle,shares,preview]=await Promise.all([client.getBalance({address:ADDRESS,blockNumber}),client.readContract({address:deployment.asset,abi:erc20Abi,functionName:'balanceOf',args:[ADDRESS],blockNumber}),client.readContract({address:deployment.asset,abi:erc20Abi,functionName:'balanceOf',args:[deployment.vault],blockNumber}),client.readContract({address:deployment.vault,abi:erc20Abi,functionName:'balanceOf',args:[ADDRESS],blockNumber}),client.readContract({address:deployment.vault,abi:vaultAbi,functionName:'previewDeposit',args:[1000000n],blockNumber})]);
 return {at:new Date().toISOString(),chainId:10143,blockNumber,wallet:ADDRESS,gasWei:gas,mon:formatUnits(gas,18),usdc:formatUnits(cash,6),vaultIdle:formatUnits(idle,6),shares,depositPreview:preview};
}
export async function gasCheck(cost=0n) {
 const balance=await client.getBalance({address:ADDRESS});
 if(balance < 10000000000000000n + cost) throw Error('GAS LOW: abort all financial actions; reserve 0.01 MON');
}
export function signer() {
 const raw=fs.readFileSync(path.join(dir,'demo.key'),'utf8').trim();
 const account=privateKeyToAccount(raw.startsWith('0x')?raw:`0x${raw}`);
 if(account.address.toLowerCase()!==ADDRESS.toLowerCase()) throw Error('Dedicated key does not match video wallet');
 return account;
}
export function lock() {const file=path.join(dir,'update-capture.lock');const fd=fs.openSync(file,'wx',0o600);fs.writeFileSync(fd,String(process.pid));return ()=>{fs.closeSync(fd);fs.unlinkSync(file);};}
export async function send(tx) {
 const action=validate(tx);await gasCheck();
 if(ledger().actions.some(x=>x.kind===action.kind)) throw Error('Action already reserved; refusing repeat');
 const account=signer(),wallet=createWalletClient({account,chain:monadTestnet,transport:http(RPC,{retryCount:0})});
 await client.call({account:ADDRESS,to:tx.to,data:tx.data,value:0n});
 const gas=await client.estimateGas({account:ADDRESS,to:tx.to,data:tx.data,value:0n})*12n/10n;
 if(gas>1500000n) throw Error('Unexpected gas estimate');
 const request=await wallet.prepareTransactionRequest({account,to:tx.to,data:tx.data,value:0n,gas});
 await gasCheck(gas*(request.maxFeePerGas??request.gasPrice??0n));
 const id=reserve(action.kind,{to:tx.to,args:action.args});
 const serialized=await wallet.signTransaction(request),hash=keccak256(serialized);
 update(id,{hash,status:'signed',submittedAt:new Date().toISOString()});
 const started=performance.now();
 await client.sendRawTransaction({serializedTransaction:serialized});
 update(id,{status:'submitted'});
 // Return hash immediately, preserving the app's real measured confirmation.
 client.waitForTransactionReceipt({hash,pollingInterval:150}).then(receipt=>update(id,{status:receipt.status,observedReceiptMs:Math.round(performance.now()-started),receipt})).catch(()=>update(id,{status:'receipt-pending'}));
 console.log(`${action.kind}: ${hash}`);return hash;
}
