/* eslint-disable @typescript-eslint/no-require-imports */
/* Run: node --test tests/voting-redis.test.cjs */
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
process.env.VOTING_PRESIDENT_PASSWORD = 'isolated-president-password';
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
    for (const request of data.requests) if (request.updateCells) {
      const {range, rows, fields} = request.updateCells;
      assert.equal(fields, 'userEnteredValue');
      const title = [...book.keys()][range.sheetId];
      const target = book.get(title);
      for (let r=range.startRowIndex; r<range.endRowIndex; r++) {
        target[r] ||= [];
        for (let c=range.startColumnIndex; c<range.endColumnIndex; c++) {
          const value = rows[r-range.startRowIndex]?.values[c-range.startColumnIndex]?.userEnteredValue;
          target[r][c] = value?.stringValue ?? value?.formulaValue ?? '';
        }
      }
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

});
after(async () => {await run('redis-cli',['-s',socket,'SHUTDOWN','NOSAVE']).catch(()=>{}); server.kill(); fs.rmSync(testDir,{recursive:true,force:true});});

test('30 concurrent voters: atomic admission, no Sheets traffic while live, retryable exports', async () => {
  const admin=await seedElection(config);
  await redis.redisCommand('SET',redis.redisKey('president-active-election'),JSON.stringify(config));
  const configs = await Promise.all(Array.from({length:30},()=>service.settings()));
  assert.ok(configs.every(c=>c.sheetId===config.sheetId));
  assert.equal(requests.length,0,'Settings come only from Redis');
  const voters = await Promise.all(Array.from({length:30},(_,i)=>identity.claimIdentity(config,`Person ${i+1}`,null)));
  assert.ok(voters.every(m=>m.role==='voter'));
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
  assert.equal(publicState.currentCandidate.context,'private','Admitted voters can read the platform throughout voting');
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

async function election(suffix, count=3) {
  const cfg={...config,sessionId:`audit-${suffix}`,sheetId:`audit-election-${suffix}`};
  books.set(cfg.sheetId,new Map([['Sheet1',[]]]));
  const admin=await seedElection(cfg);
  const voters=await Promise.all(Array.from({length:count},(_,i)=>identity.claimIdentity(cfg,`Voter ${i}`,null)));
  await service.adminAction(cfg,admin,{action:'initialize'});
  await service.adminAction(cfg,admin,{action:'saveSetup',candidates,criteria});
  return {cfg,admin,voters};
}
async function open(e,id) {return service.adminAction(e.cfg,e.admin,{action:'setPhase',phase:'initial',candidateId:id});}
const initialPayload=s=>({sessionId:s.sessionId,candidateId:s.currentCandidate.id,ballotVersion:s.ballotVersion,ratings});
const finalPayload=(s,v)=>({...initialPayload(s),submissionId:`vote-${v.id}`,initialRatings:ratings,finalRatings:{c1:4,c2:5,c3:3}});

test('exports are compact when candidates run out of order and reopen',async()=>{
 const e=await election('compact'); const {cfg,admin,voters}=e;
 let s=await open(e,'b');
 await Promise.all(voters.map(v=>service.submitInitial(cfg,v,initialPayload(s))));
 await service.adminAction(cfg,admin,{action:'setPhase',phase:'revision'});
 await Promise.all(voters.slice(0,2).map(v=>service.submit(cfg,v,finalPayload(s,v))));
 await service.adminAction(cfg,admin,{action:'setPhase',phase:'locked'});
 const rows=books.get(cfg.sheetId).get('Responses');
 assert.equal(rows.length,7,'Two three-criterion ballots occupy six adjacent rows');
 s=await open(e,'a');
 await Promise.all(voters.map(v=>service.submitInitial(cfg,v,initialPayload(s))));
 await service.adminAction(cfg,admin,{action:'setPhase',phase:'revision'});
 await Promise.all(voters.map(v=>service.submit(cfg,v,finalPayload(s,v))));
 await service.adminAction(cfg,admin,{action:'setPhase',phase:'locked'});
 s=await service.adminAction(cfg,admin,{action:'setPhase',phase:'final',candidateId:'b'});
 await service.submit(cfg,voters[2],finalPayload(s,voters[2]));
 await service.adminAction(cfg,admin,{action:'setPhase',phase:'locked'});
 assert.equal(rows.length,19);
 assert.equal(rows.slice(1).filter(r=>r?.[0]).length,18);
 assert.equal(new Set(rows.slice(1).map(r=>`${r[2]}:${r[4]}:${r[7]}`)).size,18);
});

test('Redis restores initial ratings and keeps the original values authoritative',async()=>{
 const e=await election('recovery');const {cfg,admin,voters}=e;const s=await open(e,'a');
 await service.submitInitial(cfg,voters[0],initialPayload(s));
 assert.equal(typeof service.recoverBallot,'function');
 const saved=await service.recoverBallot(cfg,voters[0],'a',s.ballotVersion);
 assert.deepEqual(saved.initialRatings,ratings);
 const other=await service.recoverBallot(cfg,voters[1],'a',s.ballotVersion);
 assert.equal(other.initialRatings,null,'A voter cannot recover another person’s ratings');
 await service.adminAction(cfg,admin,{action:'setPhase',phase:'revision'});
 await service.submit(cfg,voters[0],{...finalPayload(s,voters[0]),initialRatings:{c1:1,c2:1,c3:1}});
 const final=await service.recoverBallot(cfg,voters[0],'a',s.ballotVersion);
 assert.deepEqual(final.initialRatings,ratings,'Final submission cannot rewrite the saved first impression');
 await assert.rejects(service.submit(cfg,voters[1],finalPayload(s,voters[1])),e=>e.status===409);
});

test('late arrivals stay private until admitted and stale controls cannot change the live round',async()=>{
 const e=await election('late',1); const {cfg,admin}=e;
 const a=await open(e,'a');
 const late=await identity.claimIdentity(cfg,'Late voter',null);
 assert.equal((await service.getState(cfg,late)).eligible,false);
 await assert.rejects(service.submitInitial(cfg,late,initialPayload(a)),e=>e.status===403);
 await service.adminAction(cfg,admin,{action:'setPhase',phase:'locked'});
 const b=await open(e,'b');
 const pending=await service.getState(cfg,late);
 assert.equal(pending.eligible,false);
 assert.equal(pending.admissionPending,true);
 assert.equal(pending.currentCandidate,null);
 assert.deepEqual(pending.criteria,[]);
 assert.equal(pending.ballotVersion,"");
 assert.equal(pending.participants,undefined);
 assert.equal((await service.getState(cfg,admin)).participants.some(v=>v.id===late.id),false);
 await service.adminAction(cfg,admin,{action:'admitVoters',voterIds:[late.id]});
 assert.equal((await service.getState(cfg,late)).eligible,true);
 await service.submitInitial(cfg,late,initialPayload(b));
 await assert.rejects(service.adminAction(cfg,admin,{action:'setPhase',phase:'locked',expected:{candidateId:'a',version:a.ballotVersion,phase:'initial'}}),e=>e.status===409);
 assert.equal((await service.getState(cfg,admin)).phase,'initial');
 const key=redis.redisKey('session',cfg.settingsSheetId,cfg.sheetId,cfg.sessionId);
 const view=JSON.parse(await redis.redisCommand('GET',`${key}:view`));
 assert.equal(view.rounds.b.initialRatings,undefined,'Polling projection contains no rating values');
});

test('admin roster admits late voters and removal blocks access without deleting ballots',async()=>{
 const e=await election('roster-controls',1); const {cfg,admin}=e;
 const a=await open(e,'a');
 const late=await identity.claimIdentity(cfg,'Late voter',null);
 let state=await service.getState(cfg,admin);
 assert.equal(state.voters.find(v=>v.id===late.id).eligible,false);
 await assert.rejects(service.adminAction(cfg,late,{action:'admitVoter',voterId:late.id}),e=>e.status===403);
 await service.adminAction(cfg,admin,{action:'admitVoter',voterId:late.id});
 await service.submitInitial(cfg,late,initialPayload(a));
 await service.adminAction(cfg,admin,{action:'setPhase',phase:'revision'});
 await service.submit(cfg,late,finalPayload(a,late));
 await service.adminAction(cfg,admin,{action:'removeVoter',voterId:late.id});
 await assert.rejects(service.getState(cfg,late),e=>e.status===401);
 const rejoined=await identity.claimIdentity(cfg,'Another name',late);
 assert.equal(rejoined.id,late.id);
 assert.equal((await service.getState(cfg,rejoined)).admissionPending,true);
 state=await service.getState(cfg,admin);
 assert.equal(state.submittedCount,1,'Previously submitted ballots remain');
 assert.equal(state.voters.find(v=>v.id===late.id).removed,false);

 assert.equal(state.participants.some(v=>v.id===late.id),false);
 await assert.rejects(service.adminAction(cfg,admin,{action:'admitVoter',voterId:late.id}),e=>e.status===409);
});

test('bulk removal is authorized, atomic and preserves member identities',async()=>{
 const {cfg,admin,voters}=await election('bulk-remove');
 await assert.rejects(service.adminAction(cfg,voters[0],{action:'removeVoters',voterIds:[voters[1].id]}),e=>e.status===403);
 await assert.rejects(service.adminAction(cfg,admin,{action:'removeVoters',voterIds:[voters[0].id,admin.id]}),e=>e.status===404);
 assert.equal((await service.getState(cfg,admin)).voters.filter(v=>v.removed).length,0);
 await service.adminAction(cfg,admin,{action:'removeVoters',voterIds:voters.slice(0,2).map(v=>v.id)});
 const state=await service.getState(cfg,admin);
 assert.equal(state.voters.filter(v=>v.removed).length,2);
 assert.equal(state.voters.length,3);
 await service.adminAction(cfg,admin,{action:'admitVoters',voterIds:voters.slice(0,2).map(v=>v.id)});
 assert.equal((await service.getState(cfg,admin)).voters.filter(v=>v.removed).length,0);
});

test('existing election row addresses remain unchanged after upgrading',async()=>{
 const e=await election('legacy',1);const {cfg,admin,voters}=e;
 const key=redis.redisKey('session',cfg.settingsSheetId,cfg.sheetId,cfg.sessionId);
 const doc=JSON.parse(await redis.redisCommand('GET',key)); delete doc.exportRows;
 await redis.redisCommand('SET',key,JSON.stringify(doc));
 const s=await open(e,'b'); await service.submitInitial(cfg,voters[0],initialPayload(s));
 await service.adminAction(cfg,admin,{action:'setPhase',phase:'revision'});
 await service.submit(cfg,voters[0],finalPayload(s,voters[0]));
 await service.adminAction(cfg,admin,{action:'setPhase',phase:'locked'});
 const rows=books.get(cfg.sheetId).get('Responses');
 assert.equal(rows[385][2],'b');
 assert.equal(rows.filter(r=>r?.[0]===`vote-${voters[0].id}`).length,3);
 const summary=books.get(cfg.sheetId).get('Summary');
 assert.equal(summary[1][0],'Candidate 1'); assert.equal(summary[2][0],'Candidate 2');
 assert.match(summary[2][1],/AVERAGEIFS.*"b".*"c1"/);
 const updates=requests.filter(r=>r.id===cfg.sheetId && r.data?.requests?.some(x=>x.updateCells));
 assert.equal(updates.length,1,'Summary names and formulas change atomically');
 assert.equal(requests.filter(r=>r.id===cfg.sheetId && r.suffix.endsWith(':clear')).length,0);
});

test('president setup creates elections without a settings sheet and never grants admin to voters',async()=>{
 const backend=require('../src/lib/voting/redis-service.ts');
 const {randomUUID}=require('node:crypto');
 const old=process.env.VOTING_PRESIDENT_PASSWORD;
 process.env.VOTING_PRESIDENT_PASSWORD='a-long-test-president-password';
 const sheetId='president-election-test-12345'; books.set(sheetId,new Map([['Sheet1',[]]]));
 const input={requestId:randomUUID(),candidates,criteria,password:'voter-password',sheetUrl:`https://docs.google.com/spreadsheets/d/${sheetId}/edit`};
 const before=requests.length;
 try {
   await redis.redisCommand('DEL',redis.redisKey('president-active-election'));
   await assert.rejects(backend.createElection({...input,criteria:[]}),e=>e.status===400);
   assert.equal(await backend.currentElection(),null,'Invalid setup never opens a session');
   const cfg=await backend.createElection(input);
   assert.match(cfg.name,/^Election \d{4}-\d{2}-\d{2}$/);
   assert.deepEqual(await backend.createElection(input),cfg,'Lost creation response is retryable');
   assert.equal((await service.settings()).sheetId,sheetId);
   assert.ok(requests.slice(before).every(r=>r.id===sheetId),'No access to settings sheet');
   const voter=await identity.claimIdentity(cfg,'First join',null);
   assert.equal(voter.role,'voter');
   const admin=await backend.presidentIdentity(cfg);
   const ready=await service.getState(cfg,admin);
   assert.equal(ready.candidates.length,candidates.length);
   assert.equal(ready.criteria.length,criteria.length);
   await assert.rejects(service.adminAction(cfg,voter,{action:'initialize'}),e=>e.status===403);
   await assert.rejects(backend.createElection({...input,requestId:randomUUID()}),e=>e.status===409);
   await service.adminAction(cfg,admin,{action:'saveSetup',candidates,criteria});
   await service.adminAction(cfg,admin,{action:'setPhase',phase:'initial',candidateId:'a'});
   await assert.rejects(backend.endElection(cfg.sessionId),e=>e.status===409);
   await service.adminAction(cfg,admin,{action:'setPhase',phase:'locked'});
   await backend.endElection(cfg.sessionId);
   assert.equal((await backend.currentElection()).password,'');
   await assert.rejects(service.adminAction(cfg,admin,{action:'setPhase',phase:'initial',candidateId:'b'}),e=>e.status===409,'Even stale open settings cannot restart an ended election');
   assert.equal((await service.getState(cfg,voter)).active,false);
 } finally {if(old===undefined) delete process.env.VOTING_PRESIDENT_PASSWORD;else process.env.VOTING_PRESIDENT_PASSWORD=old;}
});

async function seedElection(cfg) {
 const admin={id:'test-admin',claimId:'test-admin-claim',name:'President',role:'admin',slot:-1};
 const doc={schema:1,revision:0,marked:true,initialized:true,candidates:[],criteria:[],members:[admin],phase:'waiting',current:'',visible:false,rounds:{},exportRows:{nextResponse:2,nextReceipt:2,responses:{},receipts:{}}};
 await redis.redisCommand('SET',redis.redisKey('session',cfg.settingsSheetId,cfg.sheetId,cfg.sessionId),JSON.stringify(doc));
 return {...admin,sessionId:cfg.sessionId,sheetId:cfg.sheetId,exp:Date.now()+86400000};
}

test('missing Redis or president configuration never falls back to Google Sheets',async()=>{
 const before=requests.length; const old=process.env.VOTING_PRESIDENT_PASSWORD;
 delete process.env.VOTING_PRESIDENT_PASSWORD;
 await assert.rejects(service.settings(),e=>e.status===503);
 process.env.VOTING_PRESIDENT_PASSWORD=old;
 await redis.redisCommand('DEL',redis.redisKey('president-active-election'));
 await assert.rejects(service.settings(),e=>e.status===401);
 assert.equal(requests.length,before);
});


test('lobby kicks allow normal rejoin while bans prevent rejoin and admission',async()=>{
 const {cfg,admin,voters}=await election('kick-ban');
 const voter=voters[0];
 await service.adminAction(cfg,admin,{action:'removeVoters',voterIds:[voter.id]});
 await assert.rejects(service.getState(cfg,voter),e=>e.status===401);
 assert.equal((await identity.claimIdentity(cfg,voter.name,voter)).id,voter.id);
 assert.equal((await service.getState(cfg,voter)).eligible,true);
 await service.adminAction(cfg,admin,{action:'banVoters',voterIds:[voter.id]});
 await assert.rejects(service.getState(cfg,voter),e=>e.status===401);
 await assert.rejects(identity.claimIdentity(cfg,voter.name,voter),e=>e.status===403);
 await assert.rejects(service.adminAction(cfg,admin,{action:'admitVoters',voterIds:[voter.id]}),e=>e.status===409);
 assert.equal((await service.getState(cfg,admin)).voters.find(v=>v.id===voter.id).banned,true);
});


test('result statistics exclude blanks and retain kicked ballots without Sheets reads',async()=>{
 const backend=require('../src/lib/voting/redis-service.ts');
 const {summarizeRatings}=require('../src/lib/voting/results.ts');
 const stat=summarizeRatings([{initial:{c:1},final:{c:2}},{initial:{c:3},final:{c:4}},{initial:{c:null},final:{c:null}}],'c');
 assert.equal(stat.average,3);assert.equal(stat.median,3);assert.equal(stat.count,2);assert.equal(stat.initialAverage,2);
 const e=await election('results',1);const s=await open(e,'a');
 await service.submitInitial(e.cfg,e.voters[0],initialPayload(s));
 await service.adminAction(e.cfg,e.admin,{action:'setPhase',phase:'revision'});
 await service.submit(e.cfg,e.voters[0],finalPayload(s,e.voters[0]));
 await service.adminAction(e.cfg,e.admin,{action:'removeVoters',voterIds:[e.voters[0].id]});
 const before=requests.length;const result=await backend.electionResults(e.cfg);
 assert.equal(requests.length,before);assert.equal(result.candidates.find(c=>c.candidate.id==='a').ballots.length,1);
 assert.equal(result.candidates.find(c=>c.candidate.id==='b').stats[0].average,null);
});


test('bans are scoped to a session, including the same browser join ID',async()=>{
 const first=await election('ban-scope-old',0), second=await election('ban-scope-new',0);
 const joinId=require('node:crypto').randomUUID();
 const banned=await identity.claimIdentity(first.cfg,'Returning voter',null,joinId);
 await service.adminAction(first.cfg,first.admin,{action:'banVoters',voterIds:[banned.id]});
 await assert.rejects(identity.claimIdentity(first.cfg,'Returning voter',banned,joinId),e=>e.status===403);
 const fresh=await identity.claimIdentity(second.cfg,'Returning voter',banned,joinId);
 assert.notEqual(fresh.id,banned.id);
 assert.equal((await service.getState(second.cfg,fresh)).eligible,true);
 assert.equal((await service.getState(second.cfg,second.admin)).voters[0].banned,false);
});

test('bans exclude saved ballots and refresh every summary without deleting audit rows',async()=>{
 const backend=require('../src/lib/voting/redis-service.ts');
 const e=await election('ban-exclusion',1);const s=await open(e,'a');
 await service.submitInitial(e.cfg,e.voters[0],initialPayload(s));
 await service.adminAction(e.cfg,e.admin,{action:'setPhase',phase:'revision'});
 await service.submit(e.cfg,e.voters[0],finalPayload(s,e.voters[0]));
 await service.adminAction(e.cfg,e.admin,{action:'setPhase',phase:'locked'});
 const rawBefore=JSON.stringify(books.get(e.cfg.sheetId).get('Responses'));
 await service.adminAction(e.cfg,e.admin,{action:'banVoters',voterIds:[e.voters[0].id]});
 assert.equal((await service.getState(e.cfg,e.admin)).submittedCount,0);
 assert.equal((await backend.electionResults(e.cfg)).candidates[0].ballots.length,0);
 assert.equal(JSON.stringify(books.get(e.cfg.sheetId).get('Responses')),rawBefore,'Raw ballots stay available for audit');
 const summary=books.get(e.cfg.sheetId).get('Summary');
 assert.ok(summary[1][1].includes(e.voters[0].id));
 assert.ok(summary[1][criteria.length+1].includes(e.voters[0].id));
 assert.equal((await service.getState(e.cfg,e.admin)).exportPending,false);
});


test('rejoining updates the name while retaining voter identity and ban enforcement',async()=>{
 const e=await election('rename-rejoin',0), joinId=require('node:crypto').randomUUID();
 const first=await identity.claimIdentity(e.cfg,'test2',null,joinId);
 const renamed=await identity.claimIdentity(e.cfg,'b',first,joinId);
 assert.equal(renamed.id,first.id);assert.equal(renamed.name,'b');
 let roster=(await service.getState(e.cfg,e.admin)).voters;
 assert.equal(roster.length,1);assert.equal(roster[0].name,'b');
 const retry=await identity.claimIdentity(e.cfg,'c',null,joinId);
 assert.equal(retry.id,first.id);assert.equal(retry.name,'c');
 await service.adminAction(e.cfg,e.admin,{action:'banVoters',voterIds:[first.id]});
 await assert.rejects(identity.claimIdentity(e.cfg,'different name',first,joinId),e=>e.status===403);
 roster=(await service.getState(e.cfg,e.admin)).voters;assert.equal(roster[0].name,'c');
});

test('presence expires independently of voter admission and ballots',async()=>{
 const presence=require('../src/lib/voting/presence.ts');
 const e=await election('presence',1);
 assert.equal(presence.presenceStatus(1000,false,7000),'online');
 assert.equal(presence.presenceStatus(1000,true,15000),'away');
 assert.equal(presence.presenceStatus(1000,false,28000),'away');
 assert.equal(presence.presenceStatus(1000,false,62000),'offline');
 await presence.recordPresence(e.cfg,e.voters[0].id,false);
 assert.equal((await presence.readPresence(e.cfg,[e.voters[0].id]))[e.voters[0].id],'online');
 await presence.recordPresence(e.cfg,e.voters[0].id,true);
 assert.equal((await presence.readPresence(e.cfg,[e.voters[0].id]))[e.voters[0].id],'away');
 assert.equal((await service.getState(e.cfg,e.voters[0])).eligible,true);
 assert.equal((await presence.readPresence({...e.cfg,sessionId:'other'},[e.voters[0].id]))[e.voters[0].id],'offline');
});


test('voter completion appears only after all rounds close and clears on reopen',async()=>{
 const e=await election('completion',1);
 for (const candidate of candidates) {
  await open(e,candidate.id);
  const state=await service.getState(e.cfg,e.voters[0]);
  await service.submitInitial(e.cfg,e.voters[0],{sessionId:e.cfg.sessionId,candidateId:candidate.id,ballotVersion:state.ballotVersion,ratings});
  await service.adminAction(e.cfg,e.admin,{action:'setPhase',phase:'locked'});
 }
 assert.equal((await service.getState(e.cfg,e.voters[0])).votingComplete,true);
 assert.equal((await service.getState(e.cfg,e.voters[0])).pollIntervalMs,3000,'Unfinished voters keep watching for reopened ballots');
 await service.adminAction(e.cfg,e.admin,{action:'setPhase',phase:'final',candidateId:candidates[0].id});
 assert.equal((await service.getState(e.cfg,e.voters[0])).votingComplete,false);
});

test('polling uses one voter read and two admin reads with fresh moderation and session checks',async()=>{
 const backend=require('../src/lib/voting/redis-service.ts');
 const cfg={...config,settingsSheetId:'president-v1',sessionId:'poll-budget',sheetId:'poll-budget-sheet'};
 books.set(cfg.sheetId,new Map([['Sheet1',[]]]));
 const admin=await seedElection(cfg);
 await service.adminAction(cfg,admin,{action:'initialize'});
 await service.adminAction(cfg,admin,{action:'saveSetup',candidates,criteria});
 const voter=await identity.claimIdentity(cfg,'Polling voter',null);
 const activeKey=redis.redisKey('president-active-election');
 await redis.redisCommand('SET',activeKey,JSON.stringify(cfg));
 let before=redisRequests;
 assert.equal((await backend.voterPoll(voter)).state.voter.name,'Polling voter');
 assert.equal(redisRequests-before,1,'One MGET per voter poll');
 before=redisRequests;
 assert.equal((await backend.presidentPoll()).state.isAdmin,true);
 assert.equal(redisRequests-before,2,'Admin snapshot is read only once');
 await service.adminAction(cfg,admin,{action:'removeVoters',voterIds:[voter.id]});
 await assert.rejects(backend.voterPoll(voter),/kicked/);
 const rejoined=await identity.claimIdentity(cfg,'Returned',voter);
 assert.equal((await backend.voterPoll(rejoined)).state.voter.name,'Returned');
 for(const candidate of candidates){
   await service.adminAction(cfg,admin,{action:'setPhase',phase:'initial',candidateId:candidate.id});
   await service.adminAction(cfg,admin,{action:'setPhase',phase:'locked'});
 }
 assert.equal((await backend.voterPoll(rejoined)).state.pollIntervalMs,10000);
 assert.equal((await backend.presidentPoll()).state.pollIntervalMs,3000);
 await service.adminAction(cfg,admin,{action:'setPhase',phase:'final',candidateId:candidates[0].id});
 assert.equal((await backend.voterPoll(rejoined)).state.pollIntervalMs,3000);
 await service.adminAction(cfg,admin,{action:'banVoters',voterIds:[voter.id]});
 await assert.rejects(backend.voterPoll(rejoined),/banned/);
 await redis.redisCommand('SET',activeKey,JSON.stringify({...cfg,sessionId:'next-session'}));
 await assert.rejects(backend.voterPoll(rejoined),e=>e.status===401);
});
