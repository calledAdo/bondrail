// Copies only recorded, public evidence and local brand assets into the render bundle.
import fs from 'node:fs';import path from 'node:path';import {out,root,save} from './wallet.mjs';
const pkg=path.resolve(import.meta.dirname,'..'),pub=path.join(pkg,'public');fs.mkdirSync(pub,{recursive:true});
const captures=JSON.parse(fs.readFileSync(path.join(out,'capture.json')));
const scenes=JSON.parse(fs.readFileSync(path.join(out,'narration.json')));
const words=JSON.parse(fs.readFileSync(path.join(out,'words.json')));
const payment=JSON.parse(fs.readFileSync(path.join(out,'x402.json')));
const builder=JSON.parse(fs.readFileSync(path.join(out,'builder.json')));
if(!builder.success)throw Error('Builder did not succeed');
for(const name of ['landing','vaults','vault','oracle','pump','credit','explorer']){
 if(!captures[name]?.success)throw Error(`Missing successful ${name} capture`);
 fs.copyFileSync(path.join(out,name+'.mp4'),path.join(pub,name+'.mp4'));
}
fs.copyFileSync(path.join(out,'mix.wav'),path.join(pub,'mix.wav'));
fs.copyFileSync(path.join(root,'brand/bondrail/svg/bondrail-lockup-dark.svg'),path.join(pub,'logo.svg'));
for(const [folder,file,target] of [['geist-sans','Geist-Variable.woff2','Geist.woff2'],['geist-mono','GeistMono-Regular.woff2','GeistMono.woff2']])fs.copyFileSync(path.join(root,'apps/web/node_modules/geist/dist/fonts',folder,file),path.join(pub,target));
const mark=(scene,label)=>captures[scene].marks.find(m=>m.label===label);
const landing=mark('landing','live-stats').text;
const stats=Object.fromEntries([...landing.matchAll(/\[([^\]]+)\]\s*\n\s*(Revenue routed|Payments booked|Collected for investors|Live bonds)/g)].map(m=>[m[2],m[1]]));
if(Object.keys(stats).length!==4)throw Error('Cannot extract recorded stats');
const portableCaptures=Object.fromEntries(Object.entries(captures).filter(([,c])=>c.success).map(([name,c])=>[name,{marks:c.marks,duration:c.duration,errors:c.errors}]));
const data={scenes:scenes.map(s=>({...s,lines:s.lines.map(l=>({...l,file:path.basename(l.file)}))})),words,captures:portableCaptures,payment:{hash:payment.hash,to:payment.to,payer:payment.payer,amount:payment.amountUSDC,elapsedMs:payment.elapsedMs},builder:{...builder,directory:path.basename(builder.directory)},stats,terminal:fs.readFileSync(path.join(out,'x402-terminal.txt'),'utf8')};
save(path.join(pkg,'src/data.json'),data);
console.log('Prepared',scenes.reduce((n,s)=>n+s.duration,0),'seconds; real recorded stats',stats);
