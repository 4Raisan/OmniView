# Develop OmniView

Use Node.js 22.12 or newer. Install dependencies once with `npm ci`, then use `npm run desktop` to build and open the app. `npm start` opens an existing build; `npm run dev` starts the renderer server. On Windows, `tooling/start-app.bat` also opens an installed copy or builds the source.

## Folder layout

```text
app/       Desktop process, viewers, interface and app icons
docs/     Guides, measured performance, logo and architecture
 tooling/  Build configuration, tests, scripts and pinned parser
```

The root keeps README and the package manifest/lockfile. Hidden Git configuration and workflows stay at the root. `app/index.html` is required: Electron opens its built copy inside the desktop window.

`app/electron/main.cjs` manages native files, safe saves, printing, menus, OS file-open events and recent history. The isolated preload exposes only the desktop API. `app/src/` manages tabs and loads individual readers when needed. Files are parsed locally; external document resources are blocked. History stores at most 25 paths and metadata, never document copies.

## Package for your platform

```sh
npm run package            # Windows installer
npm run package:portable   # Windows portable
npm run package:linux      # Linux x64 AppImage and Debian package
npm run package:mac        # macOS DMG, for the build machine's architecture
```

Build macOS packages on a Mac. GitHub Actions builds separately for Apple Silicon and Intel. Linux packages are x64; other Linux architectures aren't included in these downloads. The AppImage needs executable permission and a system that supports AppImage/FUSE; use the Debian package on compatible distributions. PDF Open with is registered by the Windows installer, Linux desktop package and macOS app; choosing a default stays with the user.

Mac builds use a local ad-hoc signature, without a trusted publisher certificate or notarization. macOS may require approval in System Settings → Privacy & Security. Trusted signing/notarization requires Apple developer credentials. Windows builds are also unsigned. Keep signing keys and credentials outside Git.

## Editing and formats

See [editing details](EDITING.md) and [performance measurements](PERFORMANCE.md). Text and Markdown editing is limited to valid UTF-8 files up to 2 MB. Legacy DOC supports read-only text up to 32 MB; RTF needs conversion to DOCX; spreadsheet formulas display saved values. Other documents have a 256 MB limit; native media streams from disk. Codec support depends on Electron and the platform. These formats and runtime limits apply on every OS.

## Checks and releases

`npm test` runs desktop checks after `npm run build`. Linux tests need a desktop display; CI uses Xvfb. The isolated Linux CI runner disables Chromium sandboxing only for automated tests; user builds keep the renderer sandbox enabled.

CI checks Windows, Linux, Apple Silicon and Intel macOS. The manual **Build release downloads** workflow packages each platform, checks its executable, and collects downloads plus SHA256SUMS.txt in a draft release. It refuses to replace an already published version. Review and publish the draft after all targets pass.

Generated dependencies, `app/dist/`, test output and `release/` stay ignored by Git. The SheetJS archive in `tooling/vendor/` is a required pinned dependency, not a backup. Application identity and preference keys remain compatible with earlier OmniView/Multi-Viewer installs.

Each release also includes a source ZIP generated from the exact checked commit, including hidden workflow files and the pinned vendor archive. It excludes ignored local files, credentials, node_modules and generated build output. Its checksum is included in SHA256SUMS.txt.

The main process checks the fixed GitHub latest-release API with an eight-second timeout. Results are cached in memory for one hour; the Help menu forces a fresh check. Version comparison is numeric and accepts stable major.minor.patch tags only. External update and support links are fixed to OmniView's repository; document network blocking remains in place.

## Legacy Word DOC

Binary Word 97–2003 `.doc` files open as read-only text in the desktop app, including Unicode, headers, footers, footnotes, endnotes, text boxes and comments when present. Images, table structure, styling and original page layout are not reproduced. DOCX retains its formatted viewer. RTF/HTML disguised with a `.doc` extension and encrypted DOC files are rejected with a conversion message.

`npm run build` bundles the pinned MIT-licensed binary reader into a standalone Node worker and copies its license. Packaged apps unpack that worker beside the ASAR archive; runtime parsing needs no installed Word, LibreOffice, network service or node_modules. The isolated renderer sends only file bytes through the preload bridge; the handler accepts no filesystem paths. Extracted text is inserted with textContent, without evaluating document content or macros.

Limits: 32 MB input, 5 million extracted characters, a 15-second worker timeout, a 128 MB worker JavaScript heap limit and at most two active readers. These are parser safeguards, not a promise of protection against every malformed file. Genuine Word 97, Unicode, headers/footers, notes, encrypted flags, malformed input, ZIP nesting and packaged-worker paths are covered by the checks.
