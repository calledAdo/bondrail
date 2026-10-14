import fs from 'node:fs';import os from 'node:os';import {createPublicClient,createWalletClient,http,formatEther,parseEther} from 'viem';import {privateKeyToAccount} from 'viem/accounts';import {monadTestnet} from 'viem/chains';
const c=createPublicClient({chain:monadTestnet,transport:http('https://rpc-testnet.monadinfra.com')});
const target='0x5e5111439F79140ACe0b7712992f48c2d0Bf0384';
for(const name of ['classic-issuer','pumplab-organic-0']){let key=fs.readFileSync(os.homedir()+'/.slice/'+name+'.key','utf8').trim();const a=privateKeyToAccount(key.startsWith('0x')?key:'0x'+key);console.log(name,a.address,formatEther(await c.getBalance({address:a.address})));}
console.log('target',formatEther(await c.getBalance({address:target})),'nonce',await c.getTransactionCount({address:target}),'pendingNonce',await c.getTransactionCount({address:target,blockTag:'pending'}),'gasPrice',String(await c.getGasPrice()));
if(process.argv.includes('--fund')){
 const journal='demo/video/output/cre/gas-topup.json';if(fs.existsSync(journal))throw Error('Topup already attempted');if(await c.getChainId()!==10143)throw Error('Wrong chain');
 let key=fs.readFileSync(os.homedir()+'/.slice/pumplab-organic-0.key','utf8').trim();const a=privateKeyToAccount(key.startsWith('0x')?key:'0x'+key);
 const w=createWalletClient({account:a,chain:monadTestnet,transport:http('https://rpc-testnet.monadinfra.com',{retryCount:0})});
 fs.writeFileSync(journal,JSON.stringify({status:'attempt_started',from:a.address,to:target,amountMON:'0.2'}));
 const hash=await w.sendTransaction({to:target,value:parseEther('0.2')});fs.writeFileSync(journal,JSON.stringify({status:'submitted',hash}));
 const r=await c.waitForTransactionReceipt({hash});fs.writeFileSync(journal,JSON.stringify({status:r.status,hash,amountMON:'0.2',to:target}));console.log('topup',r.status,hash);
}
