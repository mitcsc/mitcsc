/* eslint-disable @typescript-eslint/no-require-imports */
/* Run: npm run test:exec */
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, filename);

process.env.UPSTASH_REDIS_REST_URL = 'https://redis.test.invalid';
process.env.UPSTASH_REDIS_REST_TOKEN = 'test-only';

const exec = require('../src/lib/exec.ts');
const { keys } = require('../src/lib/membership/keys.ts');
const { current: configCurrent } = require('../src/config/exec/current.ts');
const { alumni: configAlumni } = require('../src/config/exec/alumni.ts');

// An in-memory Redis behind the Upstash REST protocol, with only the commands this code uses.
const db = new Map();
function run([name, ...args]) {
  switch (String(name).toUpperCase()) {
    case 'GET': return db.has(args[0]) ? db.get(args[0]) : null;
    case 'SET': {
      const [key, value, ...flags] = args;
      if (flags.map(String).includes('NX') && db.has(key)) return null;
      db.set(key, String(value));
      return 'OK';
    }
    case 'EVAL': {
      const [, , key, before, after] = args;
      if (db.get(key) !== before) return 0;
      db.set(key, after);
      return 1;
    }
    default: throw new Error(`The fake Redis does not support ${name}`);
  }
}

// A fake Drive with one folder path, "MIT CSC" › "Website" › "Exec Photos", and the website's photo files.
let drive;
const fetched = [];
function freshDrive() {
  drive = { folders: [{ id: 'club', name: 'MIT CSC', parent: 'root' }, { id: 'web', name: 'Website', parent: 'club' }], files: [], uploads: [], next: 1 };
}
global.fetch = async (url, options = {}) => {
  const target = new URL(String(url));
  if (target.hostname === 'redis.test.invalid') {
    const body = JSON.parse(options.body);
    if (target.pathname === '/pipeline') return Response.json(body.map((command) => ({ result: run(command) })));
    return Response.json({ result: run(body) });
  }
  if (target.hostname === 'csc.test.invalid') {
    fetched.push(target.pathname);
    return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/jpeg' } });
  }
  if (target.hostname === 'www.googleapis.com' && target.pathname === '/upload/drive/v3/files') {
    assert.equal(options.headers.Authorization, 'Bearer test-access-token');
    assert.equal(target.searchParams.get('uploadType'), 'multipart');
    const boundary = options.headers['Content-Type'].match(/boundary=(.+)$/)[1];
    const text = Buffer.from(options.body).toString('latin1');
    const meta = JSON.parse(text.split(`--${boundary}`)[1].split('\r\n\r\n')[1]);
    const file = { id: `f${drive.next++}`, name: meta.name, parent: meta.parents[0], mimeType: 'image/jpeg', version: '1', createdTime: new Date().toISOString() };
    drive.files.push(file);
    drive.uploads.push(meta.name);
    return Response.json(file);
  }
  if (target.hostname === 'www.googleapis.com' && target.pathname === '/drive/v3/files') {
    if (options.method === 'POST') {
      const body = JSON.parse(options.body);
      const folder = { id: `d${drive.next++}`, name: body.name, parent: body.parents[0] };
      drive.folders.push(folder);
      return Response.json({ ...folder, mimeType: 'application/vnd.google-apps.folder' });
    }
    const q = target.searchParams.get('q');
    const parent = q.match(/^'([^']+)' in parents/)[1];
    if (q.includes("mimeType contains 'image/'")) return Response.json({ files: drive.files.filter((f) => f.parent === parent) });
    const name = q.match(/name = '([^']+)'/)?.[1];
    const parentId = parent === 'root' ? 'root' : parent;
    return Response.json({ files: drive.folders.filter((f) => f.parent === parentId && (!name || f.name === name)).map((f) => ({ ...f, mimeType: 'application/vnd.google-apps.folder' })) });
  }
  throw new Error(`Unexpected request to ${target.hostname}${target.pathname}`);
};

const person = (name, position = 'President') => ({ name, position, classYear: '2028', hometown: 'Boston, MA', photoId: null });

async function emptyRoster() {
  db.set(keys.execRoster, JSON.stringify({ current: [], alumni: [], roles: ['President', 'Historian'] }));
}

beforeEach(() => {
  db.clear();
  fetched.length = 0;
  freshDrive();
  db.set(keys.google, JSON.stringify({ email: 'club@example.invalid', refreshToken: 'r', scopes: [], connectedAt: 0, connectedBy: 'x', brokenAt: null, accessToken: 'test-access-token', accessTokenExpiresAt: Date.now() + 60_000 }));
});

test('Copying from the website keeps the order, uploads each photo once, and runs only once', async () => {
  const counts = await exec.copyRosterFromWebsite('https://csc.test.invalid', true);
  assert.deepEqual(counts, { current: configCurrent.length, alumni: configAlumni.length });
  const roster = await exec.execRoster();
  assert.deepEqual(roster.current.map((p) => p.name), configCurrent.map((p) => p.name));
  assert.deepEqual(roster.alumni.map((p) => p.name), configAlumni.map((p) => p.name));
  assert.ok(roster.current.every((p) => p.photo), 'every current exec has a photo');
  assert.equal(drive.uploads.length, configCurrent.length + configAlumni.length);
  assert.equal(drive.folders.at(-1).name, 'Exec Photos');
  // The roles start as the positions on the website, current exec first.
  assert.equal(roster.roles[0], configCurrent[0].position);
  assert.equal(new Set(roster.roles).size, roster.roles.length);
  await assert.rejects(exec.copyRosterFromWebsite('https://csc.test.invalid', true), /already in the dashboard/);
});

test('A copy that stopped partway reuses the photos already in Drive', async () => {
  await exec.copyRosterFromWebsite('https://csc.test.invalid', true);
  const uploaded = drive.uploads.length;
  db.delete(keys.execRoster);
  await exec.copyRosterFromWebsite('https://csc.test.invalid', true);
  assert.equal(drive.uploads.length, uploaded, 'no photo uploaded twice');
});

test('Without Google, the copy brings the people without photos', async () => {
  await exec.copyRosterFromWebsite('https://csc.test.invalid', false);
  const roster = await exec.execRoster();
  assert.equal(roster.current.length, configCurrent.length);
  assert.ok(roster.current.every((p) => p.photo === null));
  assert.equal(fetched.length, 0);
});

test('Moving someone to alumni puts them on top, and Undo puts them back in their place', async () => {
  await emptyRoster();
  for (const name of ['Ann', 'Bo', 'Cy']) await exec.savePerson('current', null, person(name));
  await exec.savePerson('alumni', null, person('Old'));
  const bo = (await exec.execRoster()).current[1];
  const from = await exec.movePerson(bo.id, 'alumni');
  assert.deepEqual(from, { list: 'current', index: 1 });
  let roster = await exec.execRoster();
  assert.deepEqual(roster.current.map((p) => p.name), ['Ann', 'Cy']);
  assert.deepEqual(roster.alumni.map((p) => p.name), ['Bo', 'Old']);
  await exec.movePerson(bo.id, from.list, from.index);
  roster = await exec.execRoster();
  assert.deepEqual(roster.current.map((p) => p.name), ['Ann', 'Bo', 'Cy']);
  assert.deepEqual(roster.alumni.map((p) => p.name), ['Old']);
  // Moving back to current exec without a place adds them at the end.
  const old = roster.alumni[0];
  await exec.movePerson(old.id, 'current');
  assert.deepEqual((await exec.execRoster()).current.map((p) => p.name), ['Ann', 'Bo', 'Cy', 'Old']);
});

test('Reordering keeps people added meanwhile, and positions must be roles', async () => {
  await emptyRoster();
  for (const name of ['Ann', 'Bo', 'Cy']) await exec.savePerson('current', null, person(name));
  const [ann, bo, cy] = (await exec.execRoster()).current;
  await exec.savePerson('current', null, person('New'));
  await exec.reorderRoster('current', [cy.id, ann.id, bo.id]);
  assert.deepEqual((await exec.execRoster()).current.map((p) => p.name), ['Cy', 'Ann', 'Bo', 'New']);
  await assert.rejects(exec.savePerson('current', null, person('X', 'Made Up')), /not a role/);
  await assert.rejects(exec.savePerson('current', null, { ...person('X'), classYear: '28' }), /four digits/);
});

test('Renaming a role renames it for current exec only, and a role in use cannot be removed', async () => {
  await emptyRoster();
  await exec.savePerson('current', null, person('Ann', 'Historian'));
  await exec.savePerson('alumni', null, person('Old', 'Historian'));
  await exec.renameRole('Historian', 'Archivist');
  let roster = await exec.execRoster();
  assert.deepEqual(roster.roles, ['President', 'Archivist']);
  assert.equal(roster.current[0].position, 'Archivist');
  assert.equal(roster.alumni[0].position, 'Historian', 'alumni keep the name they held it under');
  // An alumnus can be saved with their old position, which is no longer a role.
  await exec.savePerson('alumni', roster.alumni[0].id, person('Old Two', 'Historian'));
  await assert.rejects(exec.removeRole('Archivist'), /Ann has this role/);
  await assert.rejects(exec.addRole('president'.replace('p', 'P')), /already a role/);
  await exec.addRole('Social Chair');
  await exec.reorderRoles(['Social Chair', 'President', 'Archivist']);
  await exec.removeRole('President');
  roster = await exec.execRoster();
  assert.deepEqual(roster.roles, ['Social Chair', 'Archivist']);
});

test('An uploaded photo goes into the Exec Photos folder, made if missing, and can be picked', async () => {
  await emptyRoster();
  const photo = await exec.uploadExecPhoto('ann.jpg', 'image/jpeg', new Uint8Array([1, 2, 3]));
  assert.equal(photo.name, 'ann.jpg');
  assert.equal(drive.folders.at(-1).name, 'Exec Photos');
  const saved = await exec.savePerson('current', null, { ...person('Ann'), photoId: photo.id });
  assert.equal(saved.photo.id, photo.id);
  assert.equal(await exec.isRosterPhoto(photo.id), true);
  await assert.rejects(exec.savePerson('current', null, { ...person('Bo'), photoId: 'gone' }), /no longer in the Exec Photos folder/);
  await assert.rejects(exec.uploadExecPhoto('notes.txt', 'text/plain', new Uint8Array([1])), /image file/);
});
