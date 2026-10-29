## What and why

<!-- What does this change, and what problem does it solve? Link any issue. -->

## How it was verified

<!-- `npm run build && npm test` is the minimum. Say which tests you added or
     changed, and whether you ran the whole desktop.spec.cjs file (a --grep
     subset can fail for unrelated reasons because tests share one app instance). -->

- [ ] `npm run build` succeeds
- [ ] `npm test` passes in full (unit + both desktop spec files)
- [ ] Added or updated a test that fails without this change
- [ ] Manually checked the affected viewer on at least one platform

## Risk checklist

- [ ] Untrusted HTML goes through `safeHtml.js`; untrusted text uses `textContent`
- [ ] Anything that can grow without bound has an explicit budget
- [ ] No new runtime dependency, or the reason for it is explained above
- [ ] User-visible limits and behaviour are documented in `docs/`
- [ ] `CHANGELOG.md` updated under `Unreleased` if this is user-visible
- [ ] No real personal or confidential documents committed as fixtures