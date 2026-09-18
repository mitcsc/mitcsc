/* eslint-disable @typescript-eslint/no-require-imports */
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true},
}).outputText, filename);
const {keepAlive} = require('../src/lib/voting/keepalive.ts');
const {redisKey} = require('../src/lib/voting/redis.ts');
const request = token => new Request('https://example.invalid/api/cron/redis-health', {headers: token ? {authorization:`Bearer ${token}`} : {}});

test('health check fails closed, uses bounded jitter, and writes only its own key', async()=>{
 const originalFetch=global.fetch;
 const saved={...process.env};
 const commands=[]; const delays=[];
 global.fetch=async(url,options)=>{
   assert.equal(url,'https://redis.test.invalid');
   commands.push(JSON.parse(options.body));
   return Response.json({result:'OK'});
 };
 try {
   delete process.env.CRON_SECRET;
   assert.equal((await keepAlive(request())).status,503);
   process.env.CRON_SECRET='test-cron-secret';
   assert.equal((await keepAlive(request())).status,401);
   assert.equal((await keepAlive(request('wrong'))).status,401);
   assert.equal(commands.length,0,'Unauthorized requests must not touch Redis');
   process.env.UPSTASH_REDIS_REST_URL='https://redis.test.invalid';
   process.env.UPSTASH_REDIS_REST_TOKEN='test-only';
   const response=await keepAlive(request('test-cron-secret'),async ms=>delays.push(ms));
   assert.equal(response.status,200);
   assert.deepEqual(await response.json(),{ok:true});
   assert.equal(delays.length,1); assert.ok(delays[0]>=0 && delays[0]<=5000);
   assert.equal(commands.length,1);
   assert.deepEqual(commands[0].slice(0,2),['SET',redisKey('health-check')]);
   assert.ok(Number.isFinite(Date.parse(commands[0][2])));
   global.fetch=async()=>{throw new Error('secret provider details');};
   const failure=await keepAlive(request('test-cron-secret'),async()=>{});
   assert.equal(failure.status,503);
   assert.equal((await failure.text()).includes('secret provider'),false);
 } finally {global.fetch=originalFetch;process.env=saved;}
});
