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
const { authorize, validateRatings } = require('./service.ts');
const data = { role: 'voter', name: 'Alex', sessionId: 'fall', sheetId: 'election-sheet' };
const config = { sessionId: 'fall', sheetId: 'election-sheet', password: 'new password', adminPassword: 'secret' };
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
  assert.throws(() => authorize(identity, config, true), /Facilitator/);
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
