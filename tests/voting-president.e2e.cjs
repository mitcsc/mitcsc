/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
(async()=>{
 const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1280,height:900}});
 let authed=false, election=null, failCreate=true;const creates=[];const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const state={sessionId:'test-new',active:true,phase:'waiting',ballotVersion:'',currentCandidate:null,criteria:[],contextVisible:false,submittedCount:0,voter:{id:'admin',name:'President'},isAdmin:true,initialized:true,candidates:[],participants:[],pollIntervalMs:3000};
 await page.route('**/api/voting/**',async route=>{
  const endpoint=new URL(route.request().url()).pathname.split('/').at(-1);
  const data=route.request().method()==='POST'?route.request().postDataJSON():null;
  const reply=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  if(endpoint==='president') {
   if(data?.action==='login'){if(data.password!=='correct-password')return reply({error:'Incorrect password.'},401);authed=true;return reply({ok:true});}
   if(!authed)return reply({error:'Enter the president password.'},401);
   if(data?.action==='create'){creates.push(data);if(failCreate){failCreate=false;return reply({error:'Retry setup.'},503);}election={sessionId:'test-new',name:data.name,open:true};return reply({election});}
   if(data?.action==='end'){election.open=false;return reply({ok:true});}
   return reply({enabled:true,election,serviceAccount:'service@example.invalid'});
  }
  if(endpoint==='state')return reply(state);
  throw new Error(`Unexpected endpoint ${endpoint}`);
 });
 try {
  await page.goto(`${process.env.VOTING_TEST_URL}/vote/admin`);
  await page.getByLabel('Code').fill('wrong');await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Incorrect password'}).waitFor();
  await page.getByLabel('Code').fill('correct-password');await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByLabel('Name').fill('Exec election');await page.getByLabel('Code').fill('voters-only');await page.getByLabel('Results spreadsheet link').fill('https://docs.google.com/spreadsheets/d/test-sheet/edit');
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:'/private/tmp/voting-president-setup.png'});
  await page.getByRole('button',{name:'Create election'}).click();await page.getByRole('alert').filter({hasText:'Retry setup'}).waitFor();
  await page.getByRole('button',{name:'Create election'}).click();await page.getByRole('region',{name:'Ballot setup'}).waitFor();
  assert.deepEqual(creates[0],creates[1],'Retry retains creation ID and payload');
  await page.getByRole('button',{name:'End session',exact:true}).click();await page.getByRole('button',{name:'Create election'}).waitFor();
  assert.deepEqual(errors,[]);
  console.log('PASS: president login, setup form, mobile layout, retry identity, admin setup and end session.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
