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
const { newYearConfig, canStartNextYear, formTitle, carryForm } = require('../src/lib/membership/config.ts');
const { keys } = require('../src/lib/membership/keys.ts');
const store = require('../src/lib/membership/store.ts');
const { walletButtons } = require('../src/lib/membership/wallet.ts');
const { renameFile, trashFile } = require('../src/lib/membership/google/drive.ts');
const { redeemCardLink } = require('../src/lib/membership/card-link.ts');

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
    case 'GETDEL': { const value = db.has(args[0]) ? db.get(args[0]) : null; db.delete(args[0]); return value; }
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
    case 'SUNION': return [...new Set(args.flatMap((k) => [...set(k)]))];
    case 'ZADD': hash(args[0]).set(args[2], Number(args[1])); return 1;
    case 'ZREM': return hash(args[0]).delete(args[1]) ? 1 : 0;
    case 'ZRANGE': return [...hash(args[0]).entries()].filter(([, score]) => args[3] !== 'BYSCORE' || (score >= Number(args[1]) && score <= Number(args[2]))).sort((a, b) => b[1] - a[1]).map(([member]) => member);
    case 'HSETNX': if (hash(args[0]).has(args[1])) return 0; hash(args[0]).set(args[1], args[2]); return 1;
    case 'HSET': hash(args[0]).set(args[1], args[2]); return 1;
    case 'HGET': return hash(args[0]).get(args[1]) ?? null;
    case 'HLEN': return hash(args[0]).size;
    case 'HGETALL': return [...hash(args[0]).entries()].flat();
    case 'HDEL': return args.slice(1).filter((f) => hash(args[0]).delete(f)).length;
    default: throw new Error(`The fake Redis does not support ${cmd}`);
  }
}

// Gmail messages by id, served to the Venmo check, and the Drive changes the dashboard asked for.
const gmail = new Map();
const driveChanges = [];
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
  if (target.hostname === 'www.googleapis.com' && target.pathname.startsWith('/drive/v3/files/')) {
    assert.equal(options.headers.Authorization, 'Bearer test-access-token');
    driveChanges.push({ method: options.method, id: target.pathname.split('/files/')[1], body: JSON.parse(options.body) });
    return Response.json({ id: 'x' });
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
  assert.deepEqual(parseVenmoEmail(venmoEmail('m1', { note: 'CSC&#8211;2026-2027 &#8211; JChen' })), { messageId: 'm1', amount: 8, year: YEAR, kerb: 'jchen' });
  assert.equal(parseVenmoEmail(venmoEmail('m2', { note: 'CSC-2026-2027-jchen', auth: 'mx.google.com; dkim=pass header.d=evil.example' })), null);
  assert.equal(parseVenmoEmail(venmoEmail('m3', { note: 'CSC-2026-2027-jchen', auth: 'mx.google.com; dkim=fail header.i=@venmo.com' })), null);
  assert.equal(parseVenmoEmail(venmoEmail('m4', { note: 'membership for jchen' })), null);
  assert.equal(parseVenmoEmail(venmoEmail('m5', { note: 'CSC-2026-2027-jchen and plau' })), null);
  assert.equal(parseVenmoEmail(venmoEmail('m6', { note: 'CSC-2026-2027-jchen', amount: '$1,008.50' })).amount, 1008.5);
  assert.equal(normalizeNote('  CSC - 2026-2027—JChen '), 'csc-2026-2027-jchen');
  assert.equal(parseVenmoEmail(venmoEmail('m7', { note: 'CSC 2026-2027 membership - jchen' })), null);
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

test('The /join title defaults to "Join CSC <year>!" and follows the year forward', () => {
  const current = newYearConfig(YEAR, null).form;
  assert.equal(formTitle(current, YEAR), `Join CSC ${YEAR}!`, 'Years made before the title was editable have no title');
  assert.equal(formTitle(cleanForm({ ...current, title: '   ' }, current), YEAR), `Join CSC ${YEAR}!`);
  assert.equal(formTitle(cleanForm({ ...current, title: '  Join MIT CSC ' }, current), YEAR), 'Join MIT CSC');
  assert.equal(carryForm({ ...current, title: 'Join CSC 2026-2027 now' }, '2026-2027', '2027-2028').title, 'Join CSC 2027-2028 now');
  assert.equal(carryForm(current, '2026-2027', '2027-2028').title, undefined, 'An empty title stays empty and keeps following the year');
});

test('the next school year opens on May 1 in Boston', () => {
  assert.equal(canStartNextYear(YEAR, new Date('2026-10-13T12:00:00Z')), false);
  assert.equal(canStartNextYear(YEAR, new Date('2027-05-01T03:59:00Z')), false, 'Still April 30 in Boston');
  assert.equal(canStartNextYear(YEAR, new Date('2027-05-01T04:00:00Z')), true);
  assert.equal(canStartNextYear(YEAR, new Date('2028-09-01T12:00:00Z')), true);
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
  assert.equal(await store.undoCheckIn('e1', 'jchen'), true, 'A mistaken check-in can be taken back');
  assert.equal(await store.undoCheckIn('e1', 'jchen'), false);
  assert.equal(await store.attendanceCount('e1'), 0);
  assert.equal((await store.checkIn('e1', second.record)).added, true, 'They can be checked in again after an undo');

  await assert.rejects(store.updateMember(YEAR, 'nobody', (m) => m), (e) => e.status === 404);
});

test('Deleting an event removes it and its check-ins only', async () => {
  const make = (name, date) => store.createEvent({ year: YEAR, name, date, sheetId: null, sheetTab: 'Check-ins', createdBy: 'a@mit.edu' });
  const [keep, gone] = [await make('Keep', '2026-10-13'), await make('Gone', '2026-10-14')];
  assert.equal((await store.eventOn(YEAR, '2026-10-13')).name, 'Keep', 'Each day has at most one event');
  assert.equal(await store.eventOn(YEAR, '2026-10-15'), null);
  const record = { kerb: 'jchen', name: 'Jamie', classYear: '2029', paid: true, at: 1, by: 'a@mit.edu' };
  await store.checkIn(keep.id, record);
  await store.checkIn(gone.id, record);
  db.set(`${keys.sync(`event:${gone.id}`)}:status`, '{}');

  await store.deleteEvent(gone);
  assert.equal(await store.getEvent(gone.id), null);
  assert.equal(await store.attendanceCount(gone.id), 0);
  assert.equal(db.has(`${keys.sync(`event:${gone.id}`)}:status`), false);
  assert.deepEqual((await store.listEvents(YEAR)).map((e) => [e.event.name, e.count]), [['Keep', 1]]);
  assert.equal(await store.eventOn(YEAR, '2026-10-14'), null, 'A deleted event frees its day');
});

test('the Venmo check confirms each payment once and only for the right amount', async () => {
  db.set(keys.google, JSON.stringify({ email: 'club@example.invalid', refreshToken: 'r', scopes: [], connectedAt: 0, connectedBy: 'x', brokenAt: null, accessToken: 'test-access-token', accessTokenExpiresAt: Date.now() + 60_000 }));
  const config = newYearConfig(YEAR, null);
  await store.claimMember(member('jchen'));
  await store.claimMember(member('plau'));
  await store.claimMember(member('rtan', { price: 6, type: 'returning' }));
  gmail.set('a', venmoEmail('a', { note: 'CSC-2026-2027-jchen' }));
  gmail.set('b', venmoEmail('b', { note: 'CSC-2026-2027-jchen' }));
  gmail.set('c', venmoEmail('c', { note: 'CSC-2026-2027-plau', amount: '$5.00' }));
  gmail.set('d', venmoEmail('d', { note: 'CSC-2026-2027-rtan', auth: 'dkim=pass header.d=evil.example' }));
  gmail.set('e', venmoEmail('e', { note: 'CSC-2025-2026-rtan' }));

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

test('Wallet buttons match the device', () => {
  assert.deepEqual(walletButtons('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15'), ['apple']);
  assert.deepEqual(walletButtons('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15'), ['apple']);
  assert.deepEqual(walletButtons('Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36'), ['google']);
  assert.deepEqual(walletButtons('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'), ['apple', 'google']);
  assert.deepEqual(walletButtons(null), ['apple', 'google']);
});

test('A card link from the email works once', async () => {
  const id = 'A'.repeat(32);
  db.set(keys.cardLink(id), `${YEAR}:jchen`);
  assert.deepEqual(await redeemCardLink(id), { year: YEAR, kerb: 'jchen' });
  assert.equal(await redeemCardLink(id), null, 'A used link must not work again');
  assert.equal(await redeemCardLink('short'), null);
  assert.equal(await redeemCardLink(`${'B'.repeat(31)}*`), null);
});

test('Kerbs imported from old sheets and payments on this site both get the returning price', async () => {
  await store.markPaidEver(['paidhere', 'both']);
  run(['SADD', keys.pastImported, 'imported', 'both']);
  for (const kerb of ['paidhere', 'imported', 'both']) assert.equal(await store.hasPaidBefore(kerb), true, kerb);
  assert.equal(await store.hasPaidBefore('newperson'), false);
  assert.equal(await store.pastMemberCount(), 3);
});

test('Renaming or deleting an event renames its Google Sheet or moves it to the Drive trash', async () => {
  db.set(keys.google, JSON.stringify({ email: 'club@example.invalid', refreshToken: 'r', scopes: [], connectedAt: 0, connectedBy: 'x', brokenAt: null, accessToken: 'test-access-token', accessTokenExpiresAt: Date.now() + 60_000 }));
  driveChanges.length = 0;
  await renameFile('sheet1', 'Mooncake night');
  await trashFile('sheet1');
  assert.deepEqual(driveChanges, [
    { method: 'PATCH', id: 'sheet1', body: { name: 'Mooncake night' } },
    { method: 'PATCH', id: 'sheet1', body: { trashed: true } },
  ], 'The sheet is trashed, never deleted for good');
});
