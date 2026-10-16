import fs from 'node:fs';
import path from 'node:path';
import {parseAbi,decodeEventLog} from 'viem';
import {x402Client,wrapFetchWithPayment} from '@x402/fetch';
import {registerExactEvmScheme} from '@x402/evm/exact/client';
import {bondrailGuard,isBondrailAccount,pinFromBond} from '@bondrail/sdk/x402-guard';
import {ADDRESS,deployment as d,client,signer,gasCheck,lock,reserve,update,save,out} from './wallet.mjs';
const release=lock();
try {
 await gasCheck();
 const url=d.issuers.agent.endpoint;
 const pin=await pinFromBond(client,d.issuers.agent.bond);
 if(pin.account.toLowerCase()!==d.issuers.agent.account.toLowerCase())throw Error('Unexpected account');
 const payer=signer();let id, signed=false;
 const signerGuard={address:payer.address,signTypedData:async data=>{
  if(signed)throw Error('Only one signature per API call permitted');
  if(Number(data.domain.chainId)!==10143||data.domain.verifyingContract.toLowerCase()!==d.asset.toLowerCase()||data.primaryType!=='TransferWithAuthorization'||data.message.from.toLowerCase()!==ADDRESS.toLowerCase()||data.message.to.toLowerCase()!==pin.account.toLowerCase()||BigInt(data.message.value)!==10000n)throw Error('Authorization outside 0.01 USDC budget/account/chain');
  await gasCheck();id=reserve('x402',{amount:'10000',to:pin.account,nonce:data.message.nonce});signed=true;
  return payer.signTypedData(data);
 }};
 const buyer=new x402Client();registerExactEvmScheme(buyer,{signer:signerGuard});
 const guarded=bondrailGuard(fetch,{verifyAccount:isBondrailAccount(client,d.factory),pin:{[new URL(url).origin]:pin}});
 const timings=[];
 const timed=async(input,init)=>{const start=performance.now();const response=await guarded(input,init);timings.push({url:String(input),status:response.status,milliseconds:Math.round(performance.now()-start)});return response;};
 const pay=wrapFetchWithPayment(timed,buyer),start=performance.now();
 console.log('$ guarded x402 GET '+url);console.log('payer '+ADDRESS);
 const response=await pay(url+'?question='+encodeURIComponent('Explain revenue bonds in one sentence.'));
 const body=await response.json(),elapsedMs=Math.round(performance.now()-start);
 const hash=body.payment?.transaction;
 if(!response.ok||!hash){if(id!==undefined)update(id,{status:'response-failed',httpStatus:response.status});throw Error('Payment response not successful; journal reserved, do not repeat blindly');}
 update(id,{hash,status:'submitted'});
 const [receipt,tx]=await Promise.all([client.getTransactionReceipt({hash}),client.getTransaction({hash})]);
 const abi=parseAbi(['event Settled(address indexed payer,uint256 value,bytes32 indexed nonce)','event Revenue(address indexed bond,address indexed payer,uint256 amount,uint256 toBond,uint256 toIssuer,bool collected)']);
 const logs=receipt.logs.flatMap(l=>{try{return [{...decodeEventLog({abi,...l}),address:l.address}];}catch{return [];}});
 const settled=logs.find(x=>x.eventName==='Settled'&&x.address.toLowerCase()===pin.account.toLowerCase());
 if(receipt.status!=='success'||tx.to.toLowerCase()!==pin.account.toLowerCase()||settled?.args.payer.toLowerCase()!==ADDRESS.toLowerCase()||settled?.args.value!==10000n)throw Error('Settlement evidence mismatch');
 const evidence={capturedAt:new Date().toISOString(),url,payer:ADDRESS,hash,to:tx.to,amountUSDC:'0.01',elapsedMs,timings,body,receipt,logs};
 save(path.join(out,'x402.json'),evidence);update(id,{status:'success',receipt,elapsedMs});
 const transcript=`$ guarded x402 GET ${url}\npayer ${ADDRESS}\nHTTP ${response.status} · paid 0.01 test USDC\ntransaction ${hash}\nto ${tx.to}\nSettled(payer=${settled.args.payer}, value=10000)\nEnd-to-end API response: ${elapsedMs} ms\n`;
 fs.writeFileSync(path.join(out,'x402-terminal.txt'),transcript);console.log(transcript);
} finally {release();}
