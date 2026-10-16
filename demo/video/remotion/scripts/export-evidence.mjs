import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
import {out,save} from './wallet.mjs';
const evidence=path.resolve(import.meta.dirname,'../evidence');fs.mkdirSync(evidence,{recursive:true});
const captures=JSON.parse(fs.readFileSync(path.join(out,'capture.json')));
const chain=JSON.parse(fs.readFileSync(path.join(out,'chain-verification.json')));
const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const claims=[
 [0,15,'Real testnet landing and recorded live stats',['landing:hero','landing:live-stats']],
 [15,38,'Bondrail Credit, disclosed curator, fixed limits, team badge and non-endorsement',['vaults:directory','vaults:disclosure']],
 [38,44,'1 USDC deposit preview: approximately 1 share, 1 USDC entry price, idle cash 1.5 USDC',['vault:preview']],
 [44,51,'Real approval/deposit and 860 ms UI receipt observation',['vault:approval-confirmed','vault:confirmed']],
 [51,56,'Vault losses and idle-cash exit constraints',['vault:confirmed']],
 [56,62,'Portfolio position: 1 share and 1 USDC value/withdrawable/cost',['vault:portfolio']],
 [62,68,'One paid guarded API request: HTTP 200, 0.01 USDC, 10437 ms full request',['x402.json','x402-terminal.txt']],
 [68,90,'Account destination, proven payer, 2500 base units to bond in same transaction',['explorer:transaction','explorer:settled-event','chain-verification.json']],
 [90,100,'Oracle Agent summary and current Repaying step',['oracle:summary','oracle:timeline']],
 [100,106,'Labelled current/maturity/stopped-revenue claim values, not guaranteed',['oracle:claim-worth']],
 [106,109,'Real claim glossary definition',['oracle:glossary']],
 [109,119,'PumpLab share 25% -> 40% below 0.01 USDC over one complete day after trigger check',['pump:trigger']],
 [119,124,'Loss risks and unaudited contracts',['oracle:risks']],
 [124,130,'PumpLab on-chain record and repayment coverage: 1 of 1 bonds',['credit:profile']],
 [130,142,'Valid signed attestation and 0.000233 USDC assessed credit line at capture time',['credit:attestation']],
 [142,162,'Published package install and successful six-line consumer build',['builder.json','builder-terminal.txt']],
 [162,173.067,'Production URL, testnet/not audited and account-level same-transaction repayment',['chain-verification.json','landing:hero']],
].map(([start,end,claim,refs])=>({videoStart:start,videoEnd:end,claim,sources:refs.map(ref=>{
 if(!ref.includes(':'))return {artifact:ref,sha256:sha(path.join(out,ref))};
 const [scene,label]=ref.split(':'),capture=captures[scene],mark=capture.marks.find(x=>x.label===label);
 const artifact=path.relative(out,path.join(capture.dir,label+'.png'));
 return {scene,label,rawSeconds:mark.at,url:mark.url,focus:mark.rect,artifact,sha256:sha(path.join(out,artifact)),screenText:mark.text};
})}));
save(path.join(evidence,'claims.json'),claims);
save(path.join(evidence,'chain.json'),chain);
save(path.join(evidence,'media-sources.json'),Object.fromEntries(Object.entries(captures).filter(([,c])=>c.success).map(([scene,c])=>[scene,{directory:path.relative(out,c.dir),duration:c.duration,video:scene+'.mp4',videoSha256:sha(path.join(out,scene+'.mp4')),originalFrameCount:JSON.parse(fs.readFileSync(path.join(c.dir,'capture.json'))).frames.length}])));
if(fs.existsSync(path.join(out,'validation.json')))save(path.join(evidence,'validation.json'),JSON.parse(fs.readFileSync(path.join(out,'validation.json'))));
console.log('Public claims, chain verification and media hashes exported.');
