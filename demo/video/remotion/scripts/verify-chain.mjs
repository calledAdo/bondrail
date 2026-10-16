// Read-only verification; never signs or sends a transaction.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {parseAbi,decodeEventLog,erc20Abi,decodeFunctionData} from 'viem';
import {client,deployment as d,ADDRESS,out,ledger,save,balances,vaultAbi} from './wallet.mjs';
assert.equal(await client.getChainId(),10143);
const state=ledger();assert(state.actions.filter(a=>a.kind==='approve').length<=1);assert(state.actions.filter(a=>a.kind==='deposit').length<=1);assert(state.actions.filter(a=>a.kind==='withdraw').length<=1);assert(state.actions.filter(a=>a.kind==='x402').length<=5);
const abi=parseAbi(['event Settled(address indexed payer,uint256 value,bytes32 indexed nonce)','event Revenue(address indexed bond,address indexed payer,uint256 amount,uint256 toBond,uint256 toIssuer,bool collected)']);
const results=[];
for(const a of state.actions){
 assert(a.hash,'Reserved action needs reconciliation');
 const [tx,receipt]=await Promise.all([client.getTransaction({hash:a.hash}),client.getTransactionReceipt({hash:a.hash})]);assert.equal(receipt.status,'success');
 const to=a.kind==='approve'?d.asset:a.kind==='x402'?d.issuers.agent.account:d.vault;assert.equal(tx.to.toLowerCase(),to.toLowerCase());
 const decoded=receipt.logs.flatMap(l=>{try{return [{...decodeEventLog({abi:[...abi,...vaultAbi,...erc20Abi],...l}),address:l.address}];}catch{return [];}});
 if(a.kind==='x402'){
  const event=decoded.find(x=>x.eventName==='Settled');assert.equal(event.address.toLowerCase(),to.toLowerCase());assert.equal(event.args.payer.toLowerCase(),ADDRESS.toLowerCase());assert.equal(event.args.value,10000n);
  const revenue=decoded.find(x=>x.eventName==='Revenue');assert(revenue);assert.equal(revenue.args.payer.toLowerCase(),ADDRESS.toLowerCase());assert.equal(revenue.args.bond.toLowerCase(),d.issuers.agent.bond.toLowerCase());assert.equal(revenue.args.toBond,2500n);assert.equal(revenue.args.toIssuer,7500n);
 }else{
  assert.equal(tx.from.toLowerCase(),ADDRESS.toLowerCase());
  const call=decodeFunctionData({abi:a.kind==='approve'?erc20Abi:vaultAbi,data:tx.input});
  if(a.kind==='approve'){assert.equal(call.args[0].toLowerCase(),d.vault.toLowerCase());assert.equal(call.args[1],1000000n);}else{assert(call.args[0]<=1000000n);assert.equal(call.args[1].toLowerCase(),ADDRESS.toLowerCase());}
 }
 const block=await client.getBlock({blockNumber:receipt.blockNumber});
 results.push({kind:a.kind,hash:a.hash,from:tx.from,to:tx.to,status:receipt.status,blockNumber:receipt.blockNumber,blockTimestamp:block.timestamp,gasUsed:receipt.gasUsed,effectiveGasPrice:receipt.effectiveGasPrice,decoded,receipt});
}
const report={verifiedAt:new Date().toISOString(),chainId:10143,wallet:ADDRESS,actions:results,balances:await balances(),budget:{approve:1,depositUSDC:1,withdrawUSDC:0,x402Calls:state.actions.filter(a=>a.kind==='x402').length}};
save(path.join(out,'chain-verification.json'),report);console.log(JSON.stringify({actions:results.map(x=>({kind:x.kind,hash:x.hash,status:x.status})),balance:report.balances.mon,paidCalls:report.budget.x402Calls},null,2));
