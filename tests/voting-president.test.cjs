/* eslint-disable @typescript-eslint/no-require-imports */
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true},
}).outputText, filename);
const {presidentLogin,requirePresident} = require('../src/lib/voting/president.ts');
const {readIdentity} = require('../src/lib/voting/security.ts');
test('president credentials are required, purpose scoped and revoked by password rotation',()=>{
 process.env.VOTING_COOKIE_SECRET='a-test-signing-key-with-more-than-32-characters';
 delete process.env.VOTING_PRESIDENT_PASSWORD;
 assert.throws(()=>presidentLogin('anything'),e=>e.status===503);
 process.env.VOTING_PRESIDENT_PASSWORD='a-random-president-password';
 assert.throws(()=>presidentLogin('incorrect'),e=>e.status===401);
 const token=presidentLogin(process.env.VOTING_PRESIDENT_PASSWORD);
 requirePresident(token);
 assert.equal(readIdentity(token),null,'President token cannot be used as a voter token');
 process.env.VOTING_PRESIDENT_PASSWORD='a-different-president-password';
 assert.throws(()=>requirePresident(token),e=>e.status===401);
});
