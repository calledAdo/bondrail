// Read-only landing -> markets capture. No wallet/key/RPC signer is loaded.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'output');
const browser = await chromium.launch({headless:true, executablePath:process.env.BONDRAIL_CHROME ?? path.join(os.homedir(),'Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing')});
const context = await browser.newContext({viewport:{width:1600,height:900},colorScheme:'dark',recordVideo:{dir:path.join(out,'raw'),size:{width:1600,height:900}}});
try {
 const page = await context.newPage(); const started = Date.now(); const marks=[];
 const mark = label => marks.push({label,at:(Date.now()-started)/1000});
 await page.goto('https://bondrail.vercel.app/',{waitUntil:'domcontentloaded'});
 await page.getByRole('heading',{level:1}).waitFor();
 await page.evaluate(()=>document.fonts.ready);
 await page.waitForTimeout(1200);mark('hero-ready');
 await page.screenshot({path:path.join(out,'landing-v2.png')});
 await page.waitForTimeout(6000);
 const cta=page.locator('main a[href="/markets"]').first();
 const box=await cta.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2,{steps:25});
 await page.waitForTimeout(500);mark('open-markets');await cta.click();
 await page.getByRole('tab',{name:'Trading',exact:true}).waitFor();
 await page.getByRole('tab',{name:'Trading',exact:true}).click();
 await page.getByText('PLAB-RC',{exact:false}).first().waitFor();
 mark('markets-ready');await page.waitForTimeout(4500);
 await page.getByRole('link').filter({hasText:'PumpLab'}).first().click();
 await page.getByRole('heading',{name:'PumpLab',exact:true}).waitFor();
 await page.locator('dt').filter({hasText:/^Repaid$/}).waitFor();
 mark('pumplab-ready');await page.waitForTimeout(3500);mark('end');
 await page.close(); const video=await page.video().path();
 fs.writeFileSync(path.join(out,'intro-capture.json'),JSON.stringify({video,marks,recordedAt:new Date().toISOString(),note:'Read-only actual landing, market navigation and bond page. No signing.'},null,2));
 console.log(JSON.stringify({video,marks}));
} finally {await context.close();await browser.close();}
