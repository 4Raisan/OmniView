const RELEASE_API = 'https://api.github.com/repos/4Raisan/OmniView/releases/latest';
const RELEASE_PAGE = 'https://github.com/4Raisan/OmniView/releases/latest';
const versionParts = value => /^v?\d+\.\d+\.\d+$/.test(value) ? value.replace(/^v/, '').split('.').map(Number) : null;
function isNewer(candidate, current) {
  const next = versionParts(candidate), installed = versionParts(current);
  if (!next || !installed) return false;
  for (let i = 0; i < 3; i++) {
    if (next[i] !== installed[i]) return next[i] > installed[i];
  }
  return false;
}
function createUpdateChecker(currentVersion, fetchRelease = (...args) => fetch(...args)) {
  let cached, checkedAt = 0, pending;
  return function check(force = false) {
    if (pending) return pending;
    if (!force && cached && Date.now() - checkedAt < 60 * 60 * 1000) return Promise.resolve(cached);
    pending = (async () => {
      try {
        const response = await fetchRelease(RELEASE_API, {
          headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'OmniView-update-check' },
          signal: AbortSignal.timeout(8000), redirect: 'error'
        });
        if (!response.ok) throw new Error('Release check unavailable');
        const release = await response.json();
        if (!release || release.draft || release.prerelease || !versionParts(release.tag_name)) throw new Error('Invalid stable release');
        cached = { status: isNewer(release.tag_name, currentVersion) ? 'available' : 'current', currentVersion,
          latestVersion: release.tag_name.replace(/^v/, ''), url: RELEASE_PAGE };
      } catch {
        cached = { status: 'unavailable', currentVersion };
      }
      checkedAt = Date.now();
      return cached;
    })().finally(() => { pending = null; });
    return pending;
  };
}
module.exports = { createUpdateChecker, isNewer, RELEASE_PAGE };
