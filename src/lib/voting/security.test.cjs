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
const { requireOrigin } = require('./security.ts');
const { authorize, validateRatings } = require('./service.ts');
const { resultRows, toCsv, exportFileName } = require('./export.ts');
const config = { sessionId: 'fall', name: 'Fall delibs', host: 'host@mit.edu', hostName: 'Host', open: true, createdAt: 0 };

test('identities only work in their own delib, and host actions need the host', () => {
  const voter = { id: 'v1', name: 'Alex', role: 'voter', sessionId: 'fall' };
  assert.equal(authorize(voter, config), voter);
  assert.throws(() => authorize(voter, { ...config, sessionId: 'spring' }), /Join the session/);
  assert.throws(() => authorize(null, config), /Join the session/);
  assert.throws(() => authorize(voter, config, true), /Only the host/);
  assert.doesNotThrow(() => authorize({ ...voter, role: 'admin' }, config, true));
});
test('mutation origin must match the application origin', () => {
  assert.doesNotThrow(() => requireOrigin(new Request('https://club.test/api/voting/submit', { headers: { origin: 'https://club.test' } })));
  assert.throws(() => requireOrigin(new Request('https://club.test/api/voting/submit', { headers: { origin: 'https://attacker.test' } })), /origin/);
  assert.throws(() => requireOrigin(new Request('https://club.test/api/voting/submit')), /origin/);
  assert.doesNotThrow(() => requireOrigin(new Request('http://localhost:3000/api/voting/submit', { headers: { origin: 'http://127.0.0.1:3000', host: '127.0.0.1:3000' } })));
  assert.throws(() => requireOrigin(new Request('http://localhost:3000/api/voting/submit', { headers: { origin: 'https://attacker.test', host: '127.0.0.1:3000' } })), /origin/);
  assert.throws(() => requireOrigin(new Request('https://club.test/api/voting/submit', { headers: { origin: 'null' } })), /origin/);
});
test('ratings enforce original criterion IDs, required fields, integer scale and optional abstention', () => {
  const criteria = [{ id: 'fit', label: 'Fit', min: 1, max: 5, required: true }, { id: 'experience', label: 'Experience', min: 0, max: 3, required: false }];
  assert.doesNotThrow(() => validateRatings({ fit: 5, experience: null }, criteria));
  for (const ratings of [{ fit: 6 }, { fit: 1.5 }, { fit: null }, { fit: 1, extra: 3 }, { fit: '3' }, {}]) assert.throws(() => validateRatings(ratings, criteria));
});
test('the CSV has one row per vote with no gaps, and cannot run formulas', () => {
  const results = {
    sessionId: 'fall', name: 'Fall: delibs/1', ended: true, voterCount: 2,
    criteria: [{ id: 'fit', label: 'Fit' }, { id: 'drive', label: 'Drive, "grit"' }],
    candidates: [
      { candidate: { name: '=HYPERLINK("x")' }, ballots: [
        { voterName: 'Alex', initial: { fit: 3, drive: null }, final: { fit: 4, drive: 2 }, submittedAt: '2026-10-14T16:00:00.000Z' },
        { voterName: 'Sam', initial: { fit: 5, drive: 5 }, final: { fit: 5, drive: null }, submittedAt: '2026-10-14T16:01:00.000Z' },
      ] },
      { candidate: { name: 'No votes' }, ballots: [] },
      { candidate: { name: 'Bo' }, ballots: [{ voterName: '@Lee', initial: { fit: 1, drive: 1 }, final: { fit: 2, drive: 1 }, submittedAt: '2026-10-14T16:02:00.000Z' }] },
    ],
  };
  const rows = resultRows(results);
  assert.deepEqual(rows[0], ['Candidate', 'Voter', 'Fit', 'Drive, "grit"', 'Fit (initial)', 'Drive, "grit" (initial)', 'Submitted']);
  assert.equal(rows.length, 4, 'one header and one row per vote');
  assert.deepEqual(rows[1].slice(0, 6), ['=HYPERLINK("x")', 'Alex', '4', '2', '3', '']);
  assert.equal(rows[1][6], '10/14/2026, 12:00:00 PM', 'times use the club time zone');
  const csv = toCsv(rows).split('\r\n');
  assert.equal(csv[0], 'Candidate,Voter,Fit,"Drive, ""grit""",Fit (initial),"Drive, ""grit"" (initial)",Submitted');
  assert.ok(csv[1].startsWith(`"'=HYPERLINK(""x"")",Alex,4,2,3,,`));
  assert.ok(csv[3].startsWith("Bo,'@Lee,2,1,1,1,"));
  assert.equal(exportFileName('Fall: delibs/1'), 'Fall delibs1.csv');
  assert.equal(exportFileName('///'), 'Delibs.csv');
});
