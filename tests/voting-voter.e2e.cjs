/* Run against a local dev server:
 * PLAYWRIGHT_MODULE_PATH=/path/to/node_modules/playwright \
 * VOTING_TEST_URL=http://localhost:3112 node tests/voting-voter.e2e.cjs
 * All voting API traffic is intercepted. No Google credentials or writes are used.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const baseURL = process.env.VOTING_TEST_URL || 'http://localhost:3112';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let authenticated = false;
  let stateRequests = 0;
  const joinRequests = [];
  const submissions = [];
  let rejectSubmission = true;
  const state = {
    sessionId: 'ui-test-session', active: true, phase: 'initial', ballotVersion: 'v1',
    currentCandidate: { id: 'candidate-one', name: 'Alex Chen', context: '', order: 0, completed: false },
    criteria: [
      { id: 'reliability', label: 'Reliability', description: 'Consider follow-through.', min: 1, max: 5, required: true },
      { id: 'experience', label: 'Experience', description: '', min: 1, max: 5, required: false },
    ],
    contextVisible: false, submittedCount: 0,
    voter: { id: 'voter-one', name: 'Test Voter' }, isAdmin: false, initialized: true,
  };
  await page.route('**/api/voting/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const reply = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path.endsWith('/state')) {
      stateRequests++;
      return authenticated ? reply(200, state) : reply(401, { error: 'Join the session.' });
    }
    if (path.endsWith('/join')) {
      joinRequests.push(route.request().postDataJSON()); authenticated = true;
      return reply(200, { ok: true });
    }
    if (path.endsWith('/submit')) {
      const ballot = route.request().postDataJSON(); submissions.push(ballot);
      return rejectSubmission ? reply(503, { error: 'Temporary spreadsheet failure.' }) : reply(200, { ok: true, submissionId: ballot.submissionId });
    }
    throw new Error(`Unexpected voting API route: ${path}`);
  });
  const waitText = text => page.getByText(text, { exact: true }).waitFor();
  const fieldset = label => page.locator('fieldset').filter({ has: page.locator('legend', { hasText: label }) });
  const rate = async (label, value) => fieldset(label).getByRole('radio', { name: String(value), exact: true }).check();
  const refreshPhase = async phase => {
    state.phase = phase;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.locator('.voter-phase').filter({ hasText: ({ initial: 'Initial ratings', deliberation: 'Discussion', revision: 'Revisions open', final: 'Submit your ballot', locked: 'Voting closed' })[phase] }).waitFor();
  };
  try {
    await page.goto(`${baseURL}/vote`);
    await page.getByLabel('Your name').fill('Test Voter');
    await page.getByLabel('Session password').fill('private-test-password');
    await page.getByRole('button', { name: 'Join session' }).click();
    await page.getByRole('heading', { name: 'Alex Chen' }).waitFor();
    assert.deepEqual(joinRequests, [{ name: 'Test Voter', password: 'private-test-password', role: 'voter' }]);
    assert.equal(await fieldset('Reliability').getByRole('radio', { name: 'Not enough information' }).count(), 0);
    assert.equal(await fieldset('Experience').getByRole('radio', { name: 'Not enough information' }).count(), 1);
    await page.getByRole('button', { name: 'Save initial ratings' }).click();
    await waitText('Choose a numeric rating for each required criterion.');
    await rate('Reliability', 3);
    await fieldset('Experience').getByRole('radio', { name: 'Not enough information' }).check();
    await page.getByRole('button', { name: 'Save initial ratings' }).click();
    await waitText('✓ Initial ratings recorded. Ready for discussion.');
    assert.equal(submissions.length, 0, 'Initial ratings must stay local');
    await page.reload();
    await waitText('✓ Initial ratings recorded. Ready for discussion.');
    assert.equal(await fieldset('Reliability').getByRole('radio', { name: '3', exact: true }).isChecked(), true);
    assert.equal(await fieldset('Reliability').getByRole('radio', { name: '4', exact: true }).isDisabled(), true);
    await refreshPhase('deliberation');
    state.contextVisible = true; state.currentCandidate.context = 'Discussion notes released by admin.';
    await refreshPhase('revision');
    assert.equal(await page.getByText('Discussion notes released by admin.').count(), 0);
    await rate('Reliability', 5);
    await page.reload();
    await page.locator('.voter-phase').filter({ hasText: 'Revisions open' }).waitFor();
    assert.equal(await fieldset('Reliability').getByRole('radio', { name: '5', exact: true }).isChecked(), true);
    await fieldset('Reliability').getByText('Initial: 3', { exact: false }).waitFor();
    await refreshPhase('final');
    await page.getByRole('button', { name: 'Submit final ballot' }).click();
    await page.getByRole('alert').filter({ hasText: 'Temporary spreadsheet failure.' }).waitFor();
    assert.equal(submissions.length, 1);
    assert.deepEqual(submissions[0].initialRatings, { reliability: 3, experience: null });
    assert.deepEqual(submissions[0].finalRatings, { reliability: 5, experience: null });
    const originalSubmissionId = submissions[0].submissionId;
    assert.match(originalSubmissionId, /^[a-f0-9-]{36}$/);
    // Reopening revisions after an ambiguous send must not change that send's payload.
    await refreshPhase('revision');
    assert.equal(await fieldset('Reliability').getByRole('radio', { name: '4', exact: true }).isDisabled(), true);
    await refreshPhase('final');
    await page.reload();
    rejectSubmission = false;
    await page.getByRole('button', { name: 'Submit final ballot' }).click();
    await page.getByRole('heading', { name: 'Ballot received.' }).waitFor();
    assert.equal(submissions.length, 2);
    assert.deepEqual(submissions[1], submissions[0], 'A retry must preserve its ID and entire payload');
    await page.reload();
    await page.getByRole('heading', { name: 'Ballot received.' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Submit final ballot' }).count(), 0);
    // Start another candidate, save locally, and advance before final submission.
    state.currentCandidate = { id: 'candidate-two', name: 'Morgan Lee', context: '', order: 1, completed: false };
    state.ballotVersion = 'v2'; state.contextVisible = false;
    await refreshPhase('initial');
    await page.getByRole('heading', { name: 'Morgan Lee' }).waitFor();
    await rate('Reliability', 4);
    await page.getByRole('button', { name: 'Save initial ratings' }).click();
    await waitText('✓ Initial ratings recorded. Ready for discussion.');
    state.currentCandidate = { id: 'candidate-three', name: 'Jordan Wu', context: '', order: 2, completed: false };
    state.ballotVersion = 'v3';
    const beforePoll = stateRequests;
    // Deliberately wait for scheduled polling rather than firing focus.
    await page.getByRole('heading', { name: 'Jordan Wu' }).waitFor({ timeout: 7000 });
    assert.ok(stateRequests > beforePoll);
    await page.getByRole('status').filter({ hasText: '1 earlier ballot remains unsubmitted' }).waitFor();
    assert.equal(await page.getByText('Morgan Lee', { exact: true }).count(), 0);
    assert.equal(await fieldset('Reliability').getByRole('radio', { name: '4', exact: true }).isChecked(), false);
    await refreshPhase('final');
    await page.getByRole('status').filter({ hasText: 'No saved initial ratings were found' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Submit final ballot' }).count(), 0);
    // Presidents are routed to controls and never receive a ballot.
    state.isAdmin = true;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForURL('**/vote/admin');
    assert.equal(await page.getByRole('button', {name: 'Submit final ballot'}).count(), 0);
    assert.equal(submissions.length, 2);
    assert.deepEqual(errors, [], 'No uncaught browser errors');
    console.log('PASS: join, polling, required/optional validation, local refresh persistence, original/revised separation, retry identity/payload, confirmed submission persistence, pending-ballot advance, and admin redirect.');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
