/* eslint-disable @typescript-eslint/no-require-imports -- Standalone CommonJS browser test runner. */
/* Run against a local mode server (PORT=3020 npm run dev):
 * PLAYWRIGHT_MODULE_PATH=/path/to/node_modules/playwright VOTING_TEST_URL=http://localhost:3020 node tests/voting-admin.e2e.cjs
 * All voting API calls are intercepted. The test never writes to Redis or Google.
 */
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const baseURL = process.env.VOTING_TEST_URL || 'http://localhost:3020';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let election = null;
  let state = null;
  let ended = false;
  const creates = [];
  const actions = [];
  const snapshots = new Map();
  const participants = [{id:'v1',name:'Voter One',submitted:false,initialSubmitted:true},{id:'v2',name:'Voter Two',submitted:true,initialSubmitted:true}];
  await page.route('https://apis.google.com/**', route => route.abort());
  await page.route('**/api/voting/**', async route => {
    const url = new URL(route.request().url());
    const endpoint = url.pathname.split('/').at(-1);
    const payload = route.request().method() === 'POST' ? route.request().postDataJSON() : null;
    const reply = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (endpoint === 'delibs') {
      if (url.searchParams.has('results')) return reply({sessionId: 'test-delib', name: 'Spring delib', ended: true, voterCount: 2, criteria: state.criteria, candidates: [], exportToken: 'token'});
      if (payload?.action === 'create') {
        creates.push(payload);
        election = {sessionId: 'test-delib', name: payload.name, hostName: 'Test Host', isHost: true};
        state = {sessionId: 'test-delib', active: true, isAdmin: true, phase: 'waiting', ballotVersion: '', currentCandidate: null, criteria: payload.criteria, candidates: payload.candidates.map((c, order) => ({...c, order, completed: false})), participants, voters: participants.map(p => ({...p, eligible: true})), submittedCount: 0, pollIntervalMs: 3000};
        return reply({sessionId: 'test-delib'});
      }
      if (payload?.action === 'end') { ended = true; return reply({ok: true}); }
      return reply({me: {name: 'Test Host'}, election: ended ? null : election});
    }
    if (endpoint === 'state') return reply(state);
    if (endpoint === 'presence') return reply({presence: {}});
    assert.equal(endpoint, 'admin');
    actions.push(payload);
    assert.equal(payload.action, 'setPhase');
    if (payload.candidateId) state.currentCandidate = state.candidates.find(candidate => candidate.id === payload.candidateId);
    if (payload.phase === 'initial') { state.ballotVersion = `version-${state.currentCandidate.id}`; snapshots.set(state.currentCandidate.id, state.ballotVersion); }
    if (payload.phase === 'final' && payload.candidateId) state.ballotVersion = snapshots.get(payload.candidateId);
    if (payload.phase === 'locked') { state.currentCandidate = {...state.currentCandidate, completed: true}; state.candidates = state.candidates.map(candidate => candidate.id === state.currentCandidate.id ? {...candidate, completed: true} : candidate); }
    state.phase = payload.phase;
    return reply(state);
  });
  const button = name => page.getByRole('button', { name, exact: true });
  const names = () => page.getByPlaceholder('Candidate name').evaluateAll(inputs => inputs.map(input => input.value));
  const waitFor = async (predicate, message, attempts = 100) => {
    for (let i = 0; i < attempts; i++) { if (await predicate()) return; await page.waitForTimeout(50); }
    throw new Error(message);
  };
  try {
    // The dev server signs in as DASHBOARD_DEV_EMAIL.
    await page.goto(`${baseURL}/api/auth/google/start?next=/dashboard/delibs/live`);
    await page.getByRole('heading', { name: 'No delib is running' }).waitFor();
    await button('Start a delib').click();
    await page.getByRole('heading', { name: 'New delib' }).waitFor();
    assert.match(await page.getByLabel('Name').inputValue(), /^Delibs \d{4}-\d{2}-\d{2}$/);
    await page.getByLabel('Name').fill('Spring delib');
    await button('Continue').click();

    // Criteria step.
    await button('Continue').click();
    await page.getByRole('status').filter({ hasText: 'Add at least one named criterion' }).waitFor();
    await button('+ Add criteria').click();
    await page.getByPlaceholder('Criterion name').fill('Reliability');
    await page.getByPlaceholder('Short description (optional)').fill('Follow-through and preparation');
    await button('Continue').click();

    // Candidates step.
    await button('Paste names').click();
    await page.getByLabel('One name per line').fill('Alex Chen\nJordan Lee\nMorgan Wu');
    await button('Add 3 candidates').click();
    assert.deepEqual(await names(), ['Alex Chen', 'Jordan Lee', 'Morgan Wu']);
    assert.equal(await page.getByLabel('One name per line').count(), 0, 'Paste closes after adding names');
    const firstHandle = button('Reorder Alex Chen');
    const start = await firstHandle.boundingBox();
    const second = await button('Reorder Jordan Lee').boundingBox();
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
    await page.mouse.down();
    await page.mouse.move(second.x + second.width / 2, second.y + second.height / 2 + 10, {steps: 12});
    await waitFor(async () => await button('Reorder Jordan Lee').locator('..').evaluate(el => new DOMMatrixReadOnly(getComputedStyle(el).transform).m42 < -20), 'Adjacent row should move aside before drop');
    await page.mouse.up();
    await waitFor(async () => (await names())[0] === 'Jordan Lee', 'Drag did not reorder candidates');
    await firstHandle.focus();
    await page.keyboard.press('ArrowUp');
    assert.deepEqual(await names(), ['Alex Chen', 'Jordan Lee', 'Morgan Wu'], 'Keyboard reorder should restore order');
    const list = page.getByRole('list', {name: 'Candidate order'});
    await waitFor(async () => await firstHandle.locator('..').evaluate(el => getComputedStyle(el).transform === 'none'), 'Row reorder animation did not settle');
    const listBox = await list.boundingBox();
    const grip = await firstHandle.boundingBox();
    await page.mouse.move(grip.x + 8, grip.y + 12);
    await page.mouse.down();
    await page.mouse.move(grip.x + 8, listBox.y - 150, {steps: 10});
    assert.ok((await firstHandle.locator('..').boundingBox()).y >= listBox.y - 2, 'Dragging must stay inside the list');
    await page.mouse.up();

    // Going back keeps the draft.
    await button('Back').click();
    assert.equal(await page.getByPlaceholder('Criterion name').inputValue(), 'Reliability');
    await button('Continue').click();
    assert.deepEqual(await names(), ['Alex Chen', 'Jordan Lee', 'Morgan Wu']);
    await page.screenshot({path: '/private/tmp/voting-setup-mockup.png'});
    await button('Shuffle order').click();
    const shuffledNames = await names();
    assert.equal(creates.length, 0, 'Setup changes stay local until the delib starts');
    // Record whether the empty screen flashes between the form and the new delib.
    await page.evaluate(() => {
      window.__emptyFlash = false;
      new MutationObserver(() => { if (document.body.innerText.includes('No delib is running')) window.__emptyFlash = true; }).observe(document.body, {childList: true, subtree: true});
    });
    await button('Start delib').click();

    // Live host controls.
    await page.getByRole('heading', { name: 'Spring delib', level: 1 }).waitFor();
    assert.equal(creates.length, 1);
    assert.equal(await page.evaluate(() => window.__emptyFlash), false, 'Starting a delib must not show "No delib is running"');
    assert.equal(creates[0].name, 'Spring delib');
    assert.match(creates[0].requestId, /^[0-9a-f-]{36}$/);
    assert.deepEqual(creates[0].candidates.map(c => c.name), shuffledNames, 'The delib keeps the shuffled order');
    assert.equal(creates[0].criteria[0].label, 'Reliability');
    assert.equal(await page.locator('.voting-current-name').textContent(), shuffledNames[0]);
    assert.equal(await button('Shuffle order').count(), 0, 'Shuffle is only available in setup');
    await button('Copy link').click();
    await button('Copied').waitFor();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), `${new URL(baseURL).origin}/dashboard/delibs/test-delib`, 'The host copies the delib link');
    assert.equal(await page.getByRole('region', { name: 'Ballot setup' }).count(), 0);
    assert.equal(await button('End voting').isDisabled(), false, 'The host can end the delib between rounds');
    await button('View Morgan Wu').click();
    await page.locator('.voting-current-name').filter({hasText: 'Morgan Wu'}).waitFor();
    for (const [name, phase] of [['Start initial ratings', 'initial'], ['Start discussion', 'deliberation'], ['Open voting', 'revision']]) {
      await button(name).click();
      await waitFor(() => state.phase === phase, `Phase ${phase} did not persist`);
      if (phase === 'initial') {
        await button('Start discussion').waitFor();
        assert.equal(await button('End voting').isDisabled(), true, 'The host cannot end the delib during a round');
        assert.equal(await page.getByRole('button', {name: /^View /}).first().isDisabled(), false, 'Candidate browsing stays available');
      }
    }
    await page.getByRole('heading', {name: 'Voting open', exact: true}).waitFor({state: 'attached'});
    await page.screenshot({path: '/private/tmp/voting-controls.png'});
    await page.getByText('Waiting on 1', {exact: true}).waitFor();
    assert.equal(await page.locator('.voting-waiting-on').getByText('Voter One', {exact: true}).count(), 1);
    assert.equal(await page.locator('.voting-waiting-on').getByText('Voter Two', {exact: true}).count(), 0);
    const originalVersion = state.ballotVersion;
    await button('Close voting for this candidate').click();
    await waitFor(() => state.phase === 'locked', 'Candidate did not lock');
    await button('Start initial ratings').waitFor();
    assert.notEqual(await page.locator('.voting-current-name').textContent(), 'Morgan Wu', 'Closing selects the next unfinished candidate');
    await page.getByRole('button', {name: /^View /}).first().click();
    assert.equal(state.phase, 'locked', 'Browsing another candidate must not change the live round');
    await button('View Morgan Wu').click();
    await button('Reopen final submission').click();
    await waitFor(() => state.phase === 'final', 'Completed candidate did not reopen');
    assert.equal(state.ballotVersion, originalVersion, 'Reopening must preserve ballot version');
    assert.equal(actions.at(-1).candidateId, state.candidates.find(c => c.name === 'Morgan Wu').id);
    await button('Close voting for this candidate').click();
    await waitFor(() => state.phase === 'locked', 'Candidate did not lock again');

    // The voter roster opens from the header.
    await button('Manage voters').click();
    await page.getByRole('region', {name: 'Voters'}).getByText('Voter One', {exact: true}).waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('region', {name: 'Voters'}).count(), 0);

    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'Mobile page should not horizontally overflow');
    await page.setViewportSize({ width: 1280, height: 1000 });

    // Ending opens the delib's results page under History.
    await button('End voting').click();
    await page.waitForURL('**/dashboard/delibs/history/test-delib');
    assert.equal(ended, true);
    assert.deepEqual(errors, []);
    console.log(`PASS: delib setup steps, validation, paste, drag and keyboard reorder, draft kept on Back, shuffle, start without an empty flash, copy link, phase flow, reopen, roster, mobile layout, end opens History (${actions.length} host actions mocked).`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
