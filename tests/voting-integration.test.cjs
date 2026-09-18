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
      await service.getState(cfg,owner);
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
