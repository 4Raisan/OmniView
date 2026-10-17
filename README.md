<p align="center"><img src="docs/assets/logo.svg" alt="OmniView — Any File. One Viewer." width="440"></p>

View local files in one tabbed desktop app on Windows, Linux and macOS. Documents stay on your computer; viewing works offline.

## Download

**Version 1.10.0 · [All downloads and checksums](https://github.com/4Raisan/OmniView/releases/tag/v1.10.0)**

- **Windows x64:** [Installer](https://github.com/4Raisan/OmniView/releases/download/v1.10.0/OmniView-Setup-1.10.0-x64.exe) or [portable](https://github.com/4Raisan/OmniView/releases/download/v1.10.0/OmniView-Portable-1.10.0-x64.exe).
- **Linux x64:** [AppImage](https://github.com/4Raisan/OmniView/releases/download/v1.10.0/OmniView-1.10.0-linux-x86_64.AppImage) or [Debian package](https://github.com/4Raisan/OmniView/releases/download/v1.10.0/OmniView-1.10.0-linux-amd64.deb).
- **macOS:** [Apple Silicon](https://github.com/4Raisan/OmniView/releases/download/v1.10.0/OmniView-1.10.0-mac-arm64.dmg) or [Intel](https://github.com/4Raisan/OmniView/releases/download/v1.10.0/OmniView-1.10.0-mac-x64.dmg).

**Source:** [Complete project ZIP](https://github.com/4Raisan/OmniView/releases/download/v1.10.0/OmniView-1.10.0-source.zip) · [SHA256 checksums](https://github.com/4Raisan/OmniView/releases/download/v1.10.0/SHA256SUMS.txt).

Choose PDF defaults through your OS's **Open with** settings. Windows builds are unsigned; Mac builds use ad-hoc signing and are not notarized. See [installation notes](docs/DEVELOPMENT.md).

## What it does

- View PDFs, DOCX, legacy DOC text, spreadsheets, Markdown, text/code, images, audio/video and ZIP archives.
- Use compact tabs, drag and drop, search, six dark themes, adjustable text size and a resizable sidebar.
- Reopen your last 25 files from disk.
- Edit UTF-8 text and Markdown up to **2 MB**, with safe saves and live Markdown split preview.
- Scroll PDF pages continuously and stream native media from disk.
- From version 1.9.0, see a notice when a newer stable release is published. Use **Help → Check for updates** at any time.

Legacy DOC opens offline in a read-only text view, including Unicode, headers, footers and notes (up to 32 MB). Original page layout, images and formatting are not shown; use DOCX for formatted viewing. Password-protected DOC and RTF need conversion to unprotected DOCX. Media playback depends on codec support; spreadsheet formulas display saved values.

**Shortcuts:** use Cmd on Mac, Ctrl elsewhere. Ctrl+O open · Ctrl+W close tab · Ctrl+B sidebar · Ctrl+P print · F11 fullscreen.

## How it works

![OmniView architecture](docs/assets/architecture.svg)

## Build from source

Use Node.js 22.12 or newer.

Releases from 1.9.0 include **OmniView-VERSION-source.zip**, a complete source bundle with the pinned SheetJS archive, build configuration and documentation. Extract it, then run the commands below. Installed dependencies and Electron are downloaded by `npm ci`; the ZIP is not a preinstalled application. The app downloads are separate release assets, so large binaries do not need to be committed to Git.

Update checks contact GitHub Releases at startup and when requested; they send no document contents, filenames or local paths. Checks time out if offline and do not interrupt viewing. A notice opens the release page for a manual download; it does not install updates. Only published stable releases trigger notices, not commits or drafts. Versions before 1.9.0 need one manual upgrade to gain update notices.

```sh
npm ci
npm run build
npm start
```

`npm run package` builds Windows; `npm run package:linux` builds Linux; `npm run package:mac` builds on macOS.

[Detailed guide](docs/DEVELOPMENT.md) · [Editing](docs/EDITING.md) · [Measured performance](docs/PERFORMANCE.md)

## Support

[Star OmniView](https://github.com/4Raisan/OmniView) if it helps you. [Share ideas and feedback](https://github.com/4Raisan/OmniView/discussions/5), or [report a problem](https://github.com/4Raisan/OmniView/issues).

## Code signing policy

Windows builds are currently unsigned; signing-provider enrollment is being prepared. See the [code signing policy](docs/CODE_SIGNING.md) and [privacy policy](docs/PRIVACY.md). Signing status will be changed only after verified signed downloads are available.

## License

[MIT](LICENSE) · Copyright © 2026 4Raisan. Third-party dependencies retain their own licenses.
