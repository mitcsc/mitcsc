/* eslint-disable @typescript-eslint/no-require-imports -- Standalone CommonJS browser test runner. */
/* Run against a local dev server: VOTING_TEST_URL=http://127.0.0.1:3113 node tests/voting-admin.e2e.cjs.
 * API calls are intercepted; this test never accesses Google Sheets.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let authenticated = false;
  let polls = 0;
  let state = { sessionId: 'test-election', active: true, phase: 'waiting', ballotVersion: '', currentCandidate: null, criteria: [], contextVisible: false, submittedCount: 0, voter: null, isAdmin: true, participants:[{id:'v1',name:'Voter One',submitted:false},{id:'v2',name:'Voter Two',submitted:true}], initialized: false, candidates: [], spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/test/edit' };
  const actions = [];
  const snapshots = new Map();
  await page.route('**/api/voting/**', async route => {
    const endpoint = new URL(route.request().url()).pathname.split('/').at(-1);
    const payload = route.request().method() === 'POST' ? route.request().postDataJSON() : null;
    const reply = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (endpoint === 'join') {
      assert.equal(payload.role, 'voter');
      assert.equal(payload.name, 'Test President');
      if (payload.password !== 'test-admin') return reply({ error: 'Incorrect password.' }, 401);
      authenticated = true;
      return reply({ ok: true });
    }
    if (endpoint === 'logout') { authenticated = false; return reply({ ok: true }); }
    if (!authenticated) return reply({ error: 'Sign in to continue.' }, 401);
    if (endpoint === 'state') { polls++; return reply(state); }
    assert.equal(endpoint, 'admin');
    actions.push(payload);
    switch (payload.action) {
      case 'initialize': state.initialized = true; break;
      case 'saveSetup': state.candidates = payload.candidates; state.criteria = payload.criteria; break;
      case 'shuffle': state.candidates = state.candidates.slice().reverse().map((candidate, order) => ({ ...candidate, order })); break;
      case 'setContext': state.contextVisible = payload.visible; break;
      case 'setPhase':
        if (payload.candidateId) state.currentCandidate = state.candidates.find(candidate => candidate.id === payload.candidateId);
        if (payload.phase === 'initial') { state.ballotVersion = `version-${state.currentCandidate.id}`; snapshots.set(state.currentCandidate.id, state.ballotVersion); }
        if (payload.phase === 'waiting') state.ballotVersion = '';
        if (payload.phase === 'final' && payload.candidateId) state.ballotVersion = snapshots.get(payload.candidateId);
        if (payload.phase === 'locked') { state.currentCandidate.completed = true; state.candidates = state.candidates.map(candidate => candidate.id === state.currentCandidate.id ? { ...candidate, completed: true } : candidate); }
        state.phase = payload.phase;
        break;
      default: throw new Error(`Unexpected action ${payload.action}`);
    }
    return reply(state);
  });
  page.on('dialog', dialog => dialog.accept());
  const button = name => page.getByRole('button', { name, exact: true });
  const waitFor = async (predicate, message) => {
    for (let i = 0; i < 100; i++) { if (await predicate()) return; await page.waitForTimeout(50); }
    throw new Error(message);
  };
  try {
    await page.goto(`${process.env.VOTING_TEST_URL || 'http://127.0.0.1:3113'}/vote/admin`);
    await page.getByLabel('Your name').fill('Test President');
    await page.getByLabel('Session password').fill('wrong');
    await button('Join').click();
    await page.getByRole('alert').filter({ hasText: 'Incorrect password' }).waitFor();
    await page.getByLabel('Session password').fill('test-admin');
    await button('Join').click();
    await button('Set up election').click();
    await page.getByRole('region', { name: 'Ballot setup' }).waitFor();
    await page.getByRole('status').filter({hasText:'2 voters joined'}).waitFor();
    await button('Paste names').click();
    await page.getByLabel('Names, one per line').fill('Alex Chen\nJordan Lee\nMorgan Wu');
    await button('Add names').click();
    assert.equal(await page.getByLabel('Name', { exact: true }).count(), 3);
    assert.equal(await page.getByLabel('Names, one per line').count(), 0, 'Paste closes after adding names');
    const firstHandle = page.getByRole('button', {name:'Reorder Alex Chen',exact:true});
    const start = await firstHandle.boundingBox();
    const second = await page.getByRole('button', {name:'Reorder Jordan Lee',exact:true}).boundingBox();
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
    await page.mouse.down();
    await page.mouse.move(second.x + second.width / 2, second.y + second.height / 2 + 10, {steps:12});
    await waitFor(async () => await page.getByRole('button', {name:'Reorder Jordan Lee',exact:true}).locator('..').evaluate(el => new DOMMatrixReadOnly(getComputedStyle(el).transform).m42 < -20), 'Adjacent row should move aside before drop');
    await page.mouse.up();
    await waitFor(async () => await page.getByLabel('Name', {exact:true}).first().inputValue() === 'Jordan Lee', 'Drag did not reorder candidates');
    await firstHandle.focus();
    await page.keyboard.press('ArrowUp');
    assert.equal(await page.getByLabel('Name', {exact:true}).first().inputValue(), 'Alex Chen', 'Keyboard reorder should restore order');

    const list = page.getByRole('list', {name:'Candidate order'});
    await waitFor(async () => await firstHandle.locator('..').evaluate(el => getComputedStyle(el).transform === 'none'), 'Row reorder animation did not settle');
    const listBox = await list.boundingBox();
    const grip = await firstHandle.boundingBox();
    await page.mouse.move(grip.x + 8, grip.y + 12);
    await page.mouse.down();
    await page.mouse.move(grip.x + 8, listBox.y - 150, {steps:10});
    const draggedBox = await firstHandle.locator('..').boundingBox();
    assert.ok(draggedBox.y >= listBox.y - 2, 'Dragging must stay inside the list');
    await page.mouse.up();
    const divider = page.getByRole('separator', {name:'Resize candidates and criteria'});
    const dividerBox = await divider.boundingBox();
    await page.mouse.move(dividerBox.x, dividerBox.y + 50);
    await page.mouse.down();
    await page.mouse.move(dividerBox.x + 80, dividerBox.y + 50, {steps:8});
    assert.equal(await page.locator('.voting-admin-edit-row').first().evaluate(el => getComputedStyle(el).transform), 'none', 'Column resizing must not stretch or translate candidate rows');
    await page.mouse.up();
    assert.ok(Number(await divider.getAttribute('aria-valuenow')) > 38, 'Divider drag should resize columns');
    await divider.focus();
    await page.keyboard.press('Home');
    for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
    assert.equal(await divider.getAttribute('aria-valuenow'), '50');
    await button('+ Add criterion').click();
    await page.getByLabel('Criterion', { exact: true }).fill('Reliability');
    await page.getByLabel('Description', { exact: true }).fill('Follow-through and preparation');
    const pollingBefore = polls;
    await waitFor(() => polls > pollingBefore, 'Expected periodic state polling');
    assert.equal(await page.getByLabel('Criterion', { exact: true }).inputValue(), 'Reliability', 'Polling must not discard unsaved setup');
    assert.equal(await page.getByLabel('Name', { exact: true }).first().inputValue(), 'Alex Chen');
    await button('Start').click();
    await page.locator('.voting-current-name').filter({hasText:'Alex Chen'}).waitFor();
    assert.equal(actions.filter(a => a.action === 'setPhase').length, 0, 'Start should not write a candidate selection');
    await button('Back to setup').click();
    await page.getByRole('region', {name:'Ballot setup'}).waitFor();
    assert.equal(state.candidates.length, 3);
    assert.equal(new Set(state.candidates.map(candidate => candidate.id)).size, 3);
    assert.equal(state.criteria[0].label, 'Reliability');
    await page.screenshot({path:'/private/tmp/voting-setup-mockup.png'});
    assert.equal(await button('Preview ballot').count(),0);
    const writesBeforeShuffle = actions.length;
    const storedCandidates = JSON.stringify(state.candidates);
    await button('Shuffle order').click();
    assert.equal(actions.length, writesBeforeShuffle, 'Setup shuffle must not call the backend');
    assert.equal(JSON.stringify(state.candidates), storedCandidates, 'Shuffle must not change stored candidates');
    const shuffledNames = await page.getByLabel('Name', {exact:true}).evaluateAll(inputs => inputs.map(input => input.value));
    await button('Start').click();
    await button('Start initial ratings').waitFor();
    assert.equal(await page.locator('.voting-current-name').textContent(), shuffledNames[0]);
    assert.equal(JSON.stringify(state.candidates), storedCandidates, 'Start preserves canonical candidate storage order');
    assert.equal(await button('Shuffle order').count(), 0, 'Shuffle is only available in setup');
    const localOrder = await page.evaluate(() => JSON.parse(localStorage.getItem('voting-order:test-election')));
    assert.equal(localOrder.length, 3);
    await page.getByRole('button', {name:'Choose Morgan Wu',exact:true}).evaluate(button => { if (!button.disabled) button.click(); });
    await page.locator('.voting-current-name').filter({hasText:'Morgan Wu'}).waitFor();
    for (const [name, phase] of [['Start initial ratings', 'initial'], ['Start discussion', 'deliberation'], ['Open voting', 'revision']]) {
      await page.getByRole('button', { name: name }).click();
      await waitFor(() => state.phase === phase, `Phase ${phase} did not persist`);
      if (phase === 'initial') {
        await button('Start discussion').waitFor();
        await page.getByRole('region', { name: 'Ballot setup' }).waitFor({ state: 'detached' });
        assert.equal(await page.getByRole('region', { name: 'Ballot setup' }).count(), 0, 'Setup must lock after starting');
        assert.equal(await button('Back to setup').count(),0,'Setup navigation must disappear during voting');
        assert.equal(await page.getByRole('tab').count(),0);
        assert.equal(await page.getByRole('button', {name: /^Choose /}).first().isDisabled(), true, 'Cannot abandon an active candidate');
      }
    }
    await page.getByRole('heading', {name:'Voting open',exact:true}).waitFor({state:'attached'});
    await button('Close voting for this candidate').waitFor();
    await page.screenshot({path: '/private/tmp/voting-controls.png'});
    await page.getByText('Waiting on 1',{exact:true}).waitFor();
    assert.equal(await page.locator('.voting-waiting-on').getByText('Voter One',{exact:true}).count(),1);
    assert.equal(await page.locator('.voting-waiting-on').getByText('Voter Two',{exact:true}).count(),0);
    const originalVersion = state.ballotVersion;
    await page.getByRole('button', { name: 'Close voting for this candidate' }).click();
    await button('Yes, close voting').click();
    await waitFor(() => state.phase === 'locked', 'Candidate did not lock');
    await page.getByRole('heading', {name: 'Voting closed', exact: true}).waitFor();
    await page.getByRole('button', {name: /^Choose /}).first().click();
    await waitFor(() => state.phase === 'waiting' && !state.ballotVersion, 'Next candidate selection should reset active version');
    assert.equal(await page.getByRole('region', { name: 'Ballot setup' }).count(), 0, 'Completed history must keep setup locked even in waiting');
    await page.getByRole('button', {name: /^Reopen submissions for /}).click();
    await waitFor(() => state.phase === 'final', 'Completed candidate did not reopen');
    assert.equal(state.ballotVersion, originalVersion, 'Reopening must preserve ballot version');
    assert.equal(actions.at(-1).candidateId, state.candidates.find(c => c.name === 'Morgan Wu').id);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'Mobile page should not horizontally overflow');
    assert.equal(await button('Sign out').count(), 0);
    assert.equal(await page.getByRole('link', {name: /Election sheet/}).count(), 0);
    state.isAdmin = false;
    await page.reload();
    await page.getByRole('heading', { name: 'Admin already assigned' }).waitFor();
    assert.equal(await page.getByRole('link', { name: 'Go to voting →' }).count(), 1);
    assert.equal(await button('Join').count(), 0, 'Later voters should not get trapped in a admin login loop');
    assert.deepEqual(errors, []);
    console.log(`PASS: admin login, setup, polling draft preservation, preview, shuffle, phase flow, recovery and mobile layout (${actions.length} mutations mocked).`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
