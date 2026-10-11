# OmniView detailed guide

<p align="center"><img src="assets/logo.svg" alt="OmniView" width="440"></p>

**OmniView — Any File. One Viewer.**

A Windows desktop viewer for local documents, spreadsheets, PDFs, code, images, media and ZIP archives. File parsing stays on your computer. The installer includes the runtime; users do not need Node.js or an internet connection.

## Install and share

Run **`release/OmniView-Setup-1.7.0-x64.exe`**. Send this installer to friends. A portable alternative is `release/OmniView-Portable-1.7.0-x64.exe`; it does not install shortcuts or register PDF Open with. The installer runs for the current Windows user, creates shortcuts, and adds OmniView to PDF **Open with** choices. Choose it with **Always** if you want PDF double-clicks to use it; the installer preserves the current default PDF app.

Installers are local build artifacts, ignored by Git. Attach them to a GitHub Release when publishing rather than committing them to the repository. This release is unsigned; Windows reputation warnings remain possible.

## Features

- Stateful tabs with scroll arrows and compact tabs with file-type icons and ten filename characters when the bar fills, drag and drop, and a resizable sidebar.
- Saved text size from 80% to 150%, independent of document zoom.
- The last 25 real files reopen from disk, including after refresh or restart. Reopening reads current contents; missing files are marked. Recent history stores paths and metadata, not file copies. Existing name-only history cannot recover original paths: open those files once again.
- Continuous PDF scrolling, page arrows, zoom, rotation, all-page printing and original-file export.
- Spreadsheet sheets, row filtering, pagination, clipboard copy and CSV export.
- DOCX page and continuous layouts; Markdown search, preview, raw and split views, including live split editing.
- Highlighted code, search, line wrapping and JSON formatting.
- Image zoom and pan, media controls, and nested ZIP previews.
- Six dark palettes (Slate, Midnight, Graphite, Forest, Violet, Ember) plus Light.

Supported formats include XLSX/XLS/CSV/TSV/ODS, DOCX, PDF, Markdown, common text/code files, common image formats, browser-supported audio/video, and ZIP. Legacy DOC/RTF need conversion to DOCX. UTF-8 text/code and Markdown files up to 2 MB can be edited with Save and Save As; other formats are view-only; spreadsheet formulas show saved values. Documents and browser-imported files are limited to 256 MB. Media opened through the native picker, Windows arguments, recent history or desktop drag and drop streams from disk without that size cap; codec support still depends on Electron.

**Shortcuts:** Ctrl+O open · Ctrl+W close tab · Ctrl+B sidebar · Ctrl+P print · F11 fullscreen.

## Develop

The Copy toolbar button uses selected document text, or the whole source when nothing is selected. Code line numbers are excluded. Text editing is enabled for valid UTF-8 files up to 2 MB. Use Edit / Preview, Save, Save As, Ctrl+S and Ctrl+Shift+S. Unsaved drafts stay with their tabs. Closing or refreshing prompts to save, discard or cancel. External changes prevent saving over the original; choose a different Save As file. UTF-8 BOM and CRLF are preserved. Undo/redo uses the native text area within an editing session.

Use Node.js 22.12 or newer on Windows. Dependencies and build output are intentionally absent from a clean checkout.

```sh
npm ci
npm run build
npm test
npm start
```

`npm run dev` starts the renderer development server. `npm run desktop` builds and opens the desktop app. `start-app.bat` opens an installed copy, or installs dependencies and builds the source checkout.

```sh
npm run package             # Windows installer
npm run package:portable    # Portable executable
```

Generated files go to `dist/`, `release/`, and `test-results/`; all are ignored by Git. Windows CI builds the renderer and runs the desktop integration tests. The SheetJS 0.20.3 archive is deliberately kept in `vendor/` because the npm registry version is outdated; `npm ci` installs the pinned local archive.

## Size and startup

The desktop interface starts from index.html; Electron loads its built copy locally inside the native window. Keep this source file. The installer includes Electron, which accounts for most of its size. Packaging excludes duplicate dependency folders because Vite bundles the viewer libraries, and retains only English Electron interface resources. PDF character maps, fonts and decoders remain bundled for documents in other languages. Viewer parsers load on demand rather than at startup.

Inactive PDF tabs release page-image canvases; inactive text and Markdown previews release their rendered document nodes. Tab settings and unsaved drafts remain available. Selecting an inactive document rebuilds its preview. Media streams through an authorized local range endpoint instead of copying the entire file into memory. Switching away pauses playback and releases its source; returning restores the position and speed without autoplay.

Markdown live previews update 250 ms after typing for documents up to 131,072 characters. Larger editable files use **Refresh preview**. Formatted previews show at most the first 65,536 characters or 2,000 lines, with a visible notice; Raw view, Copy, editing and saving retain the full document. Search highlights up to 2,000 matches within the displayed preview. No editor dependency was added. See [editing details](EDITING.md).

See [the measured performance report](PERFORMANCE.md) for before/after memory, startup and search results, workloads, package sizes and limitations. Electron remains the main baseline memory and package cost; this is not a 30 MB native text editor.

## Project structure

```text
.github/workflows/  Windows build and test checks
assets/        Editable SVG logo and architecture diagram
electron/           Desktop process and isolated preload bridge
resources/          App icons and installer PDF registration
scripts/            Offline PDF packaging and repeatable benchmarking
src/                Workspace, viewers and utilities
tests/              Desktop integration tests
vendor/             Pinned spreadsheet parser archive
```

The root contains the entry HTML, build/test configuration, dependency manifest and lockfile, and desktop launcher. Git excludes installers, dependencies, generated caches, local environment files and signing credentials.

## Architecture

![OmniView architecture](assets/architecture.svg)

`electron/main.cjs` owns native file access, menus, save/print dialogs, single-instance handling and incoming Windows file arguments. `electron/preload.cjs` exposes a small IPC API with context isolation and sandboxing. A renderer-ready handshake delivers startup files after its listeners are registered.

`src/main.js` manages tab state and loads the appropriate viewer. Viewer modules parse files locally. PDF workers, fonts, character maps and decoders are bundled for offline use. Theme, panel width and font size use local storage. Native recent-file paths and metadata are saved atomically in `recent-files.json` in the app's user data folder, limited to 25 entries. The renderer reopens them through history IDs; dropped files get their real paths through the isolated preload bridge. Document contents are not persisted in history. External document resources are blocked, while explicitly clicked web links can open in the default browser.

The installer registers a per-user PDF handler without changing Windows UserChoice. Uninstall removes only OmniView's registrations. The title and File / Edit / View / Help menus share one row. Help → About shows the application version and repository. Help also opens GitHub and the welcome discussion for feedback. Native text saves check the original file hash before an atomic replacement and preserve UTF-8 BOM and line endings.

## Release signing

No signing credentials are configured. To sign future releases, enable `build.win.signExecutable` and configure a trusted certificate or signing service through electron-builder. Keep certificates, passwords and service credentials outside Git. A valid signature helps identify the publisher, but Windows reputation checks can still warn about new releases.

## Support and ideas

If OmniView is useful to you, [star the repository](https://github.com/4Raisan/OmniView) to support the project. [Share feature ideas, questions and feedback in the welcome discussion](https://github.com/4Raisan/OmniView/discussions/5). For problems, include the app version, Windows version, file type and steps to reproduce. Avoid posting private document contents.

## Upgrade identity

OmniView is the renamed Multi-Viewer. The existing application ID, installation identity and preference keys remain for compatibility with upgrades and saved settings. The repository is now https://github.com/4Raisan/OmniView. Historical 1.5/1.6 measurements in the performance report retain their original product names.

