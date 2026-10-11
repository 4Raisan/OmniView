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

See [editing details](EDITING.md) and [performance measurements](PERFORMANCE.md). Text and Markdown editing is limited to valid UTF-8 files up to 2 MB. DOC/RTF need conversion to DOCX; spreadsheet formulas display saved values. Documents have a 256 MB limit; native media streams from disk. Codec support depends on Electron and the platform. These formats and runtime limits apply on every OS.

## Checks and releases

`npm test` runs desktop checks after `npm run build`. Linux tests need a desktop display; CI uses Xvfb. The isolated Linux CI runner disables Chromium sandboxing only for automated tests; user builds keep the renderer sandbox enabled.

CI checks Windows, Linux, Apple Silicon and Intel macOS. The manual **Build release downloads** workflow packages each platform, checks its executable, and collects downloads plus SHA256SUMS.txt in a draft release. It refuses to replace an already published version. Review and publish the draft after all targets pass.

Generated dependencies, `app/dist/`, test output and `release/` stay ignored by Git. The SheetJS archive in `tooling/vendor/` is a required pinned dependency, not a backup. Application identity and preference keys remain compatible with earlier OmniView/Multi-Viewer installs.
