# Contributing to OmniView

Thanks for considering a contribution. OmniView is a small offline file viewer;
the most useful contributions keep it small, fast and safe with untrusted files.

## Setup

Node.js 22.12 or newer.

```sh
npm ci
npm run build
npm start
```

`npm run desktop` builds and opens in one step. `npm run dev` serves the renderer
only — the desktop API is absent there, so file dialogs, saving and legacy DOC
do not work in a plain browser.

## Checks

```sh
npm run build
npm test
```

`npm test` runs the `node:test` unit checks and then the Playwright desktop
checks. The desktop checks launch a real Electron window.

Two things to know before editing tests:

- `tooling/tests/desktop.spec.cjs` shares one application instance across tests
  and runs in file order. Some tests stub `dialog` or `fetch` globally. Running a
  subset with `--grep` can fail for reasons unrelated to your change — always run
  the whole file before concluding you broke something.
- Put new coverage in `tooling/tests/fixes.spec.cjs`, which has its own instance
  and an `afterAll` that closes it. The crash-recovery test near the end kills
  that instance outright and relaunches it, so keep it after the tests that
  depend on the original instance and before the final no-window test.

`tooling/scripts/verify-windows-installer.ps1` silently installs and uninstalls
the app for the current Windows user. It runs only on a disposable CI runner.
Do not run it on your own machine: it writes HKCU registrations and shortcuts.

If you change viewer behaviour, add a test that fails without the change. For
parser and sanitizer work, build a minimal synthetic fixture rather than
committing a real document.

## Conventions

The existing code is deliberately compact and dependency-light. Please match it:

- no new runtime dependency without a strong reason — the app ships eight
  viewers and a text editor with seven runtime dependencies,
- no comments that restate the code; comment only non-obvious constraints,
- untrusted HTML goes through `app/src/utils/safeHtml.js`, never straight into
  `innerHTML`,
- untrusted text goes in with `textContent`,
- new limits belong in `app/src/utils/fileHelpers.js` or the relevant viewer as a
  named constant, and must be documented in `docs/`,
- anything that can grow without bound (DOM rows, decompressed bytes, rasterized
  pixels, retained buffers) needs an explicit budget.

## Security

Report vulnerabilities privately — see [SECURITY.md](SECURITY.md). Do not open a
public issue with a working exploit or a real document attached.

## Releases

Releases are cut by the maintainer through the **Build release downloads**
workflow, which packages all four targets, checks each executable, attests build
provenance and produces a draft with SHA256SUMS.txt. Contributors do not need to
build installers.

If your change is user-visible, add a line to the `Unreleased` section of
[CHANGELOG.md](CHANGELOG.md).