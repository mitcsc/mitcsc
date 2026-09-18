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
  let transientFailures = 2;
  const state = {
    sessionId: 'ui-test-session', active: true, phase: 'waiting', votingStarted: false, ballotVersion: 'v1',
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
    if (path.endsWith('/initial')) return reply(200, {ok:true});
    if (path.endsWith('/submit')) {
      const ballot = route.request().postDataJSON(); submissions.push(ballot);
      if (rejectSubmission) return reply(409, {error:'Submission is closed.'});
      if (transientFailures-- === 2) return reply(503, {error:'Temporary spreadsheet failure.'});
      if (transientFailures === 0) return route.abort('failed');
      return reply(200, {ok:true, submissionId:ballot.submissionId});
    }
    throw new Error(`Unexpected voting API route: ${path}`);
  });
  const waitText = text => page.getByText(text, { exact: true }).waitFor();
  const fieldset = label => page.locator('fieldset').filter({ has: page.locator('legend', { hasText: label }) });
  const rate = async (label, value) => fieldset(label).getByRole('radio', { name: String(value), exact: true }).check();
  const refreshPhase = async phase => {
    state.phase = phase;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    if (phase === 'deliberation') { await page.getByRole('status').filter({hasText:'Discussion in progress'}).waitFor(); return; }
    await page.locator('.voter-phase').filter({ hasText: ({ initial: 'Initial ratings', deliberation: 'Discussion', revision: 'Voting open', final: 'Voting open', locked: 'Voting closed' })[phase] }).waitFor();
  };
  try {
    await page.goto(`${baseURL}/vote`);
    await page.getByLabel('Your name').fill('Test Voter');
    await page.getByLabel('Session password').fill('private-test-password');
    await page.getByRole('button', { name: 'Join' }).click();
    await page.getByRole('heading', { name: 'You’re in.' }).waitFor();
    await waitText('Joined as Test Voter');
    state.votingStarted = true;
    await refreshPhase('initial');
    await page.getByRole('heading', { name: 'Alex Chen' }).waitFor();
    assert.deepEqual(joinRequests, [{ name: 'Test Voter', password: 'private-test-password', role: 'voter' }]);
    assert.equal(await fieldset('Reliability').getByRole('radio', { name: 'Not enough information' }).count(), 0);
    assert.equal(await fieldset('Experience').getByRole('radio', { name: 'Not enough information' }).count(), 1);
    await page.getByRole('button', { name: 'Save ratings' }).click();
    await waitText('Choose a numeric rating for each required criterion.');
    await rate('Reliability', 3);
    await fieldset('Experience').getByRole('radio', { name: 'Not enough information' }).check();
    await page.getByRole('button', { name: 'Save ratings' }).click();
    await waitText('Ratings saved');
    assert.equal(submissions.length, 0, 'Initial ratings must stay local');
    await page.reload();
    await waitText('Ratings saved');
    assert.equal(await fieldset('Reliability').getByRole('radio', { name: '3', exact: true }).isChecked(), true);
    assert.equal(await fieldset('Reliability').getByRole('radio', { name: '4', exact: true }).isDisabled(), true);
    await refreshPhase('deliberation');
    assert.equal(await page.getByRole('radio').count(),0,'Discussion should hide the ballot');
    assert.equal(await page.getByRole('button',{name:'Save ratings'}).count(),0);
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await page.locator('.voter-discussion-shimmer').evaluate(el => getComputedStyle(el).animationName),'none');
    await page.emulateMedia({reducedMotion:'no-preference'});
    state.contextVisible = true; state.currentCandidate.context = 'Discussion notes released by admin.';
    await refreshPhase('revision');
    assert.equal(await page.getByText('Discussion notes released by admin.').count(), 0);
    await rate('Reliability', 5);
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:'/private/tmp/voting-mobile-mockup.png'});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
    await page.reload();
    await page.locator('.voter-phase').filter({ hasText: 'Voting open' }).waitFor();
    assert.equal(await fieldset('Reliability').getByRole('radio', { name: '5', exact: true }).isChecked(), true);
    assert.equal(await fieldset('Reliability').locator('.voter-rating-initial').innerText(),'3');
    assert.equal(await page.locator('.voter-footnote').count(),0);
    await page.getByRole('button', { name: 'Submit vote' }).click();
    await page.getByRole('alert').filter({ hasText: 'Submission is closed.' }).waitFor();
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
    await page.getByRole('button', { name: 'Submit vote' }).click();
    await page.getByRole('heading', { name: 'Vote submitted for Alex Chen' }).waitFor({timeout:35000});
    assert.equal(submissions.length, 4);
    for(const attempt of submissions.slice(1)) assert.deepEqual(attempt, submissions[0], 'Every automatic and manual retry must preserve its ID and entire payload');
    await page.reload();
    await page.getByRole('heading', { name: 'Vote submitted for Alex Chen' }).waitFor({timeout:35000});
    assert.equal(await page.getByRole('button', { name: 'Submit vote' }).count(), 0);
    state.phase = 'waiting';
    await page.reload();
    await page.getByRole('heading', {name:'Waiting for the next candidate',exact:true}).waitFor();
    assert.equal(await page.getByRole('heading', {name:'You’re in.',exact:true}).count(),0);
    // Start another candidate, save locally, and advance before final submission.
    state.currentCandidate = { id: 'candidate-two', name: 'Morgan Lee', context: '', order: 1, completed: false };
    state.ballotVersion = 'v2'; state.contextVisible = false;
    await refreshPhase('initial');
    await page.getByRole('heading', { name: 'Morgan Lee' }).waitFor();
    await rate('Reliability', 4);
    await page.getByRole('button', { name: 'Save ratings' }).click();
    await waitText('Ratings saved');
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
    assert.equal(await page.getByRole('button', { name: 'Submit vote' }).count(), 0);
    // Presidents are routed to controls and never receive a ballot.
    state.isAdmin = true;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.locator('.voting-console').waitFor();
    assert.equal(new URL(page.url()).pathname,'/vote');
    assert.equal(await page.getByRole('button', {name: 'Submit vote'}).count(), 0);
    assert.equal(submissions.length, 4);
    assert.deepEqual(errors, [], 'No uncaught browser errors');
    console.log('PASS: join, polling, required/optional validation, local refresh persistence, original/revised separation, retry identity/payload, confirmed submission persistence, pending-ballot advance, and admin redirect.');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
