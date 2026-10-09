import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createPublicClient,createWalletClient,defineChain,http,parseAbi,decodeEventLog,type Address,type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { address } from '@slice/observer/protocol';
import { storeFromEnv } from '@slice/observer/store';
import { nextOperation } from './plan.js';
import { runCRE } from './cre.js';
const bondABI=parseAbi([
  'function phase() view returns (uint8)','function router() view returns (address)','function undrawnPrincipal() view returns (uint256)','function settleAfter() view returns (uint64)',
  'function terms() view returns ((uint256 raiseAmount,uint256 repayCap,uint256 stake,uint256 minRevenue,uint64 fundingDeadline,uint64 maturity,uint64 secondReleaseNotBefore,uint64 secondReleaseDeadline,uint32 minOperatingPeriod,uint16 revenueBps,uint16 firstReleaseBps))',
  'function expireUndrawn()','function finalizeSettlement()',
]);
const routerABI=parseAbi(['function issuerCredit() view returns (uint256)','function activeBond() view returns (address)','function sweep()','function closeBondAtMaturity(address expectedBond)','function cancelFunding(address expectedBond)']);
const tokenABI=parseAbi(['function balanceOf(address account) view returns (uint256)']);
const observationABI=parseAbi(['event ObservationAccepted(address indexed bond,uint64 indexed epoch,uint8 result,uint64 observedAt,bytes32 evidenceHash,bytes32 digest)']);
interface Target {bond:Address;router:Address;covenant?:Address;creWorkflow?:string}
const chainId=Number(process.env.SLICE_CHAIN_ID??10143);
if(chainId!==10143&&chainId!==31337)throw new Error('Worker forbids mainnet writes');
const {SLICE_RPC_URL,WORKER_TARGETS_FILE,WORKER_PRIVATE_KEY,WORKER_ASSET,CRE_PROJECT_DIR}=process.env;
if(!SLICE_RPC_URL||!WORKER_TARGETS_FILE||!address(WORKER_ASSET))throw new Error('Worker RPC, asset and targets file required');
const targets=JSON.parse(await readFile(WORKER_TARGETS_FILE,'utf8')) as Target[];
if(!Array.isArray(targets)||targets.length>16||targets.some(t=>!address(t.bond)||!address(t.router)||(t.covenant&&!address(t.covenant))))throw new Error('Invalid bounded worker targets');
if(targets.some(t=>[t.bond,t.router,t.covenant].some(v=>v&&/^0x0{40}$/i.test(v))))throw new Error('Replace zero-address worker placeholders');
const chain=defineChain({id:chainId,name:chainId===10143?'Monad Testnet':'Slice Local',nativeCurrency:{name:'MON',symbol:'MON',decimals:18},rpcUrls:{default:{http:[SLICE_RPC_URL]}}});
const client=createPublicClient({chain,transport:http(SLICE_RPC_URL,{timeout:10000,retryCount:1})});
let rpcChain:number;try{rpcChain=await client.getChainId();}catch{throw new Error('Worker RPC unavailable (provider details withheld)');}
if(rpcChain!==chainId)throw new Error('Worker RPC chain mismatch');
const enabled=process.env.SLICE_ENABLE_TESTNET_WRITES==='1';
if(!enabled||process.argv.includes('--check')){console.log(JSON.stringify({network:chainId,targets:targets.length,writesEnabled:enabled,keyConfigured:!!WORKER_PRIVATE_KEY,creConfigured:!!CRE_PROJECT_DIR,mode:'diagnostic; no writes sent'}));process.exit(0);}
if(!/^0x[0-9a-fA-F]{64}$/.test(WORKER_PRIVATE_KEY??''))throw new Error('Worker signer key missing');
if(chainId===10143&&targets.some(t=>t.covenant&&(!t.creWorkflow||!CRE_PROJECT_DIR)))throw new Error('Watched targets require actual CRE workflow configuration');
const account=privateKeyToAccount(WORKER_PRIVATE_KEY as Hex),wallet=createWalletClient({chain,account,transport:http(SLICE_RPC_URL,{timeout:10000,retryCount:0})});
const store=storeFromEnv(),owner=randomUUID(),controller=new AbortController();
for(const name of ['SIGTERM','SIGINT'])process.on(name,()=>controller.abort());
const pendingKey=`worker-pending:${chainId}:${account.address.toLowerCase()}`;
const unfinished=await store.get(pendingKey);
if(unfinished&&JSON.parse(unfinished).state!=='confirmed')throw new Error('Unresolved prior worker transaction; reconcile its hash/nonce before restarting');
async function submitMaintenance(operation:string,bond:Address,send:()=>Promise<Hex>):Promise<Hex>{
  const previous=await store.get(pendingKey);
  if(previous&&JSON.parse(previous).state!=='confirmed')throw new Error('Prior transaction remains unresolved');
  const nonce=await client.getTransactionCount({address:account.address,blockTag:'pending'});
  let raw=JSON.stringify({state:'prepared',operation,bond,nonce,createdAt:new Date().toISOString()});
  if(!await store.cas(pendingKey,previous,raw))throw new Error('Transaction journal contention');
  try{
    const transaction=await send();
    const submitted=JSON.stringify({state:'submitted',operation,bond,nonce,transaction});
    if(!await store.cas(pendingKey,raw,submitted))throw new Error('Submitted transaction journal failed');raw=submitted;
    const receipt=await client.waitForTransactionReceipt({hash:transaction,confirmations:1,timeout:30000});
    if(receipt.status!=='success')throw new Error('Maintenance transaction reverted');
    if(!await store.cas(pendingKey,raw,JSON.stringify({state:'confirmed',operation,bond,nonce,transaction})))throw new Error('Confirmed transaction journal failed');
    return transaction;
  }catch(e){controller.abort();throw e;}
}
const maxCycles=Math.min(120,Math.max(1,Number(process.env.WORKER_MAX_CYCLES??120)));
if(!Number.isSafeInteger(maxCycles))throw new Error('Invalid cycle bound');
const maxGasPrice=BigInt(process.env.WORKER_MAX_GAS_PRICE_WEI??'100000000000');
let lease:string|null=null;
try{
  for(let cycle=0;cycle<maxCycles&&!controller.signal.aborted;cycle++){
    const start=Date.now(),key=`worker-lease:${chainId}:${account.address.toLowerCase()}`;
    const previous=await store.get(key);if(previous!==lease&&previous&&JSON.parse(previous).expiresAt>Date.now())throw new Error('Another worker holds the signer lease');
    const next=JSON.stringify({owner,expiresAt:Date.now()+180000});if(!await store.cas(key,previous,next))throw new Error('Worker lease contention');lease=next;
    let writes=0;
    for(const target of targets){if(controller.signal.aborted||writes>=4||Date.now()-start>90000)break;
      try{
        const phase=await client.readContract({address:target.bond,abi:bondABI,functionName:'phase'});
        const router=await client.readContract({address:target.bond,abi:bondABI,functionName:'router'});if(router.toLowerCase()!==target.router.toLowerCase())throw new Error('Target router mismatch');
        // CRE is the only operational report transport; local mode exercises contract maintenance only.
        if(chainId===10143&&target.covenant&&target.creWorkflow&&CRE_PROJECT_DIR&&(phase===0||phase===1)){
          const epoch=Math.floor(Date.now()/30000),reportKey=`worker-report:${target.bond}:${epoch}`;
          if(!await store.get(reportKey))try{
            writes++;
            const transaction=await runCRE(CRE_PROJECT_DIR,target.creWorkflow,controller.signal);
            const receipt=await client.waitForTransactionReceipt({hash:transaction,confirmations:1,timeout:30000});
            if(receipt.status!=='success'||!receipt.logs.some(log=>{if(log.address.toLowerCase()!==target.covenant!.toLowerCase())return false;try{const event=decodeEventLog({abi:observationABI,data:log.data,topics:log.topics});return event.args.bond.toLowerCase()===target.bond.toLowerCase();}catch{return false;}}))throw new Error('CRE receipt did not confirm target observation');
            await store.cas(reportKey,null,JSON.stringify({transaction,confirmed:true}));
          }catch{console.error(JSON.stringify({bond:target.bond,status:'monitor_unavailable',message:'Continuing permissionless expiry and closure checks'}));}
        }
        if(writes>=4)break;
        const block=await client.getBlock();
        const [terms,undrawnPrincipal,settleAfter,balance,credit,freshPhase]=await Promise.all([
          client.readContract({address:target.bond,abi:bondABI,functionName:'terms'}),client.readContract({address:target.bond,abi:bondABI,functionName:'undrawnPrincipal'}),client.readContract({address:target.bond,abi:bondABI,functionName:'settleAfter'}),client.readContract({address:WORKER_ASSET,abi:tokenABI,functionName:'balanceOf',args:[router]}),client.readContract({address:router,abi:routerABI,functionName:'issuerCredit'}),client.readContract({address:target.bond,abi:bondABI,functionName:'phase'}),
        ]);
        const operation=nextOperation({phase:freshPhase,now:block.timestamp,...terms,undrawnPrincipal,settleAfter,freeReceipts:balance>credit?balance-credit:0n});if(!operation)continue;
        if(await client.getGasPrice()>maxGasPrice)throw new Error('Gas price exceeds configured bound');
        let tx:Hex;
        if(operation==='expireUndrawn'||operation==='finalizeSettlement'){
          const {request}=await client.simulateContract({account,address:target.bond,abi:bondABI,functionName:operation,gas:1000000n,gasPrice:maxGasPrice});tx=await submitMaintenance(operation,target.bond,()=>wallet.writeContract(request));
        }else if(operation==='sweep'){
          const active=await client.readContract({address:router,abi:routerABI,functionName:'activeBond'});if(active.toLowerCase()!==target.bond.toLowerCase())throw new Error('Router reserved for another bond');
          const {request}=await client.simulateContract({account,address:router,abi:routerABI,functionName:'sweep',gas:1000000n,gasPrice:maxGasPrice});tx=await submitMaintenance(operation,target.bond,()=>wallet.writeContract(request));
        }else{const {request}=await client.simulateContract({account,address:router,abi:routerABI,functionName:operation,args:[target.bond],gas:1000000n,gasPrice:maxGasPrice});tx=await submitMaintenance(operation,target.bond,()=>wallet.writeContract(request));}
        writes++;await store.cas(`worker-tx:${tx}`,null,JSON.stringify({operation,bond:target.bond,status:'confirmed'}));
        console.log(JSON.stringify({operation,bond:target.bond,transaction:tx,status:'confirmed'}));
      }catch{console.error(JSON.stringify({bond:target.bond,status:'failed',error:'worker_operation_failed; check chain state and durable transaction journal'}));}
    }
    if(!controller.signal.aborted)await delay(Math.max(1000,30000-(Date.now()-start)),undefined,{signal:controller.signal}).catch(()=>undefined);
  }
}finally{if(lease)await store.cas(`worker-lease:${chainId}:${account.address.toLowerCase()}`,lease,JSON.stringify({owner,expiresAt:0}));}
