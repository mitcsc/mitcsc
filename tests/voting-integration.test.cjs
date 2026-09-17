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
  return (book.get(tab) || []).slice(row, match ? Number(match[0]) : undefined).map(r => r.slice(column));
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
  const data = options.body ? JSON.parse(options.body) : undefined;
  requests.push({ id, suffix, method: options.method, data });
  const json = value => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
  if (!suffix) return json({ sheets: [...book.keys()].map((title, sheetId) => ({ properties: { title, sheetId } })) });
  if (suffix === '/values:batchGet') return json({ valueRanges: url.searchParams.getAll('ranges').map(range => ({values: getRows(book, range)})) });
  if (suffix === '/values:batchUpdate') {
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
  await assert.rejects(service.submit(config,voter,ballot), {status:429});
  assert.equal(books.get(config.sheetId).get('Responses').length, 1, 'Failed write must not appear saved');
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
  state = await service.adminAction(config,admin,{action:'setPhase',phase:'initial',candidateId:'sam'});
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
  assert.equal(books.get(config.sheetId).get('Responses').length,3);

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
