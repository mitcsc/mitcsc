/* eslint-disable @typescript-eslint/no-require-imports */
/* Run: node --test tests/voting-redis.test.cjs (needs redis-server and redis-cli) */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, filename);

const {spawn, execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {randomUUID} = require('node:crypto');
const {tmpdir} = require('node:os');
const path = require('node:path');
const run = promisify(execFile);
const testDir = fs.mkdtempSync(path.join(tmpdir(), 'csc-redis-test-'));
const socket = path.join(testDir, 'redis.sock');
const server = spawn('redis-server', ['--port', '0', '--unixsocket', socket, '--save', '', '--appendonly', 'no'], {stdio: 'ignore'});
let redisRequests = 0, loseAck = false;
// A private Redis behind the Upstash REST shape. Nothing else may be called.
global.fetch = async (input, options = {}) => {
  assert.equal(String(input), 'https://redis.test.invalid', 'Tests must only call the test Redis');
  redisRequests++;
  const command = JSON.parse(options.body).map(String);
  const {stdout} = await run('redis-cli', ['-s', socket, '--json', ...command], {maxBuffer: 10_000_000});
  const parsed = JSON.parse(stdout);
  // redis-cli prints a hash reply as an object. Upstash sends it as a flat [field, value, ...] list.
  const result = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.entries(parsed).flat() : parsed;
  if (loseAck && command[0] === 'EVAL' && command[1].includes("redis.call('SET'") && result === 1) {loseAck = false; throw new Error('lost acknowledgement');}
  return Response.json({result});
};
process.env.UPSTASH_REDIS_REST_URL = 'https://redis.test.invalid';
process.env.UPSTASH_REDIS_REST_TOKEN = 'test-only';
const service = require('../src/lib/voting/service.ts');
const delibs = require('../src/lib/voting/redis-service.ts');
const redis = require('../src/lib/voting/redis.ts');
const {resultRows} = require('../src/lib/voting/export.ts');

const CLUB = 'club@gmail.com';
const host = {email: 'host@mit.edu', name: 'Host Person'};
const person = i => ({email: `exec${i}@mit.edu`, name: `Exec ${i}`});
const candidates = ['a', 'b'].map((id, order) => ({id, name: `Candidate ${order + 1}`, context: 'private', order, completed: false}));
const criteria = [1, 2, 3].map(n => ({id: `c${n}`, label: `Criteria ${n}`, description: '', min: 1, max: 5, required: true}));
const ratings = {c1: 3, c2: 4, c3: 5};

before(async () => {
  for (let i = 0; i < 100 && !fs.existsSync(socket); i++) await new Promise(r => setTimeout(r, 20));
  assert.ok(fs.existsSync(socket), 'Redis server started');
});
after(async () => {await run('redis-cli', ['-s', socket, 'SHUTDOWN', 'NOSAVE']).catch(() => {}); server.kill(); fs.rmSync(testDir, {recursive: true, force: true});});

// Only one delib runs at a time, so each test starts by dropping the open one.
async function open(by = host, extra = {}) {
  await redis.redisCommand('DEL', redis.redisKey('delibs-active'));
  return delibs.createElection({requestId: randomUUID(), candidates, criteria, ...extra}, by);
}
async function join(cfg, who) {return delibs.redisJoin(cfg, who, CLUB);}
async function election(count = 3) {
  const cfg = await open();
  const admin = delibs.identityFor(cfg, host);
  const voters = await Promise.all(Array.from({length: count}, (_, i) => join(cfg, person(i))));
  return {cfg, admin, voters};
}
const start = (e, id) => service.adminAction(e.cfg, e.admin, {action: 'setPhase', phase: 'initial', candidateId: id});
const initialPayload = s => ({sessionId: s.sessionId, candidateId: s.currentCandidate.id, ballotVersion: s.ballotVersion, ratings});
const finalPayload = (s, v) => ({...initialPayload(s), submissionId: `vote-${v.id}`, initialRatings: ratings, finalRatings: {c1: 4, c2: 5, c3: 3}});

test('one delib runs at a time, retries do not open a second one, and only its host ends it', async () => {
  await redis.redisCommand('DEL', redis.redisKey('delibs-active'));
  await assert.rejects(service.settings(), e => e.status === 404);
  const requestId = randomUUID();
  const input = {requestId, name: 'Fall delibs', candidates, criteria};
  const [first, retry] = await Promise.all([delibs.createElection(input, host), delibs.createElection(input, host).catch(e => e)]);
  const created = retry instanceof Error ? (await delibs.createElection(input, host)) : retry;
  assert.equal(first.sessionId, requestId);
  assert.equal(created.sessionId, requestId, 'A retry returns the same delib');
  assert.equal((await service.settings()).hostName, 'Host Person');
  await assert.rejects(delibs.createElection({...input, requestId: randomUUID()}, person(1)), e => e.status === 409 && /Host Person is already running “Fall delibs”/.test(e.message));
  await assert.rejects(delibs.createElection({requestId: randomUUID(), candidates: [], criteria}, host), /Add candidates and criteria/);
  assert.match((await open(host, {name: undefined})).name, /^Delibs \d{4}-\d{2}-\d{2}$/, 'An unnamed delib gets a dated name');
  const cfg = await open(host, {name: 'Spring delibs'});
  await assert.rejects(delibs.endElection(cfg.sessionId, person(1)), e => e.status === 403);
  await assert.rejects(delibs.endElection(randomUUID(), host), e => e.status === 409);
  const e = {cfg, admin: delibs.identityFor(cfg, host)};
  await start(e, 'a');
  await assert.rejects(delibs.endElection(cfg.sessionId, host), /Close the current candidate/);
  await service.adminAction(cfg, e.admin, {action: 'setPhase', phase: 'locked'});
  await delibs.endElection(cfg.sessionId, host);
  await assert.rejects(service.settings(), e => e.status === 404, 'Nothing is open after the end');
  const all = await delibs.allElections();
  assert.equal(all[0].name, 'Spring delibs', 'Newest first');
  assert.equal(all[0].open, false);
  assert.equal(all[0].host, host.email);
  await assert.rejects(delibs.electionResults(cfg.sessionId, person(1)), e => e.status === 403, 'Only the host sees results');
  assert.equal((await delibs.electionResults(cfg.sessionId, host)).ended, true);

  // Only the host can delete an ended delib, and deleting removes its votes.
  await assert.rejects(delibs.deleteElection(cfg.sessionId, person(1)), e => e.status === 403, 'Only the host can delete');
  await delibs.deleteElection(cfg.sessionId, host);
  assert.equal(await delibs.currentElection(), null, 'The last ended delib is cleared from the active key too');
  assert.equal((await delibs.allElections()).some(d => d.sessionId === cfg.sessionId), false);
  assert.equal(await redis.redisCommand('GET', redis.redisKey('delib', cfg.sessionId)), null, 'The votes are gone');
  await assert.rejects(delibs.deleteElection(cfg.sessionId, host), e => e.status === 404);
  await assert.rejects(delibs.electionResults(cfg.sessionId, host), e => e.status === 403);
  const running = await open(host, {name: 'Winter delibs'});
  await assert.rejects(delibs.deleteElection(running.sessionId, host), e => e.status === 409, 'A running delib cannot be deleted');
  assert.equal((await service.settings()).sessionId, running.sessionId);
});

test('joining uses the Google account: the host never votes and the club account cannot join', async () => {
  const cfg = await open();
  const admin = await join(cfg, host);
  assert.equal(admin.role, 'admin');
  await assert.rejects(join(cfg, {email: CLUB, name: 'MIT CSC'}), e => e.status === 403 && /club account/.test(e.message));
  const voter = await join(cfg, person(1));
  assert.equal(voter.role, 'voter');
  assert.equal((await join(cfg, {...person(1), name: 'Renamed'})).id, voter.id, 'The same account keeps its identity');
  assert.equal((await service.getState(cfg, voter)).voter.name, 'Renamed');
  await assert.rejects(service.getState(cfg, delibs.identityFor(cfg, person(2))), e => e.status === 401 && e.message === 'Join the session.');
  const state = await service.adminAction(cfg, admin, {action: 'setPhase', phase: 'initial', candidateId: 'a'});
  await assert.rejects(service.submitInitial(cfg, admin, initialPayload(state)), /The host does not vote/);
  const late = await join(cfg, person(2));
  assert.equal((await service.getState(cfg, late)).admissionPending, true, 'A voter who joins after voting starts waits for the host');
  await service.adminAction(cfg, admin, {action: 'admitVoters', voterIds: [late.id]});
  await service.submitInitial(cfg, late, initialPayload(state));
});

test('30 concurrent voters: atomic joins, retried votes, and results with one row per vote', async () => {
  const e = await election(30);
  assert.equal(new Set(e.voters.map(v => v.id)).size, 30);
  const again = await Promise.all(Array.from({length: 3}, () => join(e.cfg, person(0))));
  assert.equal(new Set(again.map(v => v.id)).size, 1);
  await assert.rejects(service.adminAction(e.cfg, e.voters[0], {action: 'setPhase', phase: 'initial', candidateId: 'a'}), e => e.status === 403);
  let state = await start(e, 'a');
  const payloads = e.voters.map(v => finalPayload(state, v));
  await Promise.all(e.voters.map((v, i) => service.submitInitial(e.cfg, v, payloads[i])));
  await service.adminAction(e.cfg, e.admin, {action: 'setPhase', phase: 'deliberation'});
  await service.adminAction(e.cfg, e.admin, {action: 'setPhase', phase: 'revision'});
  await Promise.all(e.voters.slice(0, 29).map((v, i) => service.submit(e.cfg, v, payloads[i])));
  loseAck = true;
  await assert.rejects(service.submit(e.cfg, e.voters[29], payloads[29]), e => e.status === 503);
  await Promise.all(e.voters.map((v, i) => service.submit(e.cfg, v, payloads[i])));
  state = await service.getState(e.cfg, e.admin);
  assert.equal(state.submittedCount, 30, 'Retries never count twice');
  const publicState = await service.getState(e.cfg, e.voters[0]);
  assert.equal(publicState.participants, undefined, 'Voters do not see who voted');
  assert.equal(publicState.voters, undefined);
  await service.adminAction(e.cfg, e.admin, {action: 'setPhase', phase: 'locked'});
  state = await start(e, 'b');
  // Race closing against 30 first-time submissions. Every acknowledged receipt must survive the close.
  const settled = await Promise.allSettled(e.voters.map(v => service.submitInitial(e.cfg, v, initialPayload(state))).concat(service.adminAction(e.cfg, e.admin, {action: 'setPhase', phase: 'deliberation'})));
  const accepted = settled.slice(0, 30).filter(r => r.status === 'fulfilled').length;
  assert.equal((await service.getState(e.cfg, e.admin)).participants.filter(p => p.initialSubmitted).length, accepted);
  assert.ok(settled.slice(0, 30).every(r => r.status === 'fulfilled' || r.reason.status === 409));
  const results = await delibs.electionResults(e.cfg.sessionId, host);
  assert.equal(results.voterCount, 30);
  assert.equal(results.candidates[0].ballots.length, 30);
  assert.equal(new Set(results.candidates[0].ballots.map(b => b.voterName)).size, 30, 'Each ballot carries its voter name');
  const rows = resultRows(results);
  assert.equal(rows.length, 31, 'The export has a header and one row per vote, with no blank rows');
  assert.ok(rows.slice(1).every(r => r[0] === 'Candidate 1' && r[1].startsWith('Exec ')));
  console.log(JSON.stringify({voters: 30, finalBallots: 30, exportRows: rows.length - 1, redisRequests, closeRaceAccepted: accepted}));
  await redis.redisCommand('DEL', redis.redisKey('delib', e.cfg.sessionId), `${redis.redisKey('delib', e.cfg.sessionId)}:view`);
  await assert.rejects(service.getState(e.cfg, e.admin), e => e.status === 503 && /missing/.test(e.message), 'Missing Redis data never resets a delib');
});

test('Redis restores initial ratings and keeps the original values authoritative', async () => {
  const e = await election(2);
  const s = await start(e, 'a');
  await service.submitInitial(e.cfg, e.voters[0], initialPayload(s));
  assert.deepEqual((await service.recoverBallot(e.cfg, e.voters[0], 'a', s.ballotVersion)).initialRatings, ratings);
  await service.adminAction(e.cfg, e.admin, {action: 'setPhase', phase: 'revision'});
  await service.submit(e.cfg, e.voters[0], {...finalPayload(s, e.voters[0]), initialRatings: {c1: 1, c2: 1, c3: 1}});
  assert.deepEqual((await delibs.electionResults(e.cfg.sessionId, host)).candidates[0].ballots[0].initial, ratings, 'A changed initial rating is ignored');
  await assert.rejects(service.submit(e.cfg, e.voters[1], finalPayload(s, e.voters[1])), e => e.status === 409);
});

test('kicked voters can rejoin, banned voters cannot, and banned ballots leave the results', async () => {
  const e = await election(3);
  await service.adminAction(e.cfg, e.admin, {action: 'removeVoters', voterIds: [e.voters[0].id]});
  await assert.rejects(service.getState(e.cfg, e.voters[0]), /kicked from this session/);
  await join(e.cfg, person(0));
  assert.equal((await service.getState(e.cfg, e.voters[0])).voter.name, 'Exec 0');
  const s = await start(e, 'a');
  for (const v of e.voters) await service.submitInitial(e.cfg, v, initialPayload(s));
  await service.adminAction(e.cfg, e.admin, {action: 'setPhase', phase: 'revision'});
  for (const v of e.voters) await service.submit(e.cfg, v, finalPayload(s, v));
  await service.adminAction(e.cfg, e.admin, {action: 'banVoters', voterIds: [e.voters[1].id]});
  await assert.rejects(service.getState(e.cfg, e.voters[1]), /banned/);
  await assert.rejects(join(e.cfg, person(1)), e => e.status === 403 && /banned/.test(e.message));
  await assert.rejects(service.adminAction(e.cfg, e.admin, {action: 'admitVoters', voterIds: [e.voters[1].id]}), /Banned voters/);
  const results = await delibs.electionResults(e.cfg.sessionId, host);
  assert.deepEqual(results.candidates[0].ballots.map(b => b.voterName).sort(), ['Exec 0', 'Exec 2']);
  await service.adminAction(e.cfg, e.admin, {action: 'setPhase', phase: 'locked'});
  await delibs.endElection(e.cfg.sessionId, host);
  await assert.rejects(join(e.cfg, person(5)), /No delib is open|ended/);
  const next = await open();
  assert.equal((await join(next, person(1))).role, 'voter', 'A ban only applies to its own delib');
});

test('presence expires independently of voter admission and ballots', async () => {
  const presence = require('../src/lib/voting/presence.ts');
  const e = await election(1);
  assert.equal(presence.presenceStatus(1000, false, 7000), 'online');
  assert.equal(presence.presenceStatus(1000, true, 15000), 'away');
  assert.equal(presence.presenceStatus(1000, false, 28000), 'away');
  assert.equal(presence.presenceStatus(1000, false, 62000), 'offline');
  await presence.recordPresence(e.cfg, e.voters[0].id, false);
  assert.equal((await presence.readPresence(e.cfg, [e.voters[0].id]))[e.voters[0].id], 'online');
  await presence.recordPresence(e.cfg, e.voters[0].id, true);
  assert.equal((await presence.readPresence(e.cfg, [e.voters[0].id]))[e.voters[0].id], 'away');
  assert.equal((await presence.readPresence({...e.cfg, sessionId: 'other'}, [e.voters[0].id]))[e.voters[0].id], 'offline');
});

test('voter completion appears only after all rounds close and clears on reopen', async () => {
  const e = await election(1);
  for (const candidate of candidates) {
    const state = await start(e, candidate.id);
    await service.submitInitial(e.cfg, e.voters[0], initialPayload(state));
    await service.adminAction(e.cfg, e.admin, {action: 'setPhase', phase: 'locked'});
  }
  assert.equal((await service.getState(e.cfg, e.voters[0])).votingComplete, true);
  assert.equal((await service.getState(e.cfg, e.voters[0])).pollIntervalMs, 3000, 'Unfinished voters keep watching for reopened ballots');
  await service.adminAction(e.cfg, e.admin, {action: 'setPhase', phase: 'final', candidateId: candidates[0].id});
  assert.equal((await service.getState(e.cfg, e.voters[0])).votingComplete, false);
});
