import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recoverTypedDataAddress,type Hex } from 'viem';
import { Observer } from '../src/index.js';
import { LocalStore } from '../src/store.js';
import { publicAddress,validateURL } from '../src/fetch.js';
import { parseOffer,policyHash,PARSER_VERSION,observationDomain,observationTypes,typedObservation,type WatchPolicy } from '../src/protocol.js';
const p:WatchPolicy={id:'research',chainId:10143,chainSelector:'2183018362218727504',covenant:'0x1111111111111111111111111111111111111111',bond:'0x2222222222222222222222222222222222222222',url:'https://agent.example/api/oracle?question=health',method:'GET',headers:{accept:'application/json'},network:'eip155:10143',asset:'0x534b2f3A21130d7a60830c2Df862319e593943A3',expectedPayTo:'0x3333333333333333333333333333333333333333',amount:'10000',maxTimeoutSeconds:300,parserVersion:PARSER_VERSION,epochSeconds:30,freshnessSeconds:90};
function offer(payTo=p.expectedPayTo){return {x402Version:2,resource:{url:p.url},accepts:[{scheme:'exact',network:p.network,asset:p.asset,payTo,amount:p.amount,maxTimeoutSeconds:300,extra:{assetTransferMethod:'eip3009'}}]};}
const encoded=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64');
test('single valid changed recipient is breach; outage and ambiguity never are',()=>{
  assert.equal(parseOffer(402,encoded(offer()),p).result,1);
  assert.equal(parseOffer(402,encoded(offer('0x4444444444444444444444444444444444444444')),p).result,2);
  for(const status of [0,200,301,429,500])assert.equal(parseOffer(status,encoded(offer()),p).result,0);
  const many=offer();many.accepts.push(many.accepts[0]!);assert.equal(parseOffer(402,encoded(many),p).result,0);
  assert.equal(parseOffer(402,'not_base64',p).result,0);
  const permit=offer();permit.accepts[0]!.extra.assetTransferMethod='permit2';assert.equal(parseOffer(402,encoded(permit),p).result,0);
});
test('full offer canonical hash stable across field order, sensitive to extensions',()=>{
  const a=offer(),b={accepts:a.accepts,resource:a.resource,x402Version:2};
  assert.equal(parseOffer(402,encoded(a),p).offerHash,parseOffer(402,encoded(b),p).offerHash);
  assert.notEqual(parseOffer(402,encoded(a),p).offerHash,parseOffer(402,encoded({...a,extensions:{newPolicy:true}}),p).offerHash);
  assert.notEqual(policyHash(p),policyHash({...p,url:p.url+'&another=1'}));
});
test('SSRF checks deny private, loopback, reserved and mapped address ranges',()=>{
  for(const ip of ['127.0.0.1','10.0.0.2','169.254.169.254','192.168.1.2','172.31.1.1','100.64.1.2','::1','::ffff:127.0.0.1','fd00::1','fe80::1','2002:7f00:1::','2001:db8::1'])assert.equal(publicAddress(ip),false,ip);
  assert.equal(publicAddress('8.8.8.8'),true);assert.equal(publicAddress('2606:4700:4700::1111'),true);
  assert.throws(()=>validateURL('https://user:password@example.com/'));assert.throws(()=>validateURL('http://127.0.0.1:3001/',false));
  assert.equal(validateURL('http://127.0.0.1:3001/',true).port,'3001');
});
test('durable CAS elects one writer across store instances and survives reopening',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'slice-store-'));try{const a=new LocalStore(dir),b=new LocalStore(dir);
    const wins=await Promise.all([a.cas('key',null,'one'),b.cas('key',null,'two')]);assert.equal(wins.filter(Boolean).length,1);
    const value=await new LocalStore(dir).get('key');assert.ok(value==='one'||value==='two');assert.equal(await b.cas('key','wrong','three'),false);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('observer fetches independently, signs immutable one-per-epoch and binds deployment',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'slice-observer-'));try{let calls=0;const key=`0x${'11'.repeat(32)}` as Hex;
    const observer=new Observer([p],new LocalStore(dir),key,false,async()=>{calls++;return {status:402,header:encoded(offer())};},()=>3001);
    const one=await observer.observe(p.id,100),two=await observer.observe(p.id,100);assert.deepEqual(one,two);assert.equal(calls,1);
    const signer=await recoverTypedDataAddress({domain:observationDomain(p),types:observationTypes,primaryType:'Observation',message:typedObservation(one.observation),signature:one.signature});assert.equal(signer,observer.signerAddress);
    const wrong=await recoverTypedDataAddress({domain:observationDomain({...p,chainId:31337}),types:observationTypes,primaryType:'Observation',message:typedObservation(one.observation),signature:one.signature});assert.notEqual(wrong,observer.signerAddress);
    await assert.rejects(observer.observe(p.id,99));await assert.rejects(observer.observe('arbitrary-url',100));
  }finally{await rm(dir,{recursive:true,force:true});}
});
