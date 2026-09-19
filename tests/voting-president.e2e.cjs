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
   if(data?.action==='create'){creates.push(data);if(failCreate){failCreate=false;return reply({error:'Retry setup.'},503);}election={sessionId:'test-new',name:'Election 2026-09-18',open:true,joinCode:data.password};state={...state,candidates:data.candidates,criteria:data.criteria,voters:Array.from({length:30},(_,i)=>({id:`v-${i}`,name:`Voter ${i+1}`,removed:false,eligible:true}))};return reply({election});}
   if(new URL(route.request().url()).searchParams.get('view')==='results')return reply({sessionId:state.sessionId,ended:!election.open,spreadsheetUrl:'https://docs.google.com/spreadsheets/d/test/edit',voterCount:30,criteria:state.criteria,candidates:state.candidates.map(candidate=>({candidate,initialCount:0,ballots:[],stats:state.criteria.map(c=>({criterionId:c.id,count:0,initialAverage:null,average:null,median:null,min:null,max:null,distribution:[]}))}))});
   if(data?.action==='end'){election.open=false;return reply({ok:true});}
   return reply({enabled:true,election,serviceAccount:'service@example.invalid'});
  }
  if(endpoint==='admin' && data?.action==='admitVoters'){state.voters=state.voters.map(v=>data.voterIds.includes(v.id)?{...v,removed:false,eligible:true}:v);return reply(state);}
  if(endpoint==='admin' && data?.action==='removeVoters'){state.voters=state.voters.map(v=>({...v,removed:v.removed||data.voterIds.includes(v.id)}));return reply(state);}
  if(endpoint==='presence')return reply({presence:{}});
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
  assert.equal(await page.locator('.president-service-account').evaluate(el=>el.getBoundingClientRect().right<=innerWidth),true,'Account row stays inside mobile viewport');
  await page.getByRole('button',{name:'Continue to criteria'}).click();
  await page.getByRole('button',{name:'+ Add criteria',exact:true}).click();
  await page.getByPlaceholder('Criterion name').fill('Reliability');
  await page.getByLabel('Maximum', {exact:true}).fill('');
  assert.equal(await page.getByLabel('Maximum', {exact:true}).inputValue(),'');
  await page.getByLabel('Maximum', {exact:true}).pressSequentially('10');
  await page.getByLabel('Maximum', {exact:true}).blur();
  assert.equal(await page.getByLabel('Maximum', {exact:true}).inputValue(),'10');
  assert.equal(creates.length,0);
  await page.getByRole('button',{name:'Continue to candidates'}).click();
  await page.getByRole('button',{name:'+ Add candidate',exact:true}).click();
  await page.getByPlaceholder('Candidate name').fill('Alex');
  await page.getByPlaceholder('Platform (optional)').fill('More community events and open office hours.');
  await page.getByRole('button',{name:'Back',exact:true}).click();
  assert.equal(await page.getByPlaceholder('Criterion name').inputValue(),'Reliability');
  await page.getByRole('button',{name:'Back',exact:true}).click();
  assert.equal(await page.getByLabel('Session code',{exact:true}).inputValue(),'voters-only');
  await page.getByRole('button',{name:'Continue to criteria'}).click();
  await page.getByRole('button',{name:'Continue to candidates'}).click();
  assert.equal(await page.getByPlaceholder('Candidate name').inputValue(),'Alex');
  assert.equal(await page.getByPlaceholder('Platform (optional)').inputValue(),'More community events and open office hours.');
  await page.screenshot({path:'/private/tmp/voting-candidate-platform.png'});
  await page.getByRole('button',{name:'Open session'}).click();await page.getByRole('alert').filter({hasText:'Retry setup'}).waitFor();
  await page.getByRole('button',{name:'Open session'}).click();await page.getByRole('region',{name:'Round controls'}).waitFor();
  const toolbarStyles = await page.locator('.president-live-actions > button').evaluateAll(buttons => buttons.map(button => {
    const css = getComputedStyle(button);
    return [button.getBoundingClientRect().height, css.borderRadius, css.fontSize, css.lineHeight, css.padding];
  }));
  assert.deepEqual(toolbarStyles[0],toolbarStyles[1],'Live toolbar controls share dimensions and typography');
  await page.getByRole('button',{name:'Manage voters'}).hover();
  await page.getByRole('tooltip').waitFor();
  const tip = await page.getByRole('tooltip').boundingBox();
  const trigger = await page.getByRole('button',{name:'Manage voters'}).boundingBox();
  assert.ok(Math.abs(tip.x + tip.width/2 - trigger.x - trigger.width/2)<2,'Tooltip is centered on its control');
  assert.equal(tip.y - trigger.y - trigger.height,8,'Tooltip is anchored below its control');
  const controlsBefore = await page.getByRole('region',{name:'Round controls'}).boundingBox();
  await page.getByRole('button',{name:'Manage voters'}).click();
  await page.getByRole('region',{name:'Voters',exact:true}).waitFor();
  assert.deepEqual(await page.getByRole('region',{name:'Round controls'}).boundingBox(),controlsBefore,'Roster does not displace live controls');
  assert.equal(await page.locator('.voting-roster-list').evaluate(el=>el.scrollHeight>el.clientHeight),true,'Long roster scrolls internally');
  await page.getByRole('checkbox',{name:'Select Voter 1',exact:true}).check();
  await page.getByRole('checkbox',{name:'Select Voter 2',exact:true}).check();
  await page.getByRole('button',{name:'Kick (2)',exact:true}).click();
  await page.getByRole('button',{name:'Kick',exact:true}).waitFor();
  assert.equal(state.voters.filter(v=>v.removed).length,2);
  assert.equal(await page.getByRole('checkbox',{name:'Select Voter 1',exact:true}).count(),0);
  await page.getByRole('button',{name:'Show removed voters',exact:true}).click();
  await page.getByRole('checkbox',{name:'Select Voter 1',exact:true}).check();
  assert.equal(await page.getByRole('button',{name:'Kick (1)',exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:'Admit',exact:true}).click();
  await page.getByRole('button',{name:'Kick',exact:true}).waitFor();
  assert.equal(state.voters.filter(v=>v.removed).length,1);
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('button',{name:'Manage voters'}).getAttribute('aria-expanded'),'false');
  await page.screenshot({path:'/private/tmp/voting-live-mobile.png'});
  assert.deepEqual(creates[0],creates[1],'Retry retains creation ID and complete ballot payload');
  assert.equal(creates[0].name,undefined,'No user-entered session name');
  assert.equal(creates[0].candidates[0].name,'Alex');
  assert.equal(creates[0].candidates[0].context,'More community events and open office hours.');
  assert.equal(creates[0].criteria[0].label,'Reliability');
  assert.equal(await page.getByRole('button',{name:'Back to setup'}).count(),0);
  await page.reload();await page.getByRole('region',{name:'Round controls'}).waitFor();
  await page.getByRole('button',{name:'End session',exact:true}).click();await page.getByRole('heading',{name:'Results',exact:true}).waitFor();
  await page.reload();await page.getByRole('heading',{name:'Results',exact:true}).waitFor();
  await page.screenshot({path:'/private/tmp/voting-results-mobile.png'});
  await page.getByRole('button',{name:'New session',exact:true}).click();await page.getByRole('button',{name:'Continue to criteria'}).waitFor();
  assert.deepEqual(errors,[]);
  console.log('PASS: president login, three-step setup, draft preservation, creation retry, live refresh and end session.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
