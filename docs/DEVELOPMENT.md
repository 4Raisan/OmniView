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

## Install a download

**Windows.** The installer is per-user and needs no administrator rights. Builds are unsigned, so SmartScreen shows "Windows protected your PC" — choose **More info → Run anyway**. To verify a download first, compare its SHA256 against `SHA256SUMS.txt` on the release page:

```powershell
Get-FileHash .\OmniView-Setup-1.10.0-x64.exe -Algorithm SHA256
```

The portable EXE needs no installation; run it from any writable folder. Uninstall the installed copy through Settings → Apps → Installed apps → OmniView.

**macOS.** Builds use an ad-hoc signature and are not notarized, so Gatekeeper blocks the first launch. Open the DMG, drag OmniView to Applications, then either right-click the app and choose **Open**, or clear the quarantine flag:

```sh
xattr -dr com.apple.quarantine /Applications/OmniView.app
```

If it is still blocked, approve it in System Settings → Privacy & Security. Delete the app from Applications to uninstall.

**Linux.** Make the AppImage executable and run it; it needs FUSE, which some minimal or container systems lack:

```sh
chmod +x OmniView-1.10.0-linux-x86_64.AppImage
./OmniView-1.10.0-linux-x86_64.AppImage
```

On Debian/Ubuntu use the package instead: `sudo apt install ./OmniView-1.10.0-linux-amd64.deb`, and remove it with `sudo apt remove omniview`.

**All platforms.** Verify any download against `SHA256SUMS.txt` before running it. Release artifacts also carry a GitHub build-provenance attestation, checkable with `gh attestation verify <file> --repo 4Raisan/OmniView`.

## Troubleshooting

- **A file opens as garbled text or is refused.** OmniView picks a viewer from the extension, then from the file's header bytes. Formats it cannot render (MKV, AVI, RAR, 7-Zip, executables, PPTX) are named in the error rather than shown as text. Convert to a supported format.
- **A PDF asks for a password.** Enter it in the viewer. Cancelling leaves the document unopened; nothing is sent anywhere.
- **A PDF page is blank or slow.** Pages render as they approach the viewport. Very large pages are rasterized within a fixed pixel budget, so extreme zoom can look soft.
- **A spreadsheet shows fewer rows than expected.** Sheets are read up to 200,000 rows × 512 columns; a toolbar badge says when the range was limited.
- **A ZIP entry will not preview.** Entries declaring more than 256 MB uncompressed are refused before decompression. Extract them with an archive tool.
- **Media will not play.** The player reports whether the container/codec is unsupported or the file is damaged. Convert to MP4 (H.264/AAC), WebM, MP3, WAV, OGG, M4A or FLAC.
- **Saving reports an external change.** Another program modified the file since it was opened. Use Save As to keep both versions.

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

`npm test` runs the `node:test` unit checks (legacy DOC parsing and the update checker, no build needed) and then the Playwright desktop checks, which require `npm run build` first. Linux tests need a desktop display; CI uses Xvfb. The isolated Linux CI runner disables Chromium sandboxing only for automated tests; user builds keep the renderer sandbox enabled.

Desktop checks share one application instance and run in file order, so a failure can cascade into later tests. `tooling/tests/desktop.spec.cjs` covers the original surface; `tooling/tests/fixes.spec.cjs` covers format sniffing, sanitizing, decompression budgets, PDF text/search/passwords, PPTX slides, spreadsheet formatting, chunked code rendering and find, tab keyboard access, window lifecycle and crash recovery. The crash-recovery test kills its Electron instance outright and relaunches it, so it stays near the end of the file. CI uploads `tooling/test-results/` traces when a run fails.

CI checks Windows, Linux, Apple Silicon and Intel macOS, and audits shipped dependencies with `npm audit --omit=dev --audit-level=high`. The manual **Build release downloads** workflow first checks the ref and version, then packages each platform, checks its executable, attests build provenance and collects downloads plus SHA256SUMS.txt in a draft release. It refuses to replace an already published version. Review and publish the draft after all targets pass.

On Windows the release workflow also runs `tooling/scripts/verify-windows-installer.ps1`: it silently installs the real NSIS setup on the disposable runner, asserts the per-user PDF registrations and uninstall entry exist without touching the protected PDF default, runs the desktop checks against the **installed** executable, then uninstalls and asserts the registrations, shortcuts and uninstall entry are gone. That script installs software for the current user — run it only on a disposable CI runner, never on a development machine.

The portable EXE, DMG, AppImage and .deb are still not exercised by an automated install; their first-run behaviour needs a manual check on a clean machine before publishing.

Generated dependencies, `app/dist/`, test output and `release/` stay ignored by Git. The SheetJS archive in `tooling/vendor/` is a required pinned dependency, not a backup. Application identity and preference keys remain compatible with earlier OmniView/Multi-Viewer installs.

Each release also includes a source ZIP generated from the exact checked commit, including hidden workflow files and the pinned vendor archive. It excludes ignored local files, credentials, node_modules and generated build output. Its checksum is included in SHA256SUMS.txt.

The main process checks the fixed GitHub latest-release API with an eight-second timeout. Results are cached in memory for one hour; the Help menu forces a fresh check. Version comparison is numeric and accepts stable major.minor.patch tags only. Update, Help and support links are fixed to OmniView's repository.

Hyperlinks **inside a document** are different: Markdown and DOCX anchors are opened with `shell.openExternal`, so clicking one opens the user's normal browser at whatever URL the document author chose. Subresource requests (images, stylesheets, scripts, fonts) from documents are blocked, so a document cannot contact a server on its own; only an explicit click can. See [PRIVACY.md](PRIVACY.md).

## Legacy Word DOC

Binary Word 97–2003 `.doc` files open as read-only text in the desktop app, including Unicode, headers, footers, footnotes, endnotes, text boxes and comments when present. Images, table structure, styling and original page layout are not reproduced. DOCX retains its formatted viewer. RTF/HTML disguised with a `.doc` extension and encrypted DOC files are rejected with a conversion message.

`npm run build` bundles the pinned MIT-licensed binary reader into a standalone Node worker and copies its license. Packaged apps unpack that worker beside the ASAR archive; runtime parsing needs no installed Word, LibreOffice, network service or node_modules. The isolated renderer sends only file bytes through the preload bridge; the handler accepts no filesystem paths. Extracted text is inserted with textContent, without evaluating document content or macros.

Limits: 32 MB input, 5 million extracted characters, a 15-second worker timeout, a 128 MB worker JavaScript heap limit and at most two active readers. These are parser safeguards, not a promise of protection against every malformed file. Genuine Word 97, Unicode, headers/footers, notes, encrypted flags, malformed input, ZIP nesting and packaged-worker paths are covered by the checks.
