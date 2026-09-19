/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
(async()=>{
 const browser=await chromium.launch();
 try {
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const criteria=Array.from({length:20},(_,i)=>({id:`c${i}`,label:`Criterion ${i+1}: leadership, community engagement and long-term responsibility`,min:1,max:5}));
  const results={sessionId:'results-test',ended:false,spreadsheetUrl:'https://docs.google.com/spreadsheets/d/chosen-sheet/edit',voterCount:2,criteria,candidates:['Alex','Morgan'].map((name,i)=>({candidate:{id:name,name,completed:true},initialCount:1,ballots:[{voterId:'v',voterName:'Taylor',initial:Object.fromEntries(criteria.map(c=>[c.id,1])),final:Object.fromEntries(criteria.map(c=>[c.id,i+3])),submittedAt:'2026-09-19T12:00:00Z'}],stats:criteria.map(c=>({criterionId:c.id,count:1,average:i+3,initialAverage:1,median:i+3,min:i+3,max:i+3,distribution:[{rating:i+3,count:1}]}))}))};
  let ended=false;
  await page.route('**/api/voting/**',route=>{
    const url=route.request().url();
    if(route.request().method()==='POST'){ended=true;return route.fulfill({json:{ok:true}});}
    return route.fulfill({json:url.includes('view=results')?results:url.includes('/state')?{active:true,initialized:true,isAdmin:true,sessionId:'results-test',phase:'locked',criteria,candidates:results.candidates.map(c=>c.candidate),participants:[],voters:[],currentCandidate:results.candidates[1].candidate}:{enabled:true,election:{sessionId:'results-test',open:!ended}}});
  });
  await page.goto(`${process.env.VOTING_TEST_URL}/vote/admin`);
  await page.getByRole('button',{name:'Continue to results',exact:false}).click();
  await page.getByRole('heading',{name:'Results',exact:true}).waitFor();
  assert.equal(await page.getByRole('link',{name:'Open spreadsheet'}).getAttribute('href'),results.spreadsheetUrl);
  const titleBox=await page.getByRole('heading',{name:'Scores by criterion',exact:true}).boundingBox();
  const filterBox=await page.getByLabel('Chart criterion').boundingBox();
  assert.equal(filterBox.height,36,'Criterion selector retains the standard control height');
  assert.ok(Math.abs(titleBox.y+titleBox.height/2-filterBox.y-filterBox.height/2)<1,'Heading and selector centers align');
  assert.equal(await page.locator('.results-summary-table tbody tr').count(),2);
  await page.getByLabel('Results candidate').selectOption('Alex');
  assert.equal(await page.locator('.results-summary-table').count(),0);
  assert.equal(await page.getByText('Voters joined',{exact:true}).count(),0);
  await page.getByRole('heading',{name:'Scores across criteria'}).waitFor();
  await page.getByRole('heading',{name:'Rating distribution'}).waitFor();
  assert.equal(await page.locator('.results-candidate-breakdown > .results-table tbody tr').count(),20);
  assert.equal(await page.locator('.results-candidate-breakdown > .results-table tbody tr').first().locator('td').nth(1).textContent(),'3');
  const before=await page.locator('.results-section-heading').first().boundingBox();
  await page.getByLabel('Results candidate').selectOption('Morgan');
  const after=await page.locator('.results-section-heading').first().boundingBox();
  assert.equal(before.y,after.y,'Candidate detail headings stay anchored');
  await page.getByLabel('Results candidate').selectOption('Alex');
  assert.equal(await page.locator('.results-history').getAttribute('open'),null);
  const bar=page.locator('.recharts-bar-rectangle').first();
  await bar.hover();
  assert.equal(await page.locator('.recharts-tooltip-cursor').count(),0,'No chart hover background');
  const focusOutline=await bar.evaluate(el=>{el.setAttribute('tabindex','0');el.focus();return getComputedStyle(el).outlineStyle;});
  assert.equal(focusOutline,'none','Chart descendants do not display stray focus outlines');

  await page.locator('.results-ballots summary').click();
  assert.equal(await page.locator('.results-ballots tbody td').first().textContent(),'3');
  await page.screenshot({path:'/private/tmp/results-polished-desktop.png'});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:'/private/tmp/results-polished-mobile.png'});
  await page.getByRole('button',{name:'End session',exact:true}).click();
  await page.reload();
  await page.getByRole('heading',{name:'Session details',exact:true}).waitFor();
  assert.equal(await page.getByRole('heading',{name:'Results',exact:true}).count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS: populated results, setup spreadsheet link, final scores, candidate filtering, stable headings, 20 long criteria, and mobile containment.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
