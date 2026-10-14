// Bounded preparation for the authorized Monad-testnet demo. No keys enter output.
import fs from 'node:fs';
import os from 'node:os';
import {createPublicClient,createWalletClient,http,erc20Abi,decodeEventLog,encodeAbiParameters,parseAbiParameters,keccak256,stringToHex} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {monadTestnet} from 'viem/chains';
const out=new URL('./output/technical/',import.meta.url);
const d=JSON.parse(fs.readFileSync(new URL('../../docs/deployments/10143.json',import.meta.url)));
const artifact=n=>JSON.parse(fs.readFileSync(new URL(`../../contracts/out/${n}.sol/${n}.json`,import.meta.url)));
const factory=artifact('BondrailFactory'),launch=artifact('PumpLab');
const key=n=>{const s=fs.readFileSync(`${os.homedir()}/.slice/${n}.key`,'utf8').trim();return privateKeyToAccount(s.startsWith('0x')?s:`0x${s}`)};
const issuer=key('classic-issuer'),payer=key('pumplab-organic-0');
const client=createPublicClient({chain:monadTestnet,transport:http('https://testnet-rpc.monad.xyz',{retryCount:3})});
const file=new URL('scenario.json',out),journal=new URL('preparation-transactions.json',out);
const s=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{name:'LaunchLab',issuer:issuer.address,issuerKey:'classic-issuer',payerKey:'pumplab-organic-0',chainId:10143};
const txs=fs.existsSync(journal)?JSON.parse(fs.readFileSync(journal)):[];
const json=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v,2);
const save=()=>fs.writeFileSync(file,json(s));
async function write(label,who,address,abi,functionName,args){
 if(txs.some(t=>t.label===label))throw Error(`Existing ${label} journal entry: reconcile before retry`);
 await client.simulateContract({account:who,address,abi,functionName,args});
 const gas=await client.estimateContractGas({account:who,address,abi,functionName,args});
 if(gas>5000000n)throw Error('Unexpected gas');
 const hash=await createWalletClient({account:who,chain:monadTestnet,transport:http('https://testnet-rpc.monad.xyz')}).writeContract({address,abi,functionName,args,gas:gas*12n/10n});
 const e={label,hash,status:'pending',address,functionName};txs.push(e);fs.writeFileSync(journal,json(txs));
 const r=await client.waitForTransactionReceipt({hash});e.status=r.status;e.blockNumber=r.blockNumber;fs.writeFileSync(journal,json(txs));
 if(r.status!=='success')throw Error('Reverted');console.log(label,hash);return r;
}
const event=(r,name)=>r.logs.map(l=>{try{return decodeEventLog({abi:factory.abi,...l})}catch{return null}}).find(e=>e?.eventName===name).args;
if(await client.getChainId()!==10143)throw Error('Wrong chain');
if(!await client.readContract({address:d.factory,abi:factory.abi,functionName:'nativeTemplate',args:[keccak256(launch.bytecode.object)]}))throw Error('Template not reviewed');
if(!s.account){const r=await write('create demo account',issuer,d.factory,factory.abi,'createAccount',[d.asset]);s.account=event(r,'AccountCreated').account;save()}
if(!s.source){const r=await write('deploy reviewed launchpad',issuer,d.factory,factory.abi,'deployNative',[s.account,launch.bytecode.object,encodeAbiParameters(parseAbiParameters('address,string,string'),[s.account,'LaunchLab Demo','LLAB']),keccak256(stringToHex('bondrail-technical-demo-20261012'))]);s.source=event(r,'NativeDeployed').project;save()}
if(!s.historyHash){
 const allowance=await client.readContract({address:d.asset,abi:erc20Abi,functionName:'allowance',args:[payer.address,s.account]});
 if(allowance<1000000n)await write('history payment approval',payer,d.asset,erc20Abi,'approve',[s.account,1000000n]);
 const [quote]=await client.readContract({address:s.source,abi:launch.abi,functionName:'quoteBuy',args:[1000000n]});
 const block=await client.getBlock();const r=await write('initial real business payment',payer,s.source,launch.abi,'buy',[1000000n,quote*99n/100n,block.timestamp+600n]);s.historyHash=r.transactionHash;s.readyAt=Number((await client.getBlock({blockNumber:r.blockNumber})).timestamp)+600;save();
}
if(!s.profile){
 const profile={account:s.account,name:s.name,description:'Team-run testnet launchpad demonstrating revenue-bond issuance and automatic fee repayment. Activity is demo traffic, not customer traction.',website:'',x:'',useOfFunds:'Demonstrate a small capital raise with staged release on Monad testnet.',updatedAt:BigInt(Math.floor(Date.now()/1000))};
 const types={Profile:[{name:'account',type:'address'},...['name','description','website','x','useOfFunds'].map(name=>({name,type:'string'})),{name:'updatedAt',type:'uint64'}]};
 const signature=await issuer.signTypedData({domain:{name:'Bondrail Profile',version:'1',chainId:10143},types,primaryType:'Profile',message:profile});
 const r=await fetch('https://bondrail.vercel.app/api/registry',{method:'POST',headers:{'content-type':'application/json'},body:json({type:'profile',profile,signature})});if(!r.ok)throw Error(await r.text());s.profile=true;save();
}
console.log(json(s));
