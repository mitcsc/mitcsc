/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
(async()=>{
 const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:"reduce"});
 await page.addInitScript(()=>{Object.defineProperty(navigator,"clipboard",{value:{writeText:async text=>{window.copiedAccount=text;}}});});
 let authed=false, election=null, failCreate=true;const creates=[];const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 let state={sessionId:'test-new',active:true,phase:'waiting',ballotVersion:'',currentCandidate:null,criteria:[],contextVisible:false,submittedCount:0,voter:{id:'admin',name:'President'},isAdmin:true,initialized:true,candidates:[],participants:[],pollIntervalMs:3000};
 await page.route('**/api/voting/**',async route=>{
  const endpoint=new URL(route.request().url()).pathname.split('/').at(-1);
  const data=route.request().method()==='POST'?route.request().postDataJSON():null;
  const reply=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  if(endpoint==='president') {
   if(data?.action==='login'){if(data.password!=='correct-password')return reply({error:'Incorrect password.'},401);authed=true;return reply({ok:true});}
   if(!authed)return reply({error:'Enter the president password.'},401);
   if(data?.action==='create'){creates.push(data);if(failCreate){failCreate=false;return reply({error:'Retry setup.'},503);}election={sessionId:'test-new',name:'Election 2026-09-18',open:true};state={...state,candidates:data.candidates,criteria:data.criteria};return reply({election});}
   if(data?.action==='end'){election.open=false;return reply({ok:true});}
   return reply({enabled:true,election,serviceAccount:'service@example.invalid'});
  }
  if(endpoint==='state')return reply(state);
  throw new Error(`Unexpected endpoint ${endpoint}`);
 });
 try {
  await page.goto(`${process.env.VOTING_TEST_URL}/vote/admin`);
  await page.getByLabel('Password').fill('wrong');await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Incorrect password'}).waitFor();
  await page.getByLabel('Password').fill('correct-password');await page.getByRole('button',{name:'Continue',exact:true}).click();
  assert.equal(await page.getByLabel('Session name').count(),0);await page.getByLabel('Session code', {exact:true}).fill('voters-only');await page.getByLabel('Link to spreadsheet').fill('https://docs.google.com/spreadsheets/d/test-sheet/edit');
  await page.getByRole('button',{name:'Copy service account',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.copiedAccount),'mitcsc@ultra-heading-489105-v4.iam.gserviceaccount.com');
  await page.getByRole('button',{name:'Service account copied'}).waitFor();
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:'/private/tmp/voting-president-setup.png'});
  await page.getByRole('button',{name:'Continue to ballot'}).click();
  await page.getByRole('region',{name:'Ballot setup'}).waitFor();
  assert.equal(creates.length,0,'Session is not opened before ballot setup');
  await page.getByRole('button',{name:'+ Add candidate',exact:true}).click();
  await page.getByPlaceholder('Candidate name').fill('Alex');
  await page.getByRole('button',{name:'+ Add criteria',exact:true}).click();
  await page.getByPlaceholder('Criterion name').fill('Reliability');
  await page.getByRole('button',{name:'Back',exact:true}).click();
  assert.equal(await page.getByLabel('Session code',{exact:true}).inputValue(),'voters-only');
  await page.getByRole('button',{name:'Continue to ballot'}).click();
  assert.equal(await page.getByPlaceholder('Candidate name').inputValue(),'Alex');
  assert.equal(await page.getByPlaceholder('Criterion name').inputValue(),'Reliability');
  await page.screenshot({path:'/private/tmp/voting-ballot-setup-mobile.png'});
  await page.getByRole('button',{name:'Open session'}).click();await page.getByRole('alert').filter({hasText:'Retry setup'}).waitFor();
  await page.getByRole('button',{name:'Open session'}).click();await page.getByRole('region',{name:'Round controls'}).waitFor();
  assert.deepEqual(creates[0],creates[1],'Retry retains creation ID and complete ballot payload');
  assert.equal(creates[0].name,undefined,'No user-entered session name');
  assert.equal(creates[0].candidates[0].name,'Alex');
  assert.equal(creates[0].criteria[0].label,'Reliability');
  assert.equal(await page.getByRole('button',{name:'Back to setup'}).count(),0);
  await page.reload();await page.getByRole('region',{name:'Round controls'}).waitFor();
  await page.getByRole('button',{name:'End session',exact:true}).click();await page.getByRole('button',{name:'Continue to ballot'}).waitFor();
  assert.deepEqual(errors,[]);
  console.log('PASS: president login, two-step setup, draft preservation, creation retry, live refresh and end session.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
