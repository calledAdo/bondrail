// Independent local-only pipeline for the Kuru episode: no capture, account or network tooling.
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import {bundle} from '@remotion/bundler';
import {selectComposition,renderMedia,renderStill} from '@remotion/renderer';
const pkg=path.resolve(import.meta.dirname,'..');
const root=path.resolve(pkg,'../../..');
const out=path.join(pkg,'../output/kuru');
const publicDir=path.join(pkg,'public/kuru');
const plan=JSON.parse(fs.readFileSync(path.join(pkg,'src/kuru/timeline.json'),'utf8'));
const python=process.env.BONDRAIL_VIDEO_PYTHON??'/private/tmp/bondrail-kuru-venv/bin/python';
fs.mkdirSync(publicDir,{recursive:true});
fs.mkdirSync(out,{recursive:true});
for(const name of ['Geist.woff2','GeistMono.woff2']) fs.copyFileSync(path.join(root,'brand/bondrail/fonts',name),path.join(publicDir,name));
for(const mode of ['light','dark']) fs.copyFileSync(path.join(root,`brand/bondrail/svg/bondrail-lockup-${mode}.svg`),path.join(publicDir,`logo-${mode}.svg`));
execFileSync(python,[path.join(pkg,'scripts/kuru-audio.py')],{stdio:'inherit'});
const browserExecutable=process.env.KURU_CHROME??process.env.CONCEPTS_CHROME??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if(!fs.existsSync(browserExecutable)) throw Error('Set KURU_CHROME to a locally installed Chromium executable.');
const serveUrl=await bundle({entryPoint:path.join(pkg,'src/index.ts'),publicDir:path.join(pkg,'public'),outDir:path.join(out,'bundle')});
const options={serveUrl,browserExecutable,chromiumOptions:{gl:'angle'},timeoutInMilliseconds:60000};
const selected=process.argv.includes('--square')?['KuruSquare']:process.argv.includes('--landscape')?['Kuru']:['Kuru','KuruSquare'];
for(const id of selected) {
  const composition=await selectComposition({...options,id});
  if(composition.durationInFrames!==plan.seconds*plan.fps)throw Error('Unexpected timeline');
  const suffix=id==='KuruSquare'?'-square':'';
  if(process.argv.includes('--stills')) {
    const review=path.join(out,`review${suffix}`);fs.mkdirSync(review,{recursive:true});
    const seconds=(process.env.KURU_REVIEW_TIMES?.split(',').map(Number))??plan.reviewSeconds;
    for(const second of seconds) {
      await renderStill({...options,composition,frame:Math.round(second*plan.fps),output:path.join(review,`frame-${second}.png`),imageFormat:'png'});
      console.log(`${id}: reviewed ${second}s`);
    }
  } else {
    let last=-1;
    await renderMedia({...options,composition,codec:'h264',audioCodec:'aac',audioBitrate:'192k',crf:18,pixelFormat:'yuv420p',concurrency:3,
      outputLocation:path.join(out,`bondrail-kuru${suffix}-render.mp4`),
      onProgress:p=>{const n=Math.floor(p.progress*20);if(n>last){console.log(`${id}: ${n*5}%`);last=n;}}});
    execFileSync(python,[path.join(pkg,'scripts/kuru-finish.py'),suffix],{stdio:'inherit'});
  }
}
