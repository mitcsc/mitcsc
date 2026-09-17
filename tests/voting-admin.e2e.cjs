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
  let state = { sessionId: 'test-election', active: true, phase: 'waiting', ballotVersion: '', currentCandidate: null, criteria: [], contextVisible: false, submittedCount: 0, voter: null, isAdmin: true, initialized: false, candidates: [], spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/test/edit' };
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
    await page.goto(`${process.env.VOTING_TEST_URL || 'http://127.0.0.1:3113'}/deliberations/admin`);
    await page.getByLabel('Your name').fill('Test President');
    await page.getByLabel('Session password').fill('wrong');
    await button('Join session').click();
    await page.getByRole('alert').filter({ hasText: 'Incorrect password' }).waitFor();
    await page.getByLabel('Session password').fill('test-admin');
    await button('Join session').click();
    await button('Set up election').click();
    await page.getByRole('heading', { name: 'Build your ballot' }).waitFor();
    await page.getByLabel('Or paste names, one per line').fill('Alex Chen\nJordan Lee\nMorgan Wu');
    await button('Add pasted names').click();
    assert.equal(await page.getByLabel('Name', { exact: true }).count(), 3);
    await button('+ Add criterion').click();
    await page.getByLabel('Criterion', { exact: true }).fill('Reliability');
    await page.getByLabel('Description', { exact: true }).fill('Follow-through and preparation');
    const pollingBefore = polls;
    await waitFor(() => polls > pollingBefore, 'Expected periodic state polling');
    assert.equal(await page.getByLabel('Criterion', { exact: true }).inputValue(), 'Reliability', 'Polling must not discard unsaved setup');
    assert.equal(await page.getByLabel('Name', { exact: true }).first().inputValue(), 'Alex Chen');
    await button('Save setup').click();
    await page.getByRole('status').filter({ hasText: 'Setup saved' }).waitFor();
    assert.equal(state.candidates.length, 3);
    assert.equal(new Set(state.candidates.map(candidate => candidate.id)).size, 3);
    assert.equal(state.criteria[0].label, 'Reliability');
    await button('Preview ballot').click();
    await page.getByRole('heading', { name: 'Alex Chen', exact: true }).waitFor();
    await page.getByRole('radio', { name: '3', exact: true }).check();
    assert.equal(await page.getByRole('radio', { name: '3', exact: true }).isChecked(), true);
    await button('Edit setup').click();
    await button('Shuffle remaining candidates').click();
    await page.getByRole('status').filter({ hasText: 'Remaining candidate order shuffled' }).waitFor();
    assert.equal(state.candidates[0].name, 'Morgan Wu');
    assert.equal(await page.getByLabel('Name', { exact: true }).first().inputValue(), 'Morgan Wu');
    await button('Select').first().click();
    await waitFor(() => state.currentCandidate?.name === 'Morgan Wu', 'Candidate selection did not persist');
    for (const [name, phase] of [['1Initial ratings', 'initial'], ['2Deliberate', 'deliberation'], ['3Allow revisions', 'revision'], ['4Final submission', 'final']]) {
      await page.getByRole('button', { name: new RegExp(name.replace(/^\d/, '^\\d\\s*')) }).click();
      await waitFor(() => state.phase === phase, `Phase ${phase} did not persist`);
      if (phase === 'initial') {
        await page.getByRole('heading', { name: 'Build your ballot' }).waitFor({ state: 'detached' });
        assert.equal(await page.getByRole('heading', { name: 'Build your ballot' }).count(), 0, 'Setup must lock after starting');
        assert.equal(await button('Select').first().isDisabled(), true, 'Cannot abandon an active candidate');
      }
    }
    const originalVersion = state.ballotVersion;
    await page.getByLabel('Reveal candidate context to voters').click();
    await waitFor(() => state.contextVisible, 'Context toggle did not persist');
    await page.getByRole('button', { name: /5\s*Close candidate/ }).click();
    await waitFor(() => state.phase === 'locked', 'Candidate did not lock');
    await button('Select').first().click();
    await waitFor(() => state.phase === 'waiting' && !state.ballotVersion, 'Next candidate selection should reset active version');
    assert.equal(await page.getByRole('heading', { name: 'Build your ballot' }).count(), 0, 'Completed history must keep setup locked even in waiting');
    await button('Reopen submissions').click();
    await waitFor(() => state.phase === 'final', 'Completed candidate did not reopen');
    assert.equal(state.ballotVersion, originalVersion, 'Reopening must preserve ballot version');
    assert.equal(actions.at(-1).candidateId, state.candidates[0].id);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'Mobile page should not horizontally overflow');
    await button('Sign out').click();
    await page.getByLabel('Session password').waitFor();
    assert.equal(await page.getByLabel('Session password').inputValue(), '');
    state.isAdmin = false;
    await page.getByLabel('Your name').fill('Test President');
    await page.getByLabel('Session password').fill('test-admin');
    await button('Join session').click();
    await page.getByRole('heading', { name: 'Admin already assigned' }).waitFor();
    assert.equal(await page.getByRole('link', { name: 'Go to voting →' }).count(), 1);
    assert.equal(await button('Join session').count(), 0, 'Later voters should not get trapped in a admin login loop');
    assert.deepEqual(errors, []);
    console.log(`PASS: admin login, setup, polling draft preservation, preview, shuffle, phase flow, recovery and mobile layout (${actions.length} mutations mocked).`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
