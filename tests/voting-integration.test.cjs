/* eslint-disable @typescript-eslint/no-require-imports */
/* Run: node --test tests/voting-integration.test.cjs */
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, filename);
const { GoogleAuth } = require('google-auth-library');
GoogleAuth.prototype.getClient = async () => ({ getAccessToken: async () => ({ token: 'test-token' }) });
process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'test@example.invalid';
process.env.GOOGLE_PRIVATE_KEY = 'test-only';
process.env.VOTING_COOKIE_SECRET = 'test-secret-that-is-longer-than-thirty-two-characters';
process.env.VOTING_SETTINGS_SHEET_ID = 'settings-test';
const books = new Map();
const requests = [];
let failNextAppend = false;
let quota;
let beforeFixedWrite;
function rangeParts(range) {
  const [tab, a1] = range.split('!');
  const start = (a1 || 'A1').split(':')[0];
  const letters = start.match(/[A-Z]+/)[0];
  const column = [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
  const row = Number(start.match(/\d+/)?.[0] || 1) - 1;
  return { tab: tab.replace(/^'|'$/g, ''), row, column };
}
function getRows(book, range) {
  const {tab, row, column} = rangeParts(range);
  const match = range.split(':')[1]?.match(/\d+/);
  return (book.get(tab) || []).slice(row, match ? Number(match[0]) : undefined).map(r => (r || []).slice(column));
}
function putRows(book, range, values) {
  const {tab, row, column} = rangeParts(range);
  const rows = book.get(tab);
  if (!rows) throw new Error(`Unknown tab ${tab}`);
  values.forEach((r, index) => {
    rows[row + index] ||= [];
    r.forEach((value, cell) => { rows[row + index][column + cell] = value; });
  });
}
global.fetch = async (input, options = {}) => {
  const url = new URL(String(input));
  assert.equal(url.hostname, 'sheets.googleapis.com', 'Tests must never call live Google');
  const match = url.pathname.match(/^\/v4\/spreadsheets\/([^/:]+)(.*)$/);
  const [, id, suffix] = match;
  const book = books.get(id);
  assert.ok(book, `Unknown mock book ${id}`);
  if (quota) {
    const kind = (options.method || 'GET') === 'GET' ? 'reads' : 'writes';
    if (++quota[kind] > 60) return new Response('{}', {status:429});
  }
  const data = options.body ? JSON.parse(options.body) : undefined;
  requests.push({ id, suffix, method: options.method, data });
  const json = value => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
  if (!suffix) return json({ sheets: [...book.keys()].map((title, sheetId) => ({ properties: { title, sheetId } })) });
  if (suffix === '/values:batchGet') return json({ valueRanges: url.searchParams.getAll('ranges').map(range => ({values: getRows(book, range)})) });
  if (suffix === '/values:batchUpdate') {
    if (beforeFixedWrite && data.data.some(entry=>entry.range.startsWith("'Responses'!"))) await beforeFixedWrite();
    if (failNextAppend) { failNextAppend = false; return new Response('{}', {status:429}); }
    for (const entry of data.data) putRows(book, entry.range, entry.values);
    return json({});
  }
  if (suffix === ':batchUpdate') {
    for (const request of data.requests) if (request.addSheet) {
      const title = request.addSheet.properties.title;
      assert.ok(!book.has(title), 'Duplicate tab creation');
      book.set(title, []);
    }
    return json({ replies: data.requests.map(() => ({})) });
  }
  if (suffix.endsWith(':append')) {
    if (failNextAppend) { failNextAppend = false; return new Response('{}', {status:429}); }
    const range = decodeURIComponent(suffix.slice('/values/'.length, -':append'.length));
    book.get(rangeParts(range).tab).push(...data.values);
    return json({updates:{updatedRows:data.values.length}});
  }
  if (suffix.startsWith('/values/')) return json({values:getRows(book,decodeURIComponent(suffix.slice(8)))});
  throw new Error(`Unimplemented mock ${suffix}`);
};
const service = require('../src/lib/voting/service.ts');
const {invalidate} = require('../src/lib/voting/sheets.ts');
const candidates = [
  {id:'alex',name:'Alex',context:'Private context',order:0,completed:false},
  {id:'sam',name:'Sam',context:'Other context',order:1,completed:false},
  {id:'lee',name:'Lee',context:'',order:2,completed:false},
];
const criteria = [{id:'reliability',label:'Reliability',description:'Keeps commitments',min:1,max:5,required:true}];
const config = {sessionId:'fall-2026',password:'voter-secret',settingsSheetId:'settings-test',sheetId:'election-test'};
const identity = role => ({id:role,name:role,role,sessionId:config.sessionId,sheetId:config.sheetId,exp:Date.now()+100000});
const admin = identity('admin'), voter = identity('voter');
before(() => {
  books.set(config.sheetId, new Map([['Personal notes', [['Keep this untouched']]]]));
  books.set('settings-test', new Map([['Session History', [['session_id','election_sheet_id','claim_id','voter_id','voter_name','claimed_at'],[config.sessionId,config.sheetId,'a','admin','President',''],[config.sessionId,config.sheetId,'b','voter','Voter One',''],[config.sessionId,config.sheetId,'c','late-voter','Voter Two',''],['other',config.sheetId,'d','other','Other session','']]],['Settings', [['key','value'], ['session_id', config.sessionId], ['session_password',config.password], ['voting_sheet_url', `https://docs.google.com/spreadsheets/d/${config.sheetId}/edit`]]]]));
});
test('full election: safe setup, local ballot flow, immutable criteria, submission retry, next candidate', async () => {
  const initial = await service.getState(config, admin);
  assert.equal(initial.initialized, false);
  let state = await service.adminAction(config, admin, {action:'initialize'});
  assert.equal(state.initialized, true);
  assert.equal(state.ballotVersion, '');
  assert.deepEqual(books.get(config.sheetId).get('Personal notes'), [['Keep this untouched']]);
  state = await service.adminAction(config, admin, {action:'saveSetup', candidates, criteria});
  assert.equal(state.candidates.length, 3);
  await service.adminAction(config, admin, {action:'setPhase',phase:'waiting',candidateId:'alex'});
  state = await service.adminAction(config, admin, {action:'setPhase',phase:'initial',candidateId:'alex'});
  const version = state.ballotVersion;
  assert.ok(version);
  const privateState = await service.getState(config, voter);
  assert.equal(privateState.currentCandidate.context, '');
  assert.equal(privateState.candidates, undefined);
  assert.equal(privateState.spreadsheetUrl, undefined);
  assert.equal(privateState.participants,undefined);
  assert.deepEqual((await service.getState(config,admin)).participants.map(v=>v.name),['Voter One','Voter Two']);
  assert.ok(!JSON.stringify(privateState).includes('secret'));
  await assert.rejects(service.adminAction(config, admin, {action:'saveSetup',candidates,criteria}), {status:409});
  const ballot = {submissionId:'ballot-001',sessionId:config.sessionId,candidateId:'alex',ballotVersion:version,initialRatings:{reliability:2},finalRatings:{reliability:4}};
  await assert.rejects(service.submit(config, admin, ballot), {status:403});
  await assert.rejects(service.submit(config, voter, ballot), {status:409});
  const initialReceipt = {sessionId:config.sessionId,candidateId:'alex',ballotVersion:version,ratings:{reliability:2}};
  await service.submitInitial(config,voter,initialReceipt);
  await service.submitInitial(config,voter,initialReceipt);
  assert.equal(books.get(config.sheetId).get('Initial submissions').length,2,'Initial receipts are idempotent');
  assert.equal((await service.getState(config,admin)).participants.find(v=>v.id===voter.id).initialSubmitted,true);
  await service.adminAction(config, admin, {action:'setPhase',phase:'deliberation'});
  await service.submitInitial(config,voter,initialReceipt);
  await assert.rejects(service.submitInitial(config,{...voter,id:'late-voter'},initialReceipt),{status:409});
  assert.equal((await service.getState(config,admin)).participants.filter(v=>v.initialSubmitted).length,1,'Only initial submitters enter the final waiting list');

  await service.adminAction(config, admin, {action:'setContext',visible:true});
  assert.equal((await service.getState(config,voter)).currentCandidate.context, 'Private context');
  // External Sheet edits must not silently change an open ballot.
  books.get(config.sheetId).get('Criteria')[1][4] = 10;
  invalidate(config.sheetId);
  assert.equal((await service.getState(config,voter)).criteria[0].max, 5);
  await service.adminAction(config, admin, {action:'setPhase',phase:'revision'});

  await assert.rejects(service.submit(config,voter,{...ballot,ballotVersion:'stale'}), {status:409});
  await assert.rejects(service.submit(config,voter,{...ballot,finalRatings:{reliability:9}}));
  failNextAppend = true;
  assert.equal((await service.submit(config,voter,ballot)).ok,true,'429 writes retry automatically');
  assert.equal((await service.submit(config,voter,ballot)).ok,true);
  assert.equal((await service.submit(config,voter,ballot)).ok,true);
  assert.equal(books.get(config.sheetId).get('Responses').length,2,'Retries must not append duplicate ratings');
  assert.equal((await service.getState(config,admin)).submittedCount,1);
  assert.deepEqual((await service.getState(config,admin)).participants.map(v=>[v.id,v.submitted]),[['voter',true],['late-voter',false]]);
  const response = books.get(config.sheetId).get('Responses')[1];
  assert.equal(response[9],2);
  assert.equal(response[10],4);
  assert.equal(response[4],voter.id);
  await service.adminAction(config,admin,{action:'initialize'});
  assert.equal(books.get(config.sheetId).get('Responses').length,2,'Setup rerun preserves ballots');
  await service.adminAction(config,admin,{action:'setPhase',phase:'locked'});
  assert.equal((await service.submit(config,voter,ballot)).ok,true,'Lost acknowledgements can retry after lock');
  state = await service.getState(config,admin);
  assert.equal(state.candidates.find(c=>c.id==='alex').completed,true);
  assert.equal(state.candidates[0].id,'alex');
  await service.adminAction(config,admin,{action:'setPhase',phase:'waiting',candidateId:'sam'});
  assert.equal((await service.getState(config,voter)).votingStarted,true,'Voter waiting screen stays in the started session without reading ballot history');
  state = await service.adminAction(config,admin,{action:'setPhase',phase:'initial',candidateId:'sam'});
  assert.equal(state.criteria[0].max,5,'The session keeps its frozen rubric for later candidates');
  const historical = state.candidateStates.find(c=>c.candidateId==='alex');
  assert.equal(historical.phase,'locked');
  assert.equal(historical.submittedCount,1,'Historical candidate count is independent of the live round');
  assert.equal(historical.ballotVersion,version);
  assert.equal(historical.participants.find(v=>v.id===voter.id).initialSubmitted,true);
  assert.notEqual(state.ballotVersion,version);
  assert.equal(state.contextVisible,false);
  assert.equal(state.submittedCount,0);
  await service.adminAction(config,admin,{action:'setPhase',phase:'locked'});
  state = await service.adminAction(config,admin,{action:'setPhase',phase:'final',candidateId:'alex'});
  assert.equal(state.ballotVersion,version,'Reopening restores original local-storage key');
  assert.equal(state.criteria[0].max,5,'Reopening retains original rubric');
  const lateVoter={...voter,id:'late-voter'};
  await service.submit(config,lateVoter,{...ballot,submissionId:'late-ballot'});
  assert.equal((await service.getState(config,admin)).submittedCount,2);
  assert.equal(books.get(config.sheetId).get('Responses').filter(row=>row?.[0]).length,3);

});
test('settings privacy, password rotation, session closure and session identity', async () => {
  const read = await service.settings();
  assert.equal(read.sheetId,config.sheetId);
  assert.equal(service.authorize(voter,{...config,password:'changed'}).id,voter.id);
  assert.throws(()=>service.authorize(voter,{...config,sessionId:'new-session'}),{status:401});
  assert.throws(()=>service.authorize(voter,{...config,sheetId:'another-sheet'}),{status:401});
  assert.throws(()=>service.authorize(voter,config,true),{status:403});
  assert.equal((await service.getState({...config,password:''},voter)).active,false);
});
test('malformed reserved tab prevents setup without overwriting existing data', async () => {
  const sheetId='malformed-test';
  books.set(sheetId,new Map([['Candidates',[['human notes'],['Preserve me']]]]));
  await assert.rejects(service.adminAction({...config,sheetId}, {...admin,sheetId}, {action:'initialize'}),{status:409});
  assert.deepEqual([...books.get(sheetId).keys()],['Candidates']);
  assert.deepEqual(books.get(sheetId).get('Candidates'),[['human notes'],['Preserve me']]);
});

test('30 voters: fixed rows, bounded reads, polling and retries stay within a simulated minute quota', async () => {
  const cfg = {...config, sheetId:'load-election', sessionId:'load-session'};
  const owner = {...admin, sheetId:cfg.sheetId, sessionId:cfg.sessionId};
  const voters = Array.from({length:30}, (_,i)=>({...voter,id:`load-${i}`,name:`Voter ${i+1}`,voterSlot:i,sheetId:cfg.sheetId,sessionId:cfg.sessionId}));
  books.set(cfg.sheetId,new Map());
  const history=books.get(cfg.settingsSheetId).get('Session History');
  history.push([cfg.sessionId,cfg.sheetId,'load-admin',owner.id,owner.name,''],...voters.map(v=>[cfg.sessionId,cfg.sheetId,v.id,v.id,v.name,'']));
  invalidate(cfg.settingsSheetId);
  await service.adminAction(cfg,owner,{action:'initialize'});
  await service.adminAction(cfg,owner,{action:'saveSetup',candidates,criteria});
  let state=await service.adminAction(cfg,owner,{action:'setPhase',phase:'initial',candidateId:'alex'});
  const version=state.ballotVersion;
  const start=requests.length;
  quota={reads:0,writes:0};
  // Exercise the actual service and Sheets HTTP adapter, including cache misses.
  await Promise.all(voters.map(v=>service.getState(cfg,v)));
  await Promise.all(voters.map(v=>service.submitInitial(cfg,v,{sessionId:cfg.sessionId,candidateId:'alex',ballotVersion:version,ratings:{reliability:3}})));
  await Promise.all(voters.map(v=>service.getState(cfg,v)));
  state=await service.getState(cfg,owner);
  assert.equal(state.participants.filter(v=>v.initialSubmitted).length,30);
  const initialCalls=requests.slice(start);
  const initialReads=initialCalls.filter(r=>r.method==='GET').length;
  const initialWrites=initialCalls.filter(r=>r.method!=='GET').length;
  assert.ok(initialReads<=40,`Initial burst used ${initialReads} reads`);
  assert.equal(initialWrites,30);
  const lastPollStart=requests.length;
  await Promise.all(voters.map(v=>service.getState(cfg,v)));
  assert.equal(requests.length,lastPollStart,'Warm voter polling does not read Sheets per voter');
  quota=undefined;
  await service.adminAction(cfg,owner,{action:'setPhase',phase:'deliberation'});
  await service.adminAction(cfg,owner,{action:'setPhase',phase:'revision'});
  const finalStart=requests.length;
  quota={reads:0,writes:0};
  const payload=v=>({sessionId:cfg.sessionId,candidateId:'alex',ballotVersion:version,submissionId:`submission-${v.id}`,initialRatings:{reliability:3},finalRatings:{reliability:4}});
  await Promise.all(voters.map(v=>service.submit(cfg,v,payload(v))));
  state=await service.getState(cfg,owner);
  assert.equal(state.submittedCount,30);
  const finalCalls=requests.slice(finalStart);
  const finalReads=finalCalls.filter(r=>r.method==='GET').length;
  assert.ok(finalReads<=40,`Final burst used ${finalReads} reads`);
  assert.equal(finalCalls.filter(r=>r.method!=='GET').length,30);
  quota=undefined;
  await service.adminAction(cfg,owner,{action:'setPhase',phase:'locked'});
  await Promise.all(voters.map(v=>service.submit(cfg,v,payload(v))));
  assert.equal(books.get(cfg.sheetId).get('Responses').filter(r=>r?.[0]).length,31,'Retries after closing never add rows');
  await assert.rejects(service.submit(cfg,{...voters[0],id:'unsubmitted',voterSlot:30},payload(voters[0])),{status:409});
  console.log(`30-voter measured bursts: initial ${initialReads} reads / ${initialWrites} writes; final ${finalReads} reads / 30 writes (separate quota windows, one warm server).`);
});

test('separate server instances retry the same ballot into one fixed row',async()=>{
  const cfg={...config,sheetId:'load-election',sessionId:'load-session'};
  const owner={...admin,sheetId:cfg.sheetId,sessionId:cfg.sessionId};
  const state=await service.adminAction(cfg,owner,{action:'setPhase',phase:'initial',candidateId:'sam'});
  await service.adminAction(cfg,owner,{action:'setPhase',phase:'revision'});
  const who={...voter,id:'load-0',voterSlot:0,sheetId:cfg.sheetId,sessionId:cfg.sessionId};
  const payload={sessionId:cfg.sessionId,candidateId:'sam',ballotVersion:state.ballotVersion,submissionId:'parallel-retry',initialRatings:{reliability:3},finalRatings:{reliability:4}};
  delete require.cache[require.resolve('../src/lib/voting/sheets.ts')];
  delete require.cache[require.resolve('../src/lib/voting/service.ts')];
  const other=require('../src/lib/voting/service.ts');
  await Promise.all([service.submit(cfg,who,payload),other.submit(cfg,who,payload)]);
  const matches=books.get(cfg.sheetId).get('Responses').filter(r=>r?.[2]==='sam'&&r[4]===who.id);
  assert.equal(matches.length,1);
});

test('close rejects new admissions but lets an admitted write finish on another instance',async()=>{
  const cfg={...config,sheetId:'load-election',sessionId:'load-session'};
  const owner={...admin,sheetId:cfg.sheetId,sessionId:cfg.sessionId};
  const other=require('../src/lib/voting/service.ts');
  const state=await other.getState(cfg,owner);
  const payload={sessionId:cfg.sessionId,candidateId:'sam',ballotVersion:state.ballotVersion,submissionId:'during-close',initialRatings:{reliability:3},finalRatings:{reliability:4}};
  let release, arrived;
  const gate=new Promise(resolve=>{release=resolve;});
  const writing=new Promise(resolve=>{arrived=resolve;});
  beforeFixedWrite=async()=>{beforeFixedWrite=undefined;arrived();await gate;};
  const who={...voter,id:'load-1',voterSlot:1,sheetId:cfg.sheetId,sessionId:cfg.sessionId};
  const pending=service.submit(cfg,who,payload);
  await writing;
  await other.adminAction(cfg,owner,{action:'setPhase',phase:'locked'});
  release();
  assert.equal((await pending).ok,true);
  const closed=await other.getState(cfg,owner);
  assert.equal(closed.phase,'locked');
  await assert.rejects(other.submit(cfg,{...who,id:'load-2',voterSlot:2},payload),{status:409});
  assert.equal((await other.submit(cfg,who,payload)).ok,true,'A lost acknowledgement can be recovered after closing');
});

test('one minute of 30-voter polling plus an initial burst stays under the mock quota on one warm instance',async()=>{
  const cfg={...config,sheetId:'minute-election',sessionId:'minute-session'};
  const owner={...admin,sheetId:cfg.sheetId,sessionId:cfg.sessionId};
  const voters=Array.from({length:30},(_,i)=>({...voter,id:`minute-${i}`,voterSlot:i,sheetId:cfg.sheetId,sessionId:cfg.sessionId}));
  books.set(cfg.sheetId,new Map());
  books.get(cfg.settingsSheetId).get('Session History').push([cfg.sessionId,cfg.sheetId,'minute-admin',owner.id,owner.name,''],...voters.map(v=>[cfg.sessionId,cfg.sheetId,v.id,v.id,v.name,'']));
  invalidate(cfg.settingsSheetId);
  await service.adminAction(cfg,owner,{action:'initialize'});
  await service.adminAction(cfg,owner,{action:'saveSetup',candidates,criteria});
  const state=await service.adminAction(cfg,owner,{action:'setPhase',phase:'initial',candidateId:'alex'});
  await service.getState(cfg,voters[0]);
  const now=Date.now;
  let elapsed=0;
  const base=now();
  Date.now=()=>base+elapsed;
  quota={reads:0,writes:0};
  try {
    await Promise.all(voters.map(v=>service.submitInitial(cfg,v,{sessionId:cfg.sessionId,candidateId:'alex',ballotVersion:state.ballotVersion,ratings:{reliability:3}})));
    for(elapsed=4000;elapsed<60000;elapsed+=4000){
      await Promise.all(voters.map(async v=>{await service.settings();return service.getState(cfg,v);}));
      if(elapsed%8000===0) await service.getState(cfg,owner);
    }
    assert.ok(quota.reads<=60,JSON.stringify(quota));
    assert.equal(quota.writes,30);
    console.log(`One simulated minute: ${quota.reads} reads / ${quota.writes} writes, 30 voters + admin polling, warm single instance.`);
  } finally {Date.now=now;quota=undefined;invalidate(cfg.sheetId);invalidate(cfg.settingsSheetId);}
});

test('legacy elections retain append storage without moving existing ballots',async()=>{
  const cfg={...config,sheetId:'legacy-election',sessionId:'legacy-session'};
  const owner={...admin,sheetId:cfg.sheetId,sessionId:cfg.sessionId};
  const who={...voter,sheetId:cfg.sheetId,sessionId:cfg.sessionId};
  books.set(cfg.sheetId,new Map());
  await service.adminAction(cfg,owner,{action:'initialize'});
  await service.adminAction(cfg,owner,{action:'saveSetup',candidates,criteria});
  const state=await service.adminAction(cfg,owner,{action:'setPhase',phase:'initial',candidateId:'alex'});
  books.get(cfg.sheetId).set('Session',books.get(cfg.sheetId).get('Session').filter(row=>row[0]!=='row_layout_json'));
  invalidate(cfg.sheetId);
  await service.submitInitial(cfg,who,{sessionId:cfg.sessionId,candidateId:'alex',ballotVersion:state.ballotVersion,ratings:{reliability:3}});
  await service.adminAction(cfg,owner,{action:'setPhase',phase:'revision'});
  const payload={sessionId:cfg.sessionId,candidateId:'alex',ballotVersion:state.ballotVersion,submissionId:'legacy-ballot',initialRatings:{reliability:3},finalRatings:{reliability:4}};
  const start=requests.length;
  await service.submit(cfg,who,payload);
  await service.submit(cfg,who,payload);
  assert.equal(requests.slice(start).filter(r=>r.suffix.endsWith(':append')).length,1);
  assert.equal(books.get(cfg.sheetId).get('Responses')[1][0],'legacy-ballot');
  assert.equal(books.get(cfg.sheetId).get('Session').some(row=>row[0]==='row_layout_json'),false);
});

test('combined settings/history reads share cache while honoring each consumer freshness',async()=>{
  const {readControlSheet}=require('../src/lib/voting/sheets.ts');
  const id='control-cache-test';
  books.set(id,new Map([['Settings',[['session_password','before']]],['Session History',[['header']]]]));
  const realNow=Date.now;const base=realNow();let elapsed=0;Date.now=()=>base+elapsed;
  try {
    const start=requests.length;
    await readControlSheet(id);
    await readControlSheet(id,false,5000);
    assert.equal(requests.slice(start).filter(r=>r.suffix==='/values:batchGet').length,1);
    books.get(id).get('Settings')[0][1]='after';
    elapsed=6000;
    assert.equal((await readControlSheet(id)).settings[0][1],'before','Settings allow a 30-second cached value');
    assert.equal((await readControlSheet(id,false,5000)).settings[0][1],'after','Roster forces a refresh after five seconds');
    const refreshed=requests.length;
    await readControlSheet(id);
    assert.equal(requests.length,refreshed,'Settings reuse the roster refresh');
    elapsed=35000;await readControlSheet(id);
    assert.equal(requests.length,refreshed);
    elapsed=37000;await readControlSheet(id);
    assert.equal(requests.length,refreshed+1);
    books.set('control-no-history',new Map([['Settings',[['session_password','value']]]]));
    assert.equal((await readControlSheet('control-no-history')).history,undefined,'First-use settings do not require an existing history tab');
  }finally{Date.now=realNow;}
});


test('admin refresh sees external submissions immediately while voter stage reads stay cached',async()=>{
  const cfg={...config,sheetId:'load-election',sessionId:'load-session'};
  const owner={...admin,sheetId:cfg.sheetId,sessionId:cfg.sessionId};
  const who={...voter,id:'load-29',voterSlot:29,sheetId:cfg.sheetId,sessionId:cfg.sessionId};
  const previous=await service.getState(cfg,owner);
  const rows=books.get(cfg.sheetId).get('Responses');
  const original=rows.map(row=>row?.slice());
  try {
    rows.push(['external-confirmation',cfg.sessionId,previous.currentCandidate.id,'',who.id,who.name,previous.ballotVersion,'reliability','Reliability','3','4','']);
    const next=await service.getState(cfg,owner);
    assert.equal(next.submittedCount,previous.submittedCount+1,'Admin counts must not reuse the previous polling response');
    await service.getState(cfg,who);
    const start=requests.length;
    await service.getState(cfg,who);
    assert.equal(requests.length,start,'Voter polls still reuse cached stage reads');
  }finally{books.get(cfg.sheetId).set('Responses',original);invalidate(cfg.sheetId);}
});

test('running elections reuse frozen ballot and roster data beyond the old metadata TTL',async()=>{
  const cfg={...config,sheetId:'load-election',sessionId:'load-session'};
  const owner={...admin,sheetId:cfg.sheetId,sessionId:cfg.sessionId};
  const who={...voter,id:'load-0',voterSlot:0,sheetId:cfg.sheetId,sessionId:cfg.sessionId};
  const before=await service.getState(cfg,owner);
  await service.getState(cfg,who);
  const start=requests.length;
  const now=Date.now;const base=now();Date.now=()=>base+65_000;
  const history=books.get(cfg.settingsSheetId).get('Session History');
  history.push([cfg.sessionId,cfg.sheetId,'late-claim','unexpected-late-voter','Late Voter','']);
  try{
    const next=await service.getState(cfg,who);
    assert.deepEqual(next.criteria,before.criteria);
    const adminState=await service.getState(cfg,owner);
    assert.deepEqual(adminState.participants.map(v=>v.id),before.participants.map(v=>v.id),'Roster remains fixed after the election starts');
    const calls=requests.slice(start);
    assert.equal(calls.length,2,'Only voter stage and fresh admin snapshot are read');
    assert.ok(calls.every(r=>r.id===cfg.sheetId&&r.suffix==='/values:batchGet'),'No settings, roster, or metadata read');
  }finally{Date.now=now;history.pop();invalidate(cfg.sheetId);}
});

test('settings changes are picked up within two minutes without per-request Sheets reads',async()=>{
  const now=Date.now;const base=now();let elapsed=0;Date.now=()=>base+elapsed;
  const rows=books.get(config.settingsSheetId).get('Settings');
  const password=rows.find(row=>row[0]==='session_password');const original=password[1];
  invalidate(config.settingsSheetId);
  try{
    await service.settings();const start=requests.length;password[1]='';
    elapsed=119_000;assert.equal((await service.settings()).password,original);
    assert.equal(requests.length,start);
    elapsed=120_001;assert.equal((await service.settings()).password,'');
    assert.equal(requests.length,start+1);
  }finally{Date.now=now;password[1]=original;invalidate(config.settingsSheetId);}
});

test('quota cooldown suppresses additional Google requests and recovers after its deadline',async()=>{
  const adapter=require('../src/lib/voting/sheets.ts');
  const originalFetch=global.fetch;let attempts=0;let limited=true;
  const now=Date.now;const base=now();let elapsed=0;Date.now=()=>base+elapsed;
  global.fetch=async(...args)=>{attempts++;return limited?new Response('{}',{status:429}):originalFetch(...args);};
  try{
    await assert.rejects(adapter.readRanges(config.sheetId,["'Session'!A1:B20"],true),{status:429});
    await assert.rejects(adapter.readRanges(config.sheetId,["'Session'!A1:B20"],true),{status:429});
    assert.equal(attempts,1,'Cooldown should not send another Sheets read');
    limited=false;elapsed=1001;
    await adapter.readRanges(config.sheetId,["'Session'!A1:B20"],true);
    assert.equal(attempts,2);
  }finally{Date.now=now;global.fetch=originalFetch;}
});

// Demand measurement only: multiple-instance cases may exceed Google quota.
test('capacity diagnostics: staggered voters across independent server caches',async()=>{
  for (const mode of ['warm','discussion','cold']) for (const count of [1,3]) {
    const cfg={...config,sheetId:`diagnostic-${mode}-${count}`,sessionId:`diagnostic-${mode}-${count}`};
    const owner={...admin,sheetId:cfg.sheetId,sessionId:cfg.sessionId};
    const voters=Array.from({length:30},(_,i)=>({...voter,id:`diag-${i}`,voterSlot:i,sheetId:cfg.sheetId,sessionId:cfg.sessionId}));
    books.set(cfg.sheetId,new Map());
    books.get(cfg.settingsSheetId).set('Settings',[['key','value'],['session_id',cfg.sessionId],['session_password',cfg.password],['voting_sheet_url',`https://docs.google.com/spreadsheets/d/${cfg.sheetId}/edit`]]);
    books.get(cfg.settingsSheetId).get('Session History').push([cfg.sessionId,cfg.sheetId,'diag-admin',owner.id,owner.name,''],...voters.map(v=>[cfg.sessionId,cfg.sheetId,v.id,v.id,v.name,'']));
    invalidate(cfg.settingsSheetId);
    await service.adminAction(cfg,owner,{action:'initialize'});
    await service.adminAction(cfg,owner,{action:'saveSetup',candidates,criteria});
    const state=await service.adminAction(cfg,owner,{action:'setPhase',phase:'initial',candidateId:'alex'});
    if(mode==='discussion') await service.adminAction(cfg,owner,{action:'setPhase',phase:'deliberation'});
    const instances=[];
    for(let i=0;i<count;i++){
      for(const key of Object.keys(require.cache)) if(key.includes('/src/lib/voting/')) delete require.cache[key];
      const instance=require('../src/lib/voting/service.ts');
      if(mode!=='cold'){await instance.settings();await instance.getState(cfg,voters[i]);}instances.push(instance);
    }
    if(mode!=='cold') await instances[0].getState(cfg,owner);
    const realNow=Date.now;const base=realNow();let elapsed=0;Date.now=()=>base+elapsed;
    const events=[];
    voters.forEach((v,i)=>{
      const instance=instances[i%count];
      for(let t=i*127;t<60000;t+=4000)events.push({t,run:async()=>{await instance.settings();await instance.getState(cfg,v);}});
      if(mode!=='discussion') events.push({t:i*1900+500,run:async()=>{await instance.settings();await instance.submitInitial(cfg,v,{sessionId:cfg.sessionId,candidateId:'alex',ballotVersion:state.ballotVersion,ratings:{reliability:3}});}});
    });
    for(let t=1000;t<60000;t+=8000)events.push({t,run:async()=>{await instances[0].settings();if(mode!=='cold') await instances[0].getState(cfg,owner);}});
    const start=requests.length;
    try{for(const e of events.sort((a,b)=>a.t-b.t)){elapsed=e.t;await e.run();}}
    finally{Date.now=realNow;}
    const calls=requests.slice(start);
    assert.equal(calls.filter(r=>r.method!=='GET').length,mode==='discussion'?0:30);
    if(mode==='warm'&&count===1) assert.ok(calls.filter(r=>r.method==='GET').length<=45,'Single-instance read budget regressed');
    console.log(`DIAGNOSTIC ${mode} ${count} instances, staggered polling: ${calls.filter(r=>r.method==='GET').length} reads / ${calls.filter(r=>r.method!=='GET').length} writes. Quota enforcement disabled to measure demand.`);
  }
});

test('request logs count outbound attempts only and exclude sensitive data',async()=>{
  const adapter=require('../src/lib/voting/sheets.ts');
  const originalLog=console.log, originalFetch=global.fetch, originalEnv=process.env.VOTING_REQUEST_LOGS;
  const logs=[];console.log=entry=>logs.push(JSON.parse(entry));process.env.VOTING_REQUEST_LOGS='1';
  const id='private-sheet-identifier';books.set(id,new Map([['Private tab',[['private-name','private-password','private-rating']]]]));
  const range="'Private tab'!A1:C1";
  try{
    await Promise.all([adapter.readRanges(id,[range]),adapter.readRanges(id,[range])]);
    await adapter.readRanges(id,[range]);
    assert.equal(logs.length,1,'Cache hits and coalesced callers are not outbound requests');
    await adapter.writeRanges(id,[{range,values:[['sensitive-write']]}]);
    global.fetch=async()=>new Response('{}',{status:429});
    await assert.rejects(adapter.readRanges(id,[range],true),{status:429});
    await assert.rejects(adapter.readRanges(id,[range],true),{status:429});
    assert.equal(logs.length,3,'Cooldown rejections are not outbound requests');
    global.fetch=async()=>{throw new Error('secret-token-in-transport-error');};
    await assert.rejects(adapter.writeRanges(id,[{range,values:[['secret-ballot']]}]),{status:503});
    assert.equal(logs.length,4);
    assert.deepEqual(logs.map(r=>[r.kind,r.status,r.outcome]),[['read',200,'ok'],['write',200,'ok'],['read',429,'http_error'],['write',null,'transport_error']]);
    assert.equal(new Set(logs.map(r=>r.cacheId)).size,1);
    assert.equal(new Set(logs.map(r=>r.sequence)).size,4);
    for(const entry of logs){
      assert.equal(entry.event,'voting_sheets_request');
      assert.ok(Number.isFinite(Date.parse(entry.startedAt)));
      assert.ok(entry.durationMs>=0);
      assert.deepEqual(Object.keys(entry).sort(),['event','cacheId','sequence','startedAt','kind','operation','fresh','status','outcome','durationMs'].sort());
    }
    const output=JSON.stringify(logs);
    for(const secret of [id,'Private tab','private-name','private-password','private-rating','sensitive-write','secret-token','secret-ballot'])assert.ok(!output.includes(secret));
  }finally{
    console.log=originalLog;global.fetch=originalFetch;
    if(originalEnv===undefined)delete process.env.VOTING_REQUEST_LOGS;else process.env.VOTING_REQUEST_LOGS=originalEnv;
  }
});
