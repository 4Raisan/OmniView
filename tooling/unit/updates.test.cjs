const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createUpdateChecker, isNewer, RELEASE_PAGE } = require('../../app/electron/updates.cjs');
test('stable versions compare numerically and reject prerelease or invalid tags', () => {
  assert.equal(isNewer('v1.10.0', '1.9.0'), true);
  for (const tag of ['v1.9.0', 'v1.8.9', 'v1.9.1-beta.1', 'latest', 'v1.9']) assert.equal(isNewer(tag, '1.9.0'), false);
});
test('only published stable releases produce a trusted update link', async () => {
  for (const release of [{ tag_name: 'v1.10.0' }, { tag_name: 'v1.10.0', draft: true }, { tag_name: 'v1.10.0', prerelease: true }]) {
    const check = createUpdateChecker('1.9.0', async () => ({ ok: true, json: async () => ({ ...release, html_url: 'https://untrusted.example' }) }));
    const result = await check();
    assert.equal(result.status, release.draft || release.prerelease ? 'unavailable' : 'available');
    if (result.status === 'available') assert.equal(result.url, RELEASE_PAGE);
  }
});
test('network failures do not prevent offline use and manual checks recover', async () => {
  let offline = true, calls = 0;
  const check = createUpdateChecker('1.9.0', async (_url, options) => {
    calls++; assert.ok(options.signal); assert.equal(options.redirect, 'error');
    if (offline) throw new Error('offline');
    return { ok: true, json: async () => ({ tag_name: 'v1.9.0' }) };
  });
  assert.equal((await check()).status, 'unavailable');
  offline = false;
  assert.equal((await check()).status, 'unavailable');
  assert.equal(calls, 1);
  assert.equal((await check(true)).status, 'current');
  assert.equal(calls, 2);
});
test('simultaneous checks share one request and HTTP errors remain unavailable', async () => {
  let calls = 0;
  const check = createUpdateChecker('1.9.0', async () => { calls++; return { ok: false }; });
  const results = await Promise.all([check(), check(), check(true)]);
  assert.equal(calls, 1);
  assert.ok(results.every(result => result.status === 'unavailable'));
});
