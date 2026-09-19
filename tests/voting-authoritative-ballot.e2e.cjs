/* Isolated browser regression: all voting APIs are mocked. */
/* eslint-disable @typescript-eslint/no-require-imports */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const assert = require('node:assert/strict');
(async () => { const browser = await chromium.launch(); try {
    const page = await browser.newPage();
    let phase = 'initial', confirmed = false;
    await page.route('**/api/voting/**', r => { const u = r.request().url(); if (u.includes('/initial'))
        return r.fulfill({ status: 409, json: { error: 'Initial ratings have closed for this candidate.' } }); if (u.includes('/ballot'))
        return r.fulfill({ json: { initialRatings: { c: 4 }, finalRatings: null } }); return r.fulfill({ json: { active: true, sessionId: 'unconfirmed-test', isAdmin: false, voter: { id: 'v', name: 'Tester' }, phase, ballotVersion: 'one', currentCandidate: { id: 'a', name: 'Candidate', context: '' }, eligible: true, ownBallot: { initialSubmitted: confirmed, submitted: false }, criteria: [{ id: 'c', label: 'Rating', min: 1, max: 5, required: true }], pollIntervalMs: 500 } }); });
    await page.goto(`${process.env.VOTING_TEST_URL || 'http://localhost:3112'}/vote`);
    await page.getByRole('radio', { name: '4', exact: true }).check();
    await page.getByRole('button', { name: 'Save ratings' }).click();
    await page.getByRole('alert').filter({ hasText: 'Initial ratings have closed' }).waitFor();
    phase = 'final';
    await page.getByText('Initial ratings were not received', { exact: false }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Submit vote' }).count(), 0);
    assert.equal(await page.getByRole('radio').count(), 0);
    await page.evaluate(() => { for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k.startsWith('csc-voting-v1:')) {
            const d = JSON.parse(localStorage.getItem(k));
            localStorage.setItem(k, JSON.stringify({ ...d, initialConfirmed: true, submitted: true, initial: { c: 5 }, final: { c: 5 } }));
        }
    } });
    await page.reload();
    await page.getByText('Initial ratings were not received', { exact: false }).waitFor();
    assert.equal(await page.getByRole('radio').count(), 0);
    confirmed = true;
    await page.getByRole('button', { name: 'Submit vote' }).waitFor({ timeout: 8000 }).catch(async (e) => { console.log(await page.locator('body').innerText()); throw e; });
    assert.ok(await page.getByRole('radio', { name: '4', exact: true }).isChecked());
    await page.waitForTimeout(500);
    assert.equal(await page.getByText('Initial ratings were not received', { exact: false }).count(), 0);
    console.log('PASS: unconfirmed local score blocked; authoritative receipt restores ratings and clears warning');
}
finally {
    await browser.close();
} })().catch(e => { console.error(e); process.exitCode = 1; });
