import {execFileSync} from 'node:child_process';
import path from 'node:path';import fs from 'node:fs';
import {bundle} from '@remotion/bundler';
import {selectComposition,renderMedia,renderStill} from '@remotion/renderer';
const pkg=path.resolve(import.meta.dirname,'..');const out=path.resolve(pkg,'../output/update');
const browserExecutable='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const serveUrl=await bundle({entryPoint:path.join(pkg,'src/index.ts'),publicDir:path.join(pkg,'public'),outDir:path.join(out,'bundle'),onProgress:p=>{if(p===100)console.log('Bundle ready');}});
const options={serveUrl,browserExecutable,chromiumOptions:{gl:'angle'},timeoutInMilliseconds:60000};
const composition=await selectComposition({...options,id:'BondrailUpdate'});
if(composition.durationInFrames>5400)throw Error('Video exceeds three minutes');
if(process.argv.includes('--stills')){
 fs.mkdirSync(path.join(out,'review'),{recursive:true});
 for(const seconds of (process.env.REVIEW_TIMES??'3,9,39,43,49,58,72,79,97,104,107,115,121,128,132,135,157,167').split(',').map(Number)){await renderStill({...options,composition,frame:Math.round(seconds*30),output:path.join(out,'review',`frame-${seconds}.png`),imageFormat:'png'});console.log('Review',seconds);}
}else{
 let last=-1;
 await renderMedia({...options,composition,codec:'h264',audioCodec:'aac',audioBitrate:'192k',crf:18,pixelFormat:'yuv420p',concurrency:3,outputLocation:path.join(out,'bondrail-update-render.mp4'),onProgress:p=>{const n=Math.floor(p.progress*20);if(n>last){console.log(`Render ${n*5}%`);last=n;}}});
 execFileSync(process.env.BONDRAIL_VIDEO_PYTHON??'/private/tmp/bondrail-video-venv/bin/python',[path.join(pkg,'scripts/finish-audio.py')],{stdio:'inherit'});
 console.log('Rendered',composition.durationInFrames/30,'seconds');
}
