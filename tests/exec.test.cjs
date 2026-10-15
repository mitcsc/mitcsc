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

// A fake Drive with the club's "MIT CSC" › "Website" folders.
let drive;
function freshDrive() {
  drive = { folders: [{ id: 'club', name: 'MIT CSC', parent: 'root' }, { id: 'web', name: 'Website', parent: 'club' }], files: [], uploads: [], moves: [], next: 1 };
}
const asDrive = ({ parent, ...file }) => ({ ...file, parents: [parent], trashed: false });
const folderNamed = (name) => drive.folders.find((f) => f.name === name);
const folderOf = (id) => drive.folders.find((f) => f.id === drive.files.find((file) => file.id === id).parent).name;
global.fetch = async (url, options = {}) => {
  const target = new URL(String(url));
  if (target.hostname === 'redis.test.invalid') {
    const body = JSON.parse(options.body);
    if (target.pathname === '/pipeline') return Response.json(body.map((command) => ({ result: run(command) })));
    return Response.json({ result: run(body) });
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
    return Response.json(asDrive(file));
  }
  if (target.hostname === 'www.googleapis.com' && target.pathname === '/drive/v3/files') {
    if (options.method === 'POST') {
      const body = JSON.parse(options.body);
      const folder = { id: `d${drive.next++}`, name: body.name, parent: body.parents[0] };
      drive.folders.push(folder);
      return Response.json({ ...folder, mimeType: 'application/vnd.google-apps.folder' });
    }
    const q = target.searchParams.get('q');
    const parents = [...q.matchAll(/'([^']+)' in parents/g)].map((m) => m[1]);
    if (q.includes("mimeType contains 'image/'")) return Response.json({ files: drive.files.filter((f) => parents.includes(f.parent)).map(asDrive) });
    const name = q.match(/name = '([^']+)'/)?.[1];
    return Response.json({ files: drive.folders.filter((f) => parents.includes(f.parent) && (!name || f.name === name)).map((f) => ({ ...f, mimeType: 'application/vnd.google-apps.folder' })) });
  }
  const item = target.hostname === 'www.googleapis.com' && target.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/);
  if (item) {
    const file = drive.files.find((f) => f.id === item[1]);
    const folder = drive.folders.find((f) => f.id === item[1]);
    if (!file && !folder) return Response.json({ error: { code: 404, message: 'File not found' } }, { status: 404 });
    if (options.method === 'PATCH') {
      if (drive.failMoves) return Response.json({ error: { code: 403, message: 'No access' } }, { status: 403 });
      assert.equal(target.searchParams.get('removeParents'), file.parent);
      file.parent = target.searchParams.get('addParents');
      drive.moves.push(file.id);
      return Response.json({ id: file.id });
    }
    return Response.json(file ? asDrive(file) : { ...folder, parents: [folder.parent], mimeType: 'application/vnd.google-apps.folder', trashed: false });
  }
  throw new Error(`Unexpected request to ${target.hostname}${target.pathname}`);
};

const person = (name, position = 'President') => ({ name, position, classYear: '2028', hometown: 'Boston, MA', photoId: null });

async function emptyRoster() {
  db.set(keys.execRoster, JSON.stringify({ current: [], alumni: [], roles: ['President', 'Historian'] }));
}

beforeEach(() => {
  db.clear();
  freshDrive();
  db.set(keys.google, JSON.stringify({ email: 'club@example.invalid', refreshToken: 'r', scopes: [], connectedAt: 0, connectedBy: 'x', brokenAt: null, accessToken: 'test-access-token', accessTokenExpiresAt: Date.now() + 60_000 }));
});

test('A new database starts with nobody, and the first change saves the roster', async () => {
  assert.deepEqual(await exec.execRoster(), { current: [], alumni: [], roles: [] });
  await exec.addRole('President');
  await exec.savePerson('current', null, person('Ann'));
  const roster = await exec.execRoster();
  assert.deepEqual(roster.roles, ['President']);
  assert.deepEqual(roster.current.map((p) => p.name), ['Ann']);
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
  // Moving back to active puts them after the last person with their role.
  const old = roster.alumni[0];
  await exec.movePerson(old.id, 'current');
  assert.deepEqual((await exec.execRoster()).current.map((p) => p.name), ['Ann', 'Bo', 'Cy', 'Old']);
});

test('People moved to alumni one at a time keep their current exec order, above older alumni', async () => {
  await emptyRoster();
  for (const name of ['Ann', 'Bo', 'Cy', 'Di', 'Ed', 'Fay']) await exec.savePerson('current', null, person(name));
  await exec.savePerson('alumni', null, person('Old'));
  const byName = Object.fromEntries((await exec.execRoster()).current.map((p) => [p.name, p.id]));
  // Out of order on purpose: Di, then Ann, then Fay, then Bo.
  for (const name of ['Di', 'Ann', 'Fay', 'Bo']) await exec.movePerson(byName[name], 'alumni');
  let roster = await exec.execRoster();
  assert.deepEqual(roster.alumni.map((p) => p.name), ['Ann', 'Bo', 'Di', 'Fay', 'Old']);
  assert.deepEqual(roster.current.map((p) => p.name), ['Cy', 'Ed']);
  // Undo of a move puts the person back exactly, and moving them again finds the same place.
  const from = await exec.movePerson(byName.Cy, 'alumni');
  assert.deepEqual((await exec.execRoster()).alumni.map((p) => p.name), ['Ann', 'Bo', 'Cy', 'Di', 'Fay', 'Old']);
  await exec.movePerson(byName.Cy, from.list, from.index);
  roster = await exec.execRoster();
  assert.deepEqual(roster.current.map((p) => p.name), ['Cy', 'Ed']);
  assert.deepEqual(roster.alumni.map((p) => p.name), ['Ann', 'Bo', 'Di', 'Fay', 'Old']);
});

test('People added or moved back to active go after the last person with their role', async () => {
  db.set(keys.execRoster, JSON.stringify({ current: [], alumni: [], roles: ['President', 'Historian', 'Pub Chair'] }));
  await exec.savePerson('current', null, person('Pat', 'Pub Chair'));
  await exec.savePerson('current', null, person('Pia', 'President'));
  await exec.savePerson('current', null, person('Hal', 'Historian'));
  await exec.savePerson('current', null, person('Pam', 'President'));
  let roster = await exec.execRoster();
  assert.deepEqual(roster.current.map((p) => p.name), ['Pia', 'Pam', 'Hal', 'Pat']);
  // An alumnus with an active role goes back into its group. One with a role that no longer exists goes last.
  await exec.savePerson('alumni', null, person('Hil', 'Historian'));
  await exec.savePerson('alumni', null, person('Old', 'Food Coordinator'));
  const [hil, old] = (await exec.execRoster()).alumni;
  await exec.movePerson(old.id, 'current');
  await exec.movePerson(hil.id, 'current');
  roster = await exec.execRoster();
  assert.deepEqual(roster.current.map((p) => p.name), ['Pia', 'Pam', 'Hal', 'Hil', 'Pat', 'Old']);
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
  // Alumni keep the title they held, so any title works for them.
  await exec.savePerson('alumni', roster.alumni[0].id, person('Old Two', 'Historian'));
  await exec.savePerson('alumni', null, person('Older', 'Food Coordinator'));
  await assert.rejects(exec.removeRole('Archivist'), /Ann has this role/);
  await assert.rejects(exec.addRole('president'.replace('p', 'P')), /already a role/);
  await exec.addRole('Social Chair');
  await exec.reorderRoles(['Social Chair', 'President', 'Archivist']);
  await exec.removeRole('President');
  roster = await exec.execRoster();
  assert.deepEqual(roster.roles, ['Social Chair', 'Archivist']);
});

test('An uploaded photo goes into the folder for its list, made if missing, and can be picked', async () => {
  await emptyRoster();
  const photo = await exec.uploadExecPhoto('ann.jpg', 'image/jpeg', new Uint8Array([1, 2, 3]), 'current');
  assert.equal(photo.name, 'ann.jpg');
  const top = folderNamed('Exec Photos');
  assert.deepEqual(drive.folders.filter((f) => f.parent === top.id).map((f) => f.name).sort(), ['Active', 'Alumni']);
  assert.equal(folderOf(photo.id), 'Active');
  const saved = await exec.savePerson('current', null, { ...person('Ann'), photoId: photo.id });
  assert.equal(saved.photo.id, photo.id);
  assert.equal(await exec.isRosterPhoto(photo.id), true);
  const old = await exec.uploadExecPhoto('old.jpg', 'image/jpeg', new Uint8Array([1]), 'alumni');
  assert.equal(folderOf(old.id), 'Alumni');
  assert.equal(drive.folders.filter((f) => f.name === 'Exec Photos').length, 1, 'the second upload reuses the folders');
  await assert.rejects(exec.savePerson('current', null, { ...person('Bo'), photoId: 'gone' }), /no longer in the Exec Photos folder/);
  await assert.rejects(exec.uploadExecPhoto('notes.txt', 'text/plain', new Uint8Array([1]), 'current'), /image file/);
});

test('A photo moves between the Active and Alumni folders with its person, and Undo moves it back', async () => {
  await emptyRoster();
  const photo = await exec.uploadExecPhoto('ann.jpg', 'image/jpeg', new Uint8Array([1]), 'current');
  const ann = await exec.savePerson('current', null, { ...person('Ann'), photoId: photo.id });
  const from = await exec.movePerson(ann.id, 'alumni');
  assert.equal(folderOf(photo.id), 'Alumni');
  await exec.movePerson(ann.id, from.list, from.index);
  assert.equal(folderOf(photo.id), 'Active');
  // Picking a photo from the other folder moves it to the person's folder.
  const other = await exec.uploadExecPhoto('bo.jpg', 'image/jpeg', new Uint8Array([1]), 'current');
  await exec.savePerson('alumni', null, { ...person('Bo'), photoId: other.id });
  assert.equal(folderOf(other.id), 'Alumni');
  // A failed move never blocks the change: the photo stays put, and the site still finds it by id.
  drive.failMoves = true;
  const warn = console.warn;
  console.warn = () => {};
  try {
    await exec.movePerson(ann.id, 'alumni');
  } finally {
    console.warn = warn;
  }
  assert.equal(folderOf(photo.id), 'Active');
  assert.deepEqual((await exec.execRoster()).alumni.map((p) => p.name), ['Ann', 'Bo']);
});

test('A refresh sorts the photos on the site into their folders and leaves the rest alone', async () => {
  await emptyRoster();
  // Photos from before the Active and Alumni folders, loose in Exec Photos.
  drive.folders.push({ id: 'exec', name: 'Exec Photos', parent: 'web' });
  const loose = (id) => drive.files.push({ id, name: `${id}.jpg`, parent: 'exec', mimeType: 'image/jpeg', version: '1', createdTime: new Date().toISOString() });
  ['p1', 'p2', 'p3'].forEach(loose);
  await exec.refreshExecPhotoLibrary();
  await exec.savePerson('current', null, { ...person('Ann'), photoId: 'p1' });
  await exec.savePerson('alumni', null, { ...person('Old'), photoId: 'p2' });
  drive.files.find((f) => f.id === 'p1').parent = 'exec';
  drive.files.find((f) => f.id === 'p2').parent = 'exec';
  drive.moves = [];
  const library = await exec.refreshExecPhotoLibrary();
  assert.deepEqual(library.photos.map((p) => p.id).sort(), ['p1', 'p2', 'p3']);
  assert.equal(folderOf('p1'), 'Active');
  assert.equal(folderOf('p2'), 'Alumni');
  assert.equal(folderOf('p3'), 'Exec Photos', 'a photo nobody uses stays where it is');
  assert.deepEqual(library.folders, { current: folderNamed('Active').id, alumni: folderNamed('Alumni').id });
  drive.moves = [];
  await exec.refreshExecPhotoLibrary();
  assert.deepEqual(drive.moves, [], 'sorted photos are not moved again');
});
