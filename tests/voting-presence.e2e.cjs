/* eslint-disable @typescript-eslint/no-require-imports */
/* Local mocked APIs only. */
const assert = require('node:assert/strict');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
(async()=>{
 const browser=await chromium.launch();
 try {
  const page=await browser.newPage();
  await page.clock.install();
  let session='old',kicked=false;
  const heartbeats=[];
  await page.route('**/api/voting/**',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname.endsWith('/join')){kicked=false;return route.fulfill({json:{ok:true}});}
   if(kicked)return route.fulfill({status:401,json:{error:'You were kicked from this session. You can join again.'}});
   if(url.searchParams.has('presence'))heartbeats.push({session,visibility:url.searchParams.get('presence')});
   return route.fulfill({json:{sessionId:session,active:true,phase:'waiting',criteria:[],voter:{id:session+'-voter',name:'Tester'},isAdmin:false,pollIntervalMs:500}});
  });
  await page.goto(`${process.env.VOTING_TEST_URL}/vote`);
  await page.getByRole('heading',{name:'You’re in.'}).waitFor();
  kicked=true;
  await page.clock.runFor(600);
  await page.getByRole('button',{name:'Join',exact:true}).waitFor();
  session='new';
  await page.getByPlaceholder('Name',{exact:true}).fill('Returning voter');
  await page.getByPlaceholder('Code',{exact:true}).fill('new-code');
  await page.getByRole('button',{name:'Join',exact:true}).click();
  await page.getByRole('heading',{name:'You’re in.'}).waitFor();
  assert.ok(heartbeats.some(h=>h.session==='new'),'Rejoin sends presence immediately, without waiting for old timer');
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
  await page.clock.runFor(1500);
  const before=heartbeats.length;
  await page.clock.runFor(21000);
  assert.ok(heartbeats.length>before,'Background lobby keeps a low-frequency heartbeat');
  assert.equal(heartbeats.at(-1).visibility,'hidden');
  console.log('PASS: kicked voter joining new session publishes fresh presence; hidden lobby renews Away presence');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
