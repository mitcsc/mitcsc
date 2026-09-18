/* eslint-disable @typescript-eslint/no-require-imports */
/* Run: node --test tests/voting-integration.test.cjs */
const { test, before, after } = require('node:test');
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
const googleFetch = async (input, options = {}) => {
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
  if (suffix.endsWith(':clear')) { book.set(rangeParts(decodeURIComponent(suffix.slice(8,-6))).tab, []); return json({}); }
  if (suffix.startsWith('/values/')) return json({values:getRows(book,decodeURIComponent(suffix.slice(8)))});
  throw new Error(`Unimplemented mock ${suffix}`);
};

const {spawn, execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {mkdtempSync} = require('node:fs');
const {tmpdir} = require('node:os');
const {join} = require('node:path');
const run = promisify(execFile);
const testDir = mkdtempSync(join(tmpdir(), 'csc-redis-test-'));
const socket = join(testDir, 'redis.sock');
const server = spawn('redis-server', ['--port', '0', '--unixsocket', socket, '--save', '', '--appendonly', 'no'], {stdio: 'ignore'});
let redisRequests = 0, failExport = false, loseAck = false;
global.fetch = async (input, options = {}) => {
  if (String(input) === 'https://redis.test.invalid') {
    redisRequests++;
    const command = JSON.parse(options.body).map(String);
    const {stdout} = await run('redis-cli', ['-s', socket, '--json', ...command], {maxBuffer: 10_000_000});
    const result = JSON.parse(stdout);
    if (loseAck && command[0] === 'EVAL' && command[1].includes("redis.call('SET'") && result === 1) {loseAck = false; throw new Error('lost acknowledgement');}
    return Response.json({result});
  }
  if (failExport && options.body && JSON.parse(options.body).data?.some(d => d.range.startsWith("'Responses'!"))) {failExport = false; return new Response('{}', {status: 503});}
  return googleFetch(input, options);
};
process.env.UPSTASH_REDIS_REST_URL = 'https://redis.test.invalid';
process.env.UPSTASH_REDIS_REST_TOKEN = 'test-only';
const service = require('../src/lib/voting/service.ts');
const identity = require('../src/lib/voting/admin-identity.ts');
const redis = require('../src/lib/voting/redis.ts');
const config = {sessionId:'redis-test', password:'test-only', settingsSheetId:'settings-test', sheetId:'election-test-redis-12345'};
const candidates = ['a','b'].map((id,order)=>({id,name:`Candidate ${order+1}`,context:'private',order,completed:false}));
const criteria = [1,2,3].map(n=>({id:`c${n}`,label:`Criteria ${n}`,description:'',min:1,max:5,required:true}));
const ratings = {c1:3,c2:4,c3:5};
before(async () => {
  for (let i=0; i<100 && !fs.existsSync(socket); i++) await new Promise(r=>setTimeout(r,20));
  assert.ok(fs.existsSync(socket), 'Redis server started');
  books.set(config.sheetId, new Map([['Sheet1',[]]]));
  books.set(config.settingsSheetId, new Map([
    ['Settings', [['session_id',config.sessionId],['session_password',config.password],['voting_sheet_url',config.sheetId]]],
    ['Session History', [['session_id','election_sheet_id','claim_id','voter_id','voter_name','claimed_at']]],
  ]));
});
after(async () => {await run('redis-cli',['-s',socket,'SHUTDOWN','NOSAVE']).catch(()=>{}); server.kill(); fs.rmSync(testDir,{recursive:true,force:true});});

test('30 concurrent voters: atomic admission, no Sheets traffic while live, retryable exports', async () => {
  const configs = await Promise.all(Array.from({length:30},()=>service.settings()));
  assert.ok(configs.every(c=>c.sheetId===config.sheetId));
  assert.ok(requests.length <= 3, 'Settings reads are shared across simultaneous requests');
  const joined = await Promise.all(Array.from({length:31},(_,i)=>identity.claimIdentity(config,`Person ${i+1}`,null)));
  assert.equal(joined.filter(m=>m.role==='admin').length,1);
  const admin=joined.find(m=>m.role==='admin'), voters=joined.filter(m=>m.role==='voter');
  assert.equal(new Set(voters.map(v=>v.voterSlot)).size,30);
  assert.equal((await identity.claimIdentity(config,admin.name,admin)).id,admin.id);
  const joinId = require('node:crypto').randomUUID();
  const retries = await Promise.all(Array.from({length:3},()=>identity.claimIdentity(config,'Retry voter',null,joinId)));
  assert.equal(new Set(retries.map(v=>v.id)).size,1);
  await service.adminAction(config,admin,{action:'initialize'});
  await service.adminAction(config,admin,{action:'saveSetup',candidates,criteria});
  await assert.rejects(service.adminAction(config,voters[0],{action:'setPhase',phase:'initial',candidateId:'a'}),e=>e.status===403);
  const baseline=requests.length;
  let state=await service.adminAction(config,admin,{action:'setPhase',phase:'initial',candidateId:'a'});
  const ballot=v=>({sessionId:config.sessionId,candidateId:'a',ballotVersion:state.ballotVersion,submissionId:`vote-${v.id}`,ratings,initialRatings:ratings,finalRatings:ratings});
  const payloads = voters.map(ballot);
  await Promise.all(voters.map((v,i)=>service.submitInitial(config,v,payloads[i])));
  await service.adminAction(config,admin,{action:'setPhase',phase:'deliberation'});
  await Promise.all(Array.from({length:5},()=>Promise.all(voters.map(v=>service.getState(config,v)))));
  await service.adminAction(config,admin,{action:'setPhase',phase:'revision'});
  await Promise.all(voters.slice(0,29).map((v,i)=>service.submit(config,v,payloads[i])));
  loseAck=true;
  await assert.rejects(service.submit(config,voters[29],payloads[29]),e=>e.status===503);
  await service.submit(config,voters[29],payloads[29]);
  await Promise.all(voters.map((v,i)=>service.submit(config,v,payloads[i])));
  state=await service.getState(config,admin);
  assert.equal(state.submittedCount,30);
  assert.equal(state.participants.filter(p=>p.initialSubmitted).length,30);
  assert.equal(requests.length,baseline,'Zero Google calls during phases, polls, receipts and final votes');
  const publicState=await service.getState(config,voters[0]);
  assert.equal(publicState.participants,undefined);
  assert.equal(publicState.candidateStates,undefined);
  assert.equal(publicState.currentCandidate.context,'');
  failExport=true;
  await assert.rejects(service.adminAction(config,admin,{action:'setPhase',phase:'locked'}),e=>e.status===503);
  state=await service.getState(config,admin);
  assert.equal(state.exportPending,true);
  await assert.rejects(service.adminAction(config,admin,{action:'setPhase',phase:'initial',candidateId:'b'}),e=>e.status===409);
  state=await service.adminAction(config,admin,{action:'setPhase',phase:'locked'});
  assert.equal(state.exportPending,false);
  assert.equal(state.candidates[0].completed,true);
  const responses=books.get(config.sheetId).get('Responses').slice(1).filter(r=>r?.[0]);
  assert.equal(responses.length,90);
  assert.equal(new Set(responses.map(r=>r[4])).size,30);
  await service.adminAction(config,admin,{action:'setPhase',phase:'final',candidateId:'a'});
  await service.adminAction(config,admin,{action:'setPhase',phase:'locked'});
  assert.equal(books.get(config.sheetId).get('Responses').slice(1).filter(r=>r?.[0]).length,90,'Re-export does not duplicate ballots');
  state=await service.adminAction(config,admin,{action:'setPhase',phase:'initial',candidateId:'b'});
  // Race closing against 30 first-time submissions. Every acknowledged receipt must survive the close.
  const settled=await Promise.allSettled(voters.map(v=>service.submitInitial(config,v,{sessionId:config.sessionId,candidateId:'b',ballotVersion:state.ballotVersion,ratings})).concat(service.adminAction(config,admin,{action:'setPhase',phase:'deliberation'})));
  const accepted=settled.slice(0,30).filter(r=>r.status==='fulfilled').length;
  const after=await service.getState(config,admin);
  assert.equal(after.participants.filter(p=>p.initialSubmitted).length,accepted);
  assert.ok(settled.slice(0,30).every(r=>r.status==='fulfilled'||r.reason.status===409));
  console.log(JSON.stringify({voters:30,finalBallots:30,exportedRows:90,redisRequests,sheetsCallsDuringVoting:0,closeRaceAccepted:accepted}));
  const key=redis.redisKey('session',config.settingsSheetId,config.sheetId,config.sessionId);
  await redis.redisCommand('DEL',key,`${key}:view`);
  await assert.rejects(service.getState(config,admin),e=>e.status===503 && /missing/.test(e.message),'Missing Redis cannot reset an election from stale Sheets');
});
