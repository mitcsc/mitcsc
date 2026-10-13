/* eslint-disable @typescript-eslint/no-require-imports */
/* Run: npm run test:membership */
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, filename);

process.env.MEMBERSHIP_SECRET = 'a-test-membership-secret-with-more-than-32-characters';
process.env.UPSTASH_REDIS_REST_URL = 'https://redis.test.invalid';
process.env.UPSTASH_REDIS_REST_TOKEN = 'test-only';

const { sign, verify, cardToken, readCardToken } = require('../src/lib/membership/signing.ts');
const { parseVenmoEmail, normalizeNote, checkVenmo } = require('../src/lib/membership/venmo.ts');
const { readAnswers } = require('../src/lib/membership/members.ts');
const { cleanForm } = require('../src/lib/membership/form.ts');
const { newYearConfig } = require('../src/lib/membership/config.ts');
const { keys } = require('../src/lib/membership/keys.ts');
const store = require('../src/lib/membership/store.ts');

const YEAR = '2026-2027';

// An in-memory Redis that speaks the Upstash REST protocol, with only the commands the code uses.
const db = new Map();
function run([name, ...args]) {
  const cmd = String(name).toUpperCase();
  const hash = (key) => { if (!db.has(key)) db.set(key, new Map()); return db.get(key); };
  const set = (key) => { if (!db.has(key)) db.set(key, new Set()); return db.get(key); };
  switch (cmd) {
    case 'GET': return db.has(args[0]) ? db.get(args[0]) : null;
    case 'MGET': return args.map((k) => (db.has(k) ? db.get(k) : null));
    case 'SET': {
      const [key, value, ...flags] = args;
      if (flags.map(String).includes('NX') && db.has(key)) return null;
      db.set(key, String(value));
      return 'OK';
    }
    case 'DEL': return args.filter((k) => db.delete(k)).length;
    case 'EXISTS': return args.filter((k) => db.has(k)).length;
    case 'EVAL': {
      const [, , key, before, after] = args;
      if (db.get(key) !== before) return 0;
      db.set(key, after);
      return 1;
    }
    case 'SADD': return args.slice(1).filter((v) => !set(args[0]).has(v) && set(args[0]).add(v)).length;
    case 'SREM': return args.slice(1).filter((v) => set(args[0]).delete(v)).length;
    case 'SISMEMBER': return set(args[0]).has(args[1]) ? 1 : 0;
    case 'SCARD': return set(args[0]).size;
    case 'ZADD': hash(args[0]).set(args[2], Number(args[1])); return 1;
    case 'ZREM': return hash(args[0]).delete(args[1]) ? 1 : 0;
    case 'ZRANGE': return [...hash(args[0]).entries()].sort((a, b) => b[1] - a[1]).map(([member]) => member);
    case 'HSETNX': if (hash(args[0]).has(args[1])) return 0; hash(args[0]).set(args[1], args[2]); return 1;
    case 'HSET': hash(args[0]).set(args[1], args[2]); return 1;
    case 'HGET': return hash(args[0]).get(args[1]) ?? null;
    case 'HLEN': return hash(args[0]).size;
    case 'HGETALL': return [...hash(args[0]).entries()].flat();
    default: throw new Error(`The fake Redis does not support ${cmd}`);
  }
}

// Gmail messages by id, served to the Venmo check.
const gmail = new Map();
global.fetch = async (url, options = {}) => {
  const target = new URL(String(url));
  if (target.hostname === 'redis.test.invalid') {
    const body = JSON.parse(options.body);
    if (target.pathname === '/pipeline') return Response.json(body.map((command) => ({ result: run(command) })));
    return Response.json({ result: run(body) });
  }
  if (target.hostname === 'gmail.googleapis.com') {
    assert.equal(options.headers.Authorization, 'Bearer test-access-token');
    const id = target.pathname.split('/messages/')[1];
    if (!id) return Response.json({ messages: [...gmail.keys()].map((messageId) => ({ id: messageId })) });
    return Response.json(gmail.get(id));
  }
  throw new Error(`Unexpected request to ${target.hostname}`);
};

function venmoEmail(id, { note, amount = '$8.00', auth = 'mx.google.com; dkim=pass header.i=@venmo.com header.s=yzlavq3ml4jl4lt6dltbgmnoftxftkly' }) {
  const html = `<html><body><p class="transaction-note">${note}</p></body></html>`;
  return {
    id,
    payload: {
      mimeType: 'multipart/alternative',
      headers: [
        { name: 'Authentication-Results', value: auth },
        { name: 'Subject', value: `Jamie Chen paid you ${amount}` },
      ],
      parts: [
        { mimeType: 'text/plain', body: { data: Buffer.from('plain').toString('base64url') } },
        { mimeType: 'text/html', body: { data: Buffer.from(html).toString('base64url') } },
      ],
    },
  };
}

function member(kerb, overrides = {}) {
  return {
    year: YEAR, kerb, name: kerb, classYear: '2029', dorm: 'Baker', answers: {}, type: 'new', price: 8, method: 'venmo',
    status: 'unpaid', reportedAt: null, paidAt: null, paidVia: null, confirmedBy: null, venmoMessageId: null, wallet: null,
    createdAt: Date.now(), ...overrides,
  };
}

beforeEach(() => {
  db.clear();
  gmail.clear();
});

test('signed values reject tampering, the wrong purpose, and expiry', () => {
  const token = sign('member', { kerb: 'jchen' }, 60_000);
  assert.equal(verify('member', token).kerb, 'jchen');
  assert.equal(verify('oauth', token), null, 'A token for one purpose must not work for another');
  const [payload, signature] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ kerb: 'admin', exp: Date.now() + 60_000 })).toString('base64url');
  assert.equal(verify('member', `${forged}.${signature}`), null);
  assert.equal(verify('member', `${payload}.${signature}.extra`), null);
  assert.equal(verify('member', sign('member', { kerb: 'jchen' }, -1)), null);
  assert.equal(verify('member', undefined), null);
});

test('card tokens are short, verifiable, and bound to the kerb and year', () => {
  const token = cardToken(YEAR, 'jchen');
  assert.match(token, /^CSC1\.2026\.jchen\.[A-Za-z0-9_-]{16}$/);
  assert.deepEqual(readCardToken(` ${token} `), { startYear: '2026', kerb: 'jchen' });
  assert.equal(readCardToken(token.replace('jchen', 'plau')), null);
  assert.equal(readCardToken(token.replace('2026', '2025')), null);
  assert.equal(readCardToken('https://example.com'), null);
});

test('signing fails closed without a long secret', () => {
  const saved = process.env.MEMBERSHIP_SECRET;
  try {
    process.env.MEMBERSHIP_SECRET = 'short';
    assert.throws(() => cardToken(YEAR, 'jchen'), (e) => e.status === 503);
  } finally {
    process.env.MEMBERSHIP_SECRET = saved;
  }
});

test('Venmo emails confirm only with a Venmo DKIM pass and the exact note', () => {
  assert.deepEqual(parseVenmoEmail(venmoEmail('m1', { note: 'CSC 2026-2027 membership &#8211; JChen' })), { messageId: 'm1', amount: 8, year: YEAR, kerb: 'jchen' });
  assert.equal(parseVenmoEmail(venmoEmail('m2', { note: 'CSC 2026-2027 membership - jchen', auth: 'mx.google.com; dkim=pass header.d=evil.example' })), null);
  assert.equal(parseVenmoEmail(venmoEmail('m3', { note: 'CSC 2026-2027 membership - jchen', auth: 'mx.google.com; dkim=fail header.i=@venmo.com' })), null);
  assert.equal(parseVenmoEmail(venmoEmail('m4', { note: 'membership for jchen' })), null);
  assert.equal(parseVenmoEmail(venmoEmail('m5', { note: 'CSC 2026-2027 membership - jchen and plau' })), null);
  assert.equal(parseVenmoEmail(venmoEmail('m6', { note: 'CSC 2026-2027 membership - jchen', amount: '$1,008.50' })).amount, 1008.5);
  assert.equal(normalizeNote('  CSC 2026-2027   Membership—jchen '), 'csc 2026-2027 membership - jchen');
});

test('readAnswers keeps known answers and rejects bad input', () => {
  const config = newYearConfig(YEAR, null);
  config.form.questions.push(
    { id: 'food', label: 'Favorite food', type: 'checkboxes', required: false, options: ['Boba', 'Hotpot'] },
    { id: 'shirt', label: 'Shirt size', type: 'dropdown', required: true, options: ['S', 'M', 'L'] },
  );
  const good = {
    answers: { kerb: ' JChen@mit.edu ', name: '  Jamie   Chen ', classYear: '2029', dorm: 'Other', notes: 'hi', food: ['Boba', 'Pizza', 'Boba'], shirt: 'M', admin: 'yes' },
    other: { dorm: 'Off campus' },
  };
  assert.deepEqual(readAnswers(config, good), {
    kerb: 'jchen', name: 'Jamie Chen', classYear: '2029', dorm: 'Off campus', answers: { notes: 'hi', food: ['Boba'], shirt: 'M' },
  });
  assert.throws(() => readAnswers(config, { ...good, answers: { ...good.answers, kerb: 'not a kerb!' } }), /kerb/);
  assert.throws(() => readAnswers(config, { ...good, answers: { ...good.answers, shirt: 'XXL' } }), /Shirt size/);
  assert.throws(() => readAnswers(config, { ...good, other: {} }), /Where do you live/);
  assert.throws(() => readAnswers(config, { ...good, answers: { ...good.answers, name: '' } }), /Full name/);
});

test('cleanForm keeps built-in questions first and validates the rest', () => {
  const current = newYearConfig(YEAR, null).form;
  const reversed = [...current.questions].reverse();
  reversed[0] = { ...reversed[0], label: 'Anything else?' };
  const cleaned = cleanForm({
    ...current,
    questions: [
      ...reversed.map((q) => (q.builtin === 'name' ? { ...q, type: 'checkboxes', label: 'Your name' } : q)),
      { id: 'fake-kerb', label: 'Kerb again', type: 'short', required: true, builtin: 'kerb' },
      { id: 'pick', label: 'Pick', type: 'multiple', required: false, options: ['A', ' A ', '', 'B'] },
    ],
    calendarUrl: 'calendar.google.com/x',
    instagram: '@mitcsc',
  }, current);
  assert.deepEqual(cleaned.questions.slice(0, 4).map((q) => q.builtin), ['kerb', 'name', 'classYear', 'dorm']);
  assert.equal(cleaned.questions[1].type, 'short', 'Built-in questions keep their type');
  assert.equal(cleaned.questions[1].label, 'Your name');
  assert.deepEqual(cleaned.questions.slice(4).map((q) => q.id), ['notes', 'pick']);
  assert.equal(cleaned.questions[4].label, 'Anything else?');
  assert.deepEqual(cleaned.questions[5].options, ['A', 'B']);
  assert.equal(cleaned.calendarUrl, 'https://calendar.google.com/x');
  assert.equal(cleaned.instagram, 'mitcsc');
  assert.throws(() => cleanForm({ ...current, calendarUrl: 'http://example.com' }, current), /https/);
  assert.throws(() => cleanForm({ ...current, questions: [{ id: 'x', label: 'X', type: 'dropdown', required: false, options: [] }] }, current), /option/);
  assert.throws(() => cleanForm({ ...current, questions: [{ id: 'x', label: ' ', type: 'short', required: false }] }, current), /title/);
});

test('a kerb can sign up once, and check-in records the first scan', async () => {
  assert.equal(await store.claimMember(member('jchen')), true);
  assert.equal(await store.claimMember(member('jchen', { name: 'Someone else' })), false);
  assert.equal((await store.getMember(YEAR, 'jchen')).name, 'jchen');
  await store.claimMember(member('plau', { createdAt: Date.now() + 1 }));
  assert.deepEqual((await store.listMembers(YEAR)).map((m) => m.kerb), ['plau', 'jchen']);

  const first = { kerb: 'jchen', name: 'Jamie', classYear: '2029', paid: true, at: 1, by: 'a@mit.edu' };
  assert.equal((await store.checkIn('e1', first)).added, true);
  const second = await store.checkIn('e1', { ...first, at: 2, by: 'b@mit.edu' });
  assert.equal(second.added, false);
  assert.equal(second.record.by, 'a@mit.edu');
  assert.equal(await store.attendanceCount('e1'), 1);

  await assert.rejects(store.updateMember(YEAR, 'nobody', (m) => m), (e) => e.status === 404);
});

test('the Venmo check confirms each payment once and only for the right amount', async () => {
  db.set(keys.google, JSON.stringify({ email: 'club@example.invalid', refreshToken: 'r', scopes: [], connectedAt: 0, connectedBy: 'x', brokenAt: null, accessToken: 'test-access-token', accessTokenExpiresAt: Date.now() + 60_000 }));
  const config = newYearConfig(YEAR, null);
  await store.claimMember(member('jchen'));
  await store.claimMember(member('plau'));
  await store.claimMember(member('rtan', { price: 6, type: 'returning' }));
  gmail.set('a', venmoEmail('a', { note: 'CSC 2026-2027 membership - jchen' }));
  gmail.set('b', venmoEmail('b', { note: 'CSC 2026-2027 membership - jchen' }));
  gmail.set('c', venmoEmail('c', { note: 'CSC 2026-2027 membership - plau', amount: '$5.00' }));
  gmail.set('d', venmoEmail('d', { note: 'CSC 2026-2027 membership - rtan', auth: 'dkim=pass header.d=evil.example' }));
  gmail.set('e', venmoEmail('e', { note: 'CSC 2025-2026 membership - rtan' }));

  const result = await checkVenmo(config);
  assert.deepEqual(result, { ran: true, confirmed: ['jchen'] });
  const jamie = await store.getMember(YEAR, 'jchen');
  assert.equal(jamie.status, 'paid');
  assert.equal(jamie.venmoMessageId, 'a');
  assert.equal(jamie.confirmedBy, 'Venmo check');
  assert.equal((await store.getMember(YEAR, 'plau')).status, 'unpaid', 'An underpayment must not confirm');
  assert.equal((await store.getMember(YEAR, 'rtan')).status, 'unpaid', 'A forged or old email must not confirm');
  assert.equal(await store.hasPaidBefore('jchen'), true);
  assert.equal(db.get(keys.venmoMessage('b')), undefined, 'A second email for a paid member stays free for later');
  assert.equal(db.get(keys.venmoMessage('d')), '-');

  assert.deepEqual(await checkVenmo(config), { ran: false, confirmed: [] }, 'Checks closer than the minimum gap do nothing');
});
