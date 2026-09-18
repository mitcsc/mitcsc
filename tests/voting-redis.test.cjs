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

test('late arrivals join the next round and stale admin controls cannot change the live round',async()=>{
 const e=await election('late',1); const {cfg,admin}=e;
 const a=await open(e,'a');
 const late=await identity.claimIdentity(cfg,'Late voter',null);
 assert.equal((await service.getState(cfg,late)).eligible,false);
 await assert.rejects(service.submitInitial(cfg,late,initialPayload(a)),e=>e.status===409);
 await service.adminAction(cfg,admin,{action:'setPhase',phase:'locked'});
 const b=await open(e,'b');
 assert.equal((await service.getState(cfg,late)).eligible,true);
 await service.submitInitial(cfg,late,initialPayload(b));
 await assert.rejects(service.adminAction(cfg,admin,{action:'setPhase',phase:'locked',expected:{candidateId:'a',version:a.ballotVersion,phase:'initial'}}),e=>e.status===409);
 assert.equal((await service.getState(cfg,admin)).phase,'initial');
 const key=redis.redisKey('session',cfg.settingsSheetId,cfg.sheetId,cfg.sessionId);
 const view=JSON.parse(await redis.redisCommand('GET',`${key}:view`));
 assert.equal(view.rounds.b.initialRatings,undefined,'Polling projection contains no rating values');
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
 const input={requestId:randomUUID(),name:'Test election',password:'voter-password',sheetUrl:`https://docs.google.com/spreadsheets/d/${sheetId}/edit`};
 const before=requests.length;
 try {
   await redis.redisCommand('DEL',redis.redisKey('president-active-election'));
   const cfg=await backend.createElection(input);
   assert.deepEqual(await backend.createElection(input),cfg,'Lost creation response is retryable');
   assert.equal((await service.settings()).sheetId,sheetId);
   assert.ok(requests.slice(before).every(r=>r.id===sheetId),'No access to settings sheet');
   const voter=await identity.claimIdentity(cfg,'First join',null);
   assert.equal(voter.role,'voter');
   const admin=await backend.presidentIdentity(cfg);
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
