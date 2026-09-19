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
  const savedInitials = new Map();
  let rejectSubmission = true;
  let transientFailures = 2;
  const state = {
    sessionId: 'ui-test-session', active: true, phase: 'waiting', votingStarted: false, ballotVersion: 'v1',
    currentCandidate: { id: 'candidate-one', name: 'Alex Chen', context: 'Community events and transparent budgets.', order: 0, completed: false },
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
    if (path.endsWith('/president')) return reply(200,{enabled:true,election:{sessionId:state.sessionId,name:'Test election',open:true}});
    if (path.endsWith('/state')) {
      stateRequests++;
      return authenticated ? reply(200, state) : reply(401, { error: 'Join the session.' });
    }
    if (path.endsWith('/join')) {
      joinRequests.push(route.request().postDataJSON()); authenticated = true;
      return reply(200, { ok: true });
    }
    if (path.endsWith('/ballot')) return reply(200, {initialRatings:savedInitials.get(state.currentCandidate.id) || {reliability:2,experience:null}, finalRatings:state.ownBallot?.submitted ? {reliability:4,experience:null} : null, submissionId:state.ownBallot?.submitted ? 'recovered-vote' : null});
    if (path.endsWith('/initial')) { savedInitials.set(state.currentCandidate.id, route.request().postDataJSON().ratings); state.ownBallot = {initialSubmitted:true,submitted:false}; return reply(200, {ok:true}); }
    if (path.endsWith('/submit')) {
      const ballot = route.request().postDataJSON(); submissions.push(ballot);
      if (rejectSubmission) return reply(409, {error:'Submission is closed.'});
      if (transientFailures-- === 2) return reply(503, {error:'Temporary spreadsheet failure.'});
      if (transientFailures === 0) return route.abort('failed');
      state.ownBallot = {initialSubmitted:true,submitted:true};
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
    await page.getByLabel('Name').fill('Test Voter');
    await page.getByLabel('Code').fill('private-test-password');
    await page.getByRole('button', { name: 'Join' }).click();
    await page.getByRole('heading', { name: 'You’re in.' }).waitFor();
    await waitText('Joined as Test Voter');
    state.votingStarted = true;
    await refreshPhase('initial');
    await page.getByRole('heading', { name: 'Alex Chen' }).waitFor();
    assert.equal(joinRequests.length, 1);
    assert.equal(joinRequests[0].name, 'Test Voter');
    assert.equal(joinRequests[0].password, 'private-test-password');
    assert.match(joinRequests[0].joinId, /^[0-9a-f-]{36}$/);
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
    await page.getByRole('button',{name:'View platform'}).click();
    await page.getByRole('dialog').waitFor();
    assert.equal(await page.getByRole('dialog').getByText('Community events and transparent budgets.').count(),1);
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('radio').count(),0,'Discussion should hide the ballot');
    assert.equal(await page.getByRole('button',{name:'Save ratings'}).count(),0);
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await page.locator('.voter-discussion-shimmer').evaluate(el => getComputedStyle(el).animationName),'none');
    await page.emulateMedia({reducedMotion:'no-preference'});
    state.contextVisible = true; state.currentCandidate.context = 'Discussion notes released by admin.';
    await refreshPhase('revision');
    assert.equal(await page.getByText('Discussion notes released by admin.').isVisible(), false);
    await page.getByRole('button',{name:'View platform'}).click();
    assert.equal(await page.getByText('Discussion notes released by admin.').isVisible(), true);
    await page.keyboard.press('Escape');
    await rate('Reliability', 5);
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:'/private/tmp/voting-mobile-mockup.png'});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
    await page.reload();
    await page.locator('.voter-phase').filter({ hasText: 'Voting open' }).waitFor();
    assert.equal(await fieldset('Reliability').getByRole('radio', { name: '3', exact: true }).isChecked(), true, 'Reload restores server ratings rather than unsent local revisions');
    await rate('Reliability', 5);
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
    state.ownBallot = {initialSubmitted:false,submitted:false};
    state.ballotVersion = 'v2'; state.contextVisible = false;
    await refreshPhase('initial');
    await page.getByRole('heading', { name: 'Morgan Lee' }).waitFor();
    await rate('Reliability', 4);
    await page.getByRole('button', { name: 'Save ratings' }).click();
    await waitText('Ratings saved');
    state.currentCandidate = { id: 'candidate-three', name: 'Jordan Wu', context: '', order: 2, completed: false };
    state.ballotVersion = 'v3'; state.ownBallot = {initialSubmitted:false,submitted:false};
    const beforePoll = stateRequests;
    // Deliberately wait for scheduled polling rather than firing focus.
    await page.getByRole('heading', { name: 'Jordan Wu' }).waitFor({ timeout: 7000 });
    assert.ok(stateRequests > beforePoll);
    await page.getByRole('status').filter({ hasText: '1 earlier vote is unfinished' }).waitFor();
    assert.equal(await page.getByText('Morgan Lee', { exact: true }).count(), 0);
    assert.equal(await fieldset('Reliability').getByRole('radio', { name: '4', exact: true }).isChecked(), false);
    state.phase = 'final';
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.getByRole('status').filter({ hasText: 'Initial ratings were not received' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Submit vote' }).count(), 0);
    assert.equal(await page.getByRole('radio').count(),0,'No local ratings are shown without a server receipt');
    // Recover accepted initial and final ballots after browser storage is cleared.
    state.ownBallot = {initialSubmitted:true,submitted:false}; state.pollIntervalMs=2000;
    await page.evaluate(()=>localStorage.clear()); await page.reload();
    await page.getByRole('button',{name:'Submit vote'}).waitFor();
    assert.equal(await fieldset('Reliability').getByRole('radio',{name:'2',exact:true}).isChecked(),true);
    await rate('Reliability',5);
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    assert.equal(await fieldset('Reliability').getByRole('radio',{name:'5',exact:true}).isChecked(),true,'Polling must preserve unsent revisions');
    state.ownBallot.submitted=true;
    await page.evaluate(()=>localStorage.clear()); await page.reload();
    await page.getByRole('heading',{name:'Vote submitted for Jordan Wu'}).waitFor();
    assert.equal(submissions.length,4,'Recovery does not resubmit a ballot');
    state.phase='locked'; state.votingComplete=true;
    await page.getByRole('heading',{name:'Voting is complete.',exact:true}).waitFor({timeout:7000});
    assert.equal(await page.getByText('Waiting for the next candidate',{exact:true}).count(),0);
    state.phase='final'; state.votingComplete=false;
    await page.getByRole('heading',{name:'Vote submitted for Jordan Wu'}).waitFor({timeout:7000});
    state.admissionPending=true; state.eligible=false; state.phase='waiting'; state.currentCandidate=null; state.criteria=[];
    await page.reload();
    await page.getByRole('heading',{name:'Waiting for admission',exact:true}).waitFor();
    assert.equal(await page.getByRole('radio').count(),0);
    assert.equal(await page.getByText('Jordan Wu',{exact:true}).count(),0);
    state.admissionPending=false; state.currentCandidate={id:'later',name:'Jordan Wu',context:'',order:2,completed:false};
    state.eligible=false; state.phase='initial'; state.ownBallot={initialSubmitted:false,submitted:false};
    await page.reload();
    await page.getByText('Waiting for admission',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Submit vote'}).count(),0);
    state.phase='deliberation'; await page.reload();
    await page.getByText('Initial ratings have closed. You can participate when the next candidate starts.',{exact:true}).waitFor();
    assert.equal(await page.getByText('Discussion in progress',{exact:true}).count(),0);
    state.eligible=true;
    // Presidents are routed to controls and never receive a ballot.
    state.isAdmin = true;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.locator('.voting-console').waitFor();
    assert.equal(new URL(page.url()).pathname,'/vote/admin');
    assert.equal(await page.getByRole('button', {name: 'Submit vote'}).count(), 0);
    assert.equal(submissions.length, 4);
    assert.deepEqual(errors, [], 'No uncaught browser errors');
    console.log('PASS: join, polling, required/optional validation, local refresh persistence, original/revised separation, retry identity/payload, confirmed submission persistence, pending-ballot advance, and admin redirect.');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
