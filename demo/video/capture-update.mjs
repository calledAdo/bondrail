// Real production screens only. CDP timestamped frames -> 1920x1080, 30 fps.
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from '@playwright/test';
import {spawnSync} from 'node:child_process';
import {out,LIVE,ADDRESS,client,deployment as d,balances,save,send,lock} from './remotion/scripts/wallet.mjs';
const scene=process.argv.find(x=>x.startsWith('--scene='))?.slice(8)??'inspect';
fs.mkdirSync(out,{recursive:true});
if(scene==='preflight'){const b=await balances();save(path.join(out,'preflight.json'),b);console.log(b);process.exit(0);}
const unlock=['vault','withdraw'].includes(scene)?lock():()=>{};
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:scene!=='explorer',args:['--autoplay-policy=no-user-gesture-required']});
const context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1,colorScheme:'dark'});
await context.exposeBinding('__videoWallet',async({frame},{method,params=[]})=>{
 if(new URL(frame.url()).origin!==LIVE)throw Error('Wallet origin refused');
 if(['eth_accounts','eth_requestAccounts'].includes(method))return [ADDRESS];
 if(method==='eth_chainId')return '0x279f';
 if(method==='net_version')return '10143';
 if(method==='wallet_switchEthereumChain'){if(params[0]?.chainId!=='0x279f')throw Error('Wrong chain');return null;}
 if(method==='wallet_getCapabilities')return {};
 if(method==='eth_sendTransaction'){if(!['vault','withdraw'].includes(scene))throw Error('Read-only scene');return send(params[0]);}
 if(!['eth_call','eth_estimateGas','eth_gasPrice','eth_maxPriorityFeePerGas','eth_getBlockByNumber','eth_getTransactionCount','eth_getTransactionReceipt','eth_getTransactionByHash','eth_getBalance','eth_blockNumber','eth_feeHistory'].includes(method))throw Error('Unsupported method '+method);
 return client.request({method,params});
});
await context.addInitScript(()=>{
 const events=new Map();
 window.ethereum={isBondrailDemo:true,request:a=>window.__videoWallet(a),on:(n,f)=>events.set(n,[...(events.get(n)??[]),f]),removeListener:(n,f)=>events.set(n,(events.get(n)??[]).filter(x=>x!==f))};
});
const page=await context.newPage(),cdp=await context.newCDPSession(page);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const pause=s=>page.waitForTimeout(s*1000);
let cursor={x:960,y:900},marks=[],frames=[],start,dir;
async function move(x,y){const from={...cursor};for(let i=1;i<=32;i++){const t=i/32,e=t*t*(3-2*t);await page.mouse.move(from.x+(x-from.x)*e,from.y+(y-from.y)*e);if(start)marks.push({type:'cursor',at:(Date.now()-start)/1000,x:from.x+(x-from.x)*e,y:from.y+(y-from.y)*e});await pause(.018);}cursor={x,y};}
async function point(loc){const b=await loc.boundingBox();if(!b)throw Error('Target not visible');await move(b.x+b.width/2,b.y+b.height/2);await pause(.25);}
async function click(loc){await loc.scrollIntoViewIfNeeded();await point(loc);await page.mouse.click(cursor.x,cursor.y);}
async function focus(loc){await loc.evaluate(el=>window.scrollTo({top:el.getBoundingClientRect().top+scrollY-155,behavior:'smooth'}));await pause(1);}
async function mark(label,loc){const at=(Date.now()-start)/1000;const text=await page.locator('body').innerText();const rect=loc?await loc.boundingBox():null;marks.push({type:'evidence',label,at,url:page.url(),rect,text});await page.screenshot({path:path.join(dir,label+'.png')});console.log(`${scene}/${label} ${at.toFixed(2)}s`);}
async function go(route){await page.goto(LIVE+route,{waitUntil:'domcontentloaded',timeout:60000});await pause(6);await page.evaluate(()=>document.fonts.ready);}
async function record(){dir=path.join(out,'raw',scene+'-'+Date.now());fs.mkdirSync(dir,{recursive:true});start=Date.now();await page.screenshot({path:path.join(dir,'initial.jpg'),type:'jpeg',quality:92});frames.push({file:'initial.jpg',at:0});cdp.on('Page.screencastFrame',async ev=>{const file=`frame-${String(frames.length).padStart(6,'0')}.jpg`;fs.writeFileSync(path.join(dir,file),Buffer.from(ev.data,'base64'));frames.push({file,at:Math.max(0,ev.metadata.timestamp-start/1000)});await cdp.send('Page.screencastFrameAck',{sessionId:ev.sessionId}).catch(()=>{});});await cdp.send('Page.startScreencast',{format:'jpeg',quality:90,maxWidth:1920,maxHeight:1080,everyNthFrame:1});}
async function connect(){const b=page.getByRole('button',{name:'Connect',exact:true});if(await b.isVisible()){await click(b);await click(page.getByRole('menuitem',{name:'Browser wallet'}));}await page.getByRole('button',{name:'Disconnect wallet'}).waitFor({timeout:30000});await pause(3);}
try{
 if(scene==='inspect'){
  for(const [name,route] of Object.entries({landing:'/',vaults:'/vaults',vault:'/vaults/'+d.vault,oracle:'/bonds/'+d.issuers.agent.bond,pump:'/bonds/'+d.issuers.pumplab.bond,credit:'/accounts/'+d.issuers.pumplab.account})){
   await go(route);fs.writeFileSync(path.join(out,'inspect-'+name+'.txt'),await page.locator('body').innerText());await page.screenshot({path:path.join(out,'inspect-'+name+'.png'),fullPage:true});console.log(name);
  }
 }else if(scene==='landing'){
  await go('/');await record();await mark('hero');await pause(5);const stats=page.getByText('Live on Monad',{exact:false}).first();if(await stats.count())await focus(stats);else await page.evaluate(()=>window.scrollTo({top:850,behavior:'smooth'}));await pause(3);await mark('live-stats');await pause(10);
 }else if(scene==='vaults'){
  await go('/vaults');await page.getByRole('link',{name:'Bondrail Credit',exact:true}).waitFor({timeout:45000});await record();await mark('directory');await pause(5);await focus(page.getByRole('link',{name:'Bondrail Credit',exact:true}));await mark('disclosure');await pause(10);
 }else if(scene==='vault'||scene==='withdraw'){
  await go('/vaults/'+d.vault);await connect();await record();await mark('overview');await pause(3);await focus(page.getByRole('heading',{name:'Your deposit & withdrawal'}));
  if(scene==='withdraw')await click(page.getByRole('button',{name:'Withdraw',exact:true}).first());
  await click(page.locator('#vault-amount'));await page.locator('#vault-amount').pressSequentially(scene==='vault'?'1':'0.1',{delay:150});await pause(4);await mark('preview',page.locator('#vault-amount').locator('../..'));
  const warning=page.getByRole('checkbox');if(await warning.count()&&await warning.isVisible()){await click(warning);await pause(2);await mark('acknowledged-loss');}
  await pause(6);const submit=page.locator('#vault-submit');
  if(scene==='vault'&&(await submit.innerText()).includes('Approve')){await click(submit);await page.getByRole('status').filter({hasText:/Approval confirmed/}).waitFor({timeout:60000});await mark('approval-confirmed');await pause(4);}
  await click(submit);await page.getByRole('status').filter({hasText:scene==='vault'?/Deposit confirmed/:/Withdrawal confirmed/}).waitFor({timeout:60000});await mark('confirmed',page.getByRole('status').filter({hasText:/confirmed/}));await pause(7);
  await go('/portfolio');await mark('portfolio');await pause(10);
 }else if(scene==='oracle'){
  await go('/bonds/'+d.issuers.agent.bond);await record();await mark('summary');await pause(6);
  for(const [label,title] of [['timeline','How this bond works'],['claim-worth','What one claim is worth'],['risks','How you could lose money']]){const loc=page.getByRole('heading',{name:title,exact:true});await focus(loc);await mark(label,loc);await pause(7);}
  const glossary=page.getByRole('button',{name:'claim',exact:true}).first();await focus(glossary);await click(glossary);await mark('glossary',page.getByRole('dialog').first());await pause(6);
 }else if(scene==='pump'){
  await go('/bonds/'+d.issuers.pumplab.bond);await record();await mark('summary');await pause(4);const line=page.getByText(/if revenue falls below/i).first();await focus(line);await mark('trigger',line);await pause(12);
 }else if(scene==='credit'){
  await go('/accounts/'+d.issuers.pumplab.account);await record();await mark('account');await pause(4);await focus(page.getByRole('heading',{name:'Portable credit profile'}));await mark('profile');await pause(6);await focus(page.getByRole('heading',{name:'Attested',exact:true}));await mark('attestation');await pause(12);
 }else if(scene==='explorer'){
  const payment=JSON.parse(fs.readFileSync(path.join(out,'x402.json')));await page.goto('https://testnet.monadscan.com/tx/'+payment.hash,{waitUntil:'domcontentloaded',timeout:60000});await pause(20);await page.getByText(payment.hash,{exact:false}).first().waitFor({timeout:30000});const consent=page.getByRole('button',{name:'Got it!',exact:true});if(await consent.isVisible())await click(consent);await record();await mark('transaction');await pause(8);await click(page.getByRole('tab',{name:/Logs/}).first());await pause(4);await mark('logs-overview');const topic=page.getByText('0x22f68de1983d980ae3f96a85b07d13614cf2fc6966b3c4c197fe099ef00263ea',{exact:false}).first();await topic.evaluate(el=>window.scrollTo({top:el.getBoundingClientRect().top+scrollY-330,behavior:'smooth'}));await pause(1.2);await mark('settled-event',topic);await pause(15);
 }else throw Error('Unknown scene');
}catch(e){console.error(e.message);fs.writeFileSync(path.join(out,scene+'-error.txt'),await page.locator('body').innerText());await page.screenshot({path:path.join(out,scene+'-error.png')});process.exitCode=1;}
finally{
 if(start){await cdp.send('Page.stopScreencast');const duration=(Date.now()-start)/1000;save(path.join(dir,'capture.json'),{scene,url:page.url(),capturedAt:new Date(start).toISOString(),duration,marks,frames,errors});const file=path.join(out,'capture.json');const all=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{};all[scene]={dir,duration,marks,errors,success:!process.exitCode};save(file,all);console.log('RAW',dir);}
 await context.close();await browser.close();unlock();
}
