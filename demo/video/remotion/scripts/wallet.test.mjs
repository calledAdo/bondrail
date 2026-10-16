import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeFunctionData,erc20Abi} from 'viem';
import {validate,ADDRESS,deployment as d,vaultAbi} from './wallet.mjs';
const tx=(name,args,to=d.vault)=>({from:ADDRESS,to,data:encodeFunctionData({abi:name==='approve'?erc20Abi:vaultAbi,functionName:name,args}),chainId:'0x279f',value:'0x0'});
test('only the exact approved deposit and approval can pass',()=>{
 assert.equal(validate(tx('approve',[d.vault,1000000n],d.asset)).kind,'approve');
 assert.equal(validate(tx('deposit',[1000000n,ADDRESS])).kind,'deposit');
 for(const n of [0n,999999n,1000001n,2n**256n-1n]){
  assert.throws(()=>validate(tx('approve',[d.vault,n],d.asset)));
  assert.throws(()=>validate(tx('deposit',[n,ADDRESS])));
 }
});
test('small withdrawal only, no alternate receivers, destinations, chain or native value',()=>{
 assert.equal(validate(tx('withdraw',[100000n,ADDRESS,ADDRESS])).kind,'withdraw');
 for(const n of [0n,100001n])assert.throws(()=>validate(tx('withdraw',[n,ADDRESS,ADDRESS])));
 assert.throws(()=>validate(tx('withdraw',[1n,ADDRESS,d.factory])));
 assert.throws(()=>validate(tx('deposit',[1000000n,d.factory])));
 for(const patch of [{from:d.factory},{to:d.factory},{value:'0x1'},{chainId:1}])assert.throws(()=>validate({...tx('deposit',[1000000n,ADDRESS]),...patch}));
});
