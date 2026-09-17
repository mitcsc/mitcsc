/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, filename);
};
process.env.VOTING_COOKIE_SECRET = 'unit-test-only-secret-that-is-at-least-32-characters';
const { signIdentity, readIdentity, requireOrigin, limitJoin } = require('./security.ts');
const { authorize, validateRatings, settings } = require('./service.ts');
const data = { role: 'voter', name: 'Alex', sessionId: 'fall', sheetId: 'election-sheet' };
const config = { sessionId: 'fall', sheetId: 'election-sheet', password: 'new password' };
test('signed cookies reject tampering and remain admitted after password rotation', () => {
  const signed = signIdentity(data);
  const identity = readIdentity(signed);
  assert.equal(identity.name, 'Alex');
  assert.equal(authorize(identity, config), identity);
  const [payload, signature] = signed.split('.');
  const changed = Buffer.from(JSON.stringify({ ...identity, role: 'admin' })).toString('base64url');
  assert.equal(readIdentity(`${changed}.${signature}`), null);
  assert.equal(readIdentity(`${payload}.bogus`), null);
  assert.throws(() => authorize(identity, { ...config, sessionId: 'spring' }), /password/);
  assert.throws(() => authorize(identity, { ...config, sheetId: 'other' }), /password/);
  assert.throws(() => authorize(identity, config, true), /Admin/);
});
test('mutation origin must match the application origin', () => {
  assert.doesNotThrow(() => requireOrigin(new Request('https://club.test/api/voting/submit', { headers: { origin: 'https://club.test' } })));
  assert.throws(() => requireOrigin(new Request('https://club.test/api/voting/submit', { headers: { origin: 'https://attacker.test' } })), /origin/);
  assert.throws(() => requireOrigin(new Request('https://club.test/api/voting/submit')), /origin/);
});
test('ratings enforce original criterion IDs, required fields, integer scale and optional abstention', () => {
  const criteria = [{ id: 'fit', label: 'Fit', min: 1, max: 5, required: true }, { id: 'experience', label: 'Experience', min: 0, max: 3, required: false }];
  assert.doesNotThrow(() => validateRatings({ fit: 5, experience: null }, criteria));
  for (const ratings of [{ fit: 6 }, { fit: 1.5 }, { fit: null }, { fit: 1, extra: 3 }, { fit: '3' }, {}]) assert.throws(() => validateRatings(ratings, criteria));
});
test('successful joins on shared Wi-Fi do not consume failed-password budget', () => {
  const request = new Request('https://club.test/api/voting/join', { headers: { 'x-forwarded-for': 'test-shared-wifi' } });
  for (let i = 0; i < 100; i++) limitJoin(request);
  for (let i = 0; i < 29; i++) limitJoin(request, true);
  assert.throws(() => limitJoin(request, true), /Too many/);
});

test('first concurrent join is sole facilitator; later joins vote; reset revokes and permits reclaim', async () => {
  const { GoogleAuth } = require('google-auth-library');
  const { claimIdentity, canonicalIdentity } = require('./facilitator.ts');
  const originalClient = GoogleAuth.prototype.getClient;
  const originalFetch = global.fetch;
  const keys = ['VOTING_SETTINGS_SHEET_ID', 'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY'];
  const originalEnv = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const rows = [['session_id', 'election_sheet_id', 'reset', 'claim_id', 'voter_id', 'voter_name', 'claimed_at']];
  try {
    process.env.VOTING_SETTINGS_SHEET_ID = 'test-first-join-settings';
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'test@example.invalid';
    process.env.GOOGLE_PRIVATE_KEY = 'mock';
    GoogleAuth.prototype.getClient = async () => ({ getAccessToken: async () => ({ token: 'mock' }) });
    global.fetch = async (url, init) => {
      if (url.includes('?fields=')) return Response.json({ sheets: [{ properties: { title: 'Admins' } }] });
      if (url.includes(':batchGet')) return Response.json({ valueRanges: [{ values: [
        ['session_id', 'fall'], ['session_password', 'shared-password'],
        ['voting_sheet_url', 'https://docs.google.com/spreadsheets/d/test-election-sheet/edit'],
        ['admin_password', 'malicious-sheet-password'],
      ] }] });
      if (init.method === 'POST' && url.includes(':append')) {
        rows.push(...JSON.parse(init.body).values);
        return Response.json({ updates: { updatedRange: `Admins!A${rows.length}:G${rows.length}` } });
      }
      if (url.includes('Admins')) return Response.json({ values: rows });
      throw new Error(`Unexpected request ${url}`);
    };
    const config = await settings();
    assert.equal(config.adminPassword, undefined, 'sheet cannot assign an admin password');
    assert.equal(config.facilitatorReset, '');
    const joined = await Promise.all([claimIdentity(config, 'First', null), claimIdentity(config, 'Second', null)]);
    assert.equal(joined.filter(person => person.role === 'admin').length, 1);
    const owner = joined.find(person => person.role === 'admin');
    const voter = joined.find(person => person.role === 'voter');
    assert.equal(owner.claimId, rows[1][3]);
    assert.equal((await canonicalIdentity(config, owner)).role, 'admin');
    assert.equal((await canonicalIdentity(config, { ...voter, role: 'admin' })).role, 'voter');
    const before = rows.length;
    assert.equal((await claimIdentity(config, 'First', owner)).id, owner.id);
    assert.equal(rows.length, before, 'same browser rejoin does not append');
    const reset = { ...config, facilitatorReset: 'new-recovery-epoch' };
    assert.equal((await canonicalIdentity(reset, owner)).role, 'voter');
    const reclaimed = await claimIdentity(reset, owner.name, owner);
    assert.equal(reclaimed.role, 'admin');
    assert.equal(reclaimed.id, owner.id, 'reset preserves ballot ownership');
  } finally {
    GoogleAuth.prototype.getClient = originalClient;
    global.fetch = originalFetch;
    for (const key of keys) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  }
});
test('existing Google credential can sign session cookies without a new environment variable', () => {
  const oldSecret = process.env.VOTING_COOKIE_SECRET;
  const oldKey = process.env.GOOGLE_PRIVATE_KEY;
  try {
    delete process.env.VOTING_COOKIE_SECRET;
    process.env.GOOGLE_PRIVATE_KEY = 'test-private-key';
    const signed = signIdentity(data);
    assert.equal(readIdentity(signed).name, 'Alex');
    process.env.GOOGLE_PRIVATE_KEY = 'changed-key';
    assert.equal(readIdentity(signed), null);
  } finally {
    if (oldSecret === undefined) delete process.env.VOTING_COOKIE_SECRET;
    else process.env.VOTING_COOKIE_SECRET = oldSecret;
    if (oldKey === undefined) delete process.env.GOOGLE_PRIVATE_KEY;
    else process.env.GOOGLE_PRIVATE_KEY = oldKey;
  }
});
