// Runs in a real isolated consumer directory. Captures stdout/stderr with timestamps.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';
import {out,save} from './wallet.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bondrail-update-builder-'));
const events=[];const start=performance.now();
function log(text){events.push({at:(performance.now()-start)/1000,text});process.stdout.write(text);save(path.join(out,'builder.json'),{directory:dir,events});}
async function run(command,args,label){log('$ '+label+'\n');await new Promise((resolve,reject)=>{const child=spawn(command,args,{cwd:dir,env:{PATH:process.env.PATH,HOME:os.homedir(),npm_config_cache:path.join(os.tmpdir(),'bondrail-video-npm-cache'),NO_COLOR:'1',FOUNDRY_DISABLE_NIGHTLY_WARNING:'1'}});child.stdout.on('data',s=>log(String(s)));child.stderr.on('data',s=>log(String(s)));child.on('error',reject);child.on('close',code=>{log(`[exit ${code}]\n`);code===0?resolve():reject(Error(label+' failed'));});});}
fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({name:'bondrail-builder-example',version:'1.0.0',private:true,type:'module'}));
await run('npm',['i','@bondrail/sdk','@bondrail/contracts','--no-audit','--no-fund','--maxsockets=2'],'npm i @bondrail/sdk @bondrail/contracts');
const source=`// SPDX-License-Identifier: MIT\npragma solidity 0.8.28;\nimport {BondrailEarner} from "@bondrail/contracts/src/BondrailEarner.sol";\ncontract MyBusiness is BondrailEarner {\n    constructor(address account) BondrailEarner(account) {}\n}\n`;
fs.mkdirSync(path.join(dir,'src'));fs.writeFileSync(path.join(dir,'src/MyBusiness.sol'),source);
log('$ cat src/MyBusiness.sol\n'+source);
fs.writeFileSync(path.join(dir,'foundry.toml'),'[profile.default]\nsrc = "src"\nlibs = ["node_modules"]\nsolc_version = "0.8.28"\nevm_version = "cancun"\noptimizer = true\nremappings = ["@bondrail/contracts/=node_modules/@bondrail/contracts/", "@openzeppelin/contracts/=node_modules/@openzeppelin/contracts/"]\n');
await run(path.join(os.homedir(),'.foundry/bin/forge'),['build'],'forge build');
const packages=JSON.parse(fs.readFileSync(path.join(dir,'package-lock.json'))).packages;
save(path.join(out,'builder.json'),{directory:dir,events,source,success:true,versions:Object.fromEntries(['@bondrail/sdk','@bondrail/contracts','@openzeppelin/contracts'].map(n=>[n,packages['node_modules/'+n].version])),configuration:fs.readFileSync(path.join(dir,'foundry.toml'),'utf8')});
fs.writeFileSync(path.join(out,'builder-terminal.txt'),events.map(e=>e.text).join(''));
