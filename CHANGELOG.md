# Changelog

User-visible changes. Per-release notes live in `docs/releases/` and on the
[GitHub releases page](https://github.com/4Raisan/OmniView/releases), which is
also where downloads and SHA256 checksums are published.

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Added

- PDF text layer: text can be selected and copied, and a **Find in PDF** box
  searches the whole document with match counts and Enter/Shift+Enter stepping.
- Password-protected PDFs prompt for a password, report a wrong one, and can be
  cancelled.
- Tab strip is keyboard and screen-reader accessible: `tablist`/`tab` roles,
  `aria-selected`, roving focus, Arrow/Home/End navigation and Delete to close.
- Media playback failures report whether the codec is unsupported or the file is
  damaged, instead of showing a dead player.
- UTF-16 text files are decoded correctly and opened read-only.
- Unknown extensions are identified from their header bytes, so an extensionless
  text file still opens and a mislabelled image still renders.
- Unsupported binary formats (MKV, AVI, RAR, 7-Zip, executables) are named in the
  error instead of being rendered as replacement characters.
- Installation, troubleshooting and shortcut documentation; `SECURITY.md`,
  `CONTRIBUTING.md` and issue templates.

### Fixed

- **macOS:** menu commands no longer crash the main process after the last window
  is closed, and a second launch recreates the window instead of queueing files
  nobody reads.
- Saves are flushed to disk before the temporary file is renamed, so a power
  failure cannot leave a zero-length file.
- DOCX output is sanitized before it stays in the DOM, while keeping the styles
  that carry page layout.
- ZIP entries declaring more than 256 MB uncompressed are refused before
  decompression; archive listings are capped at 2,000 rows.
- Spreadsheet cells use the workbook's own number formats and date styles.
  Dates no longer render as `Mon Oct 13 2026 00:00:00 GMT+…`.
- PDF page indicators follow the page at the centre of the view, so jumping to a
  search match no longer reports the previous page.
- PDF printing bounds the total rasterized pixels across the whole document
  rather than per page.
- Code and spreadsheet search are debounced; computing the editor's dirty state
  no longer copies the whole document on every keystroke.
- Removed a dead `highlight` option that marked 18 no longer supports.

### Changed

- Opening a document from disk no longer copies its bytes through a `File` and a
  `FileReader`; PDF export asks the worker for the original bytes instead of
  retaining a second full copy.
- PDF page objects are fetched on demand rather than all at open time.
- Sheets are read up to 200,000 rows × 512 columns, with a badge when limited.
- CI and release runners moved from the retired `macos-14` image to `macos-15`.

### Security

- Upgraded DOMPurify to 3.4.17, addressing a critical advisory in 3.4.16.
  `npm audit --omit=dev` is clean and now runs in CI.
- Every IPC handler validates that the sender is the main window.
- Release workflow permissions are scoped: build jobs are read-only and only the
  publishing job can write. Third-party actions are pinned to commit SHAs.
- Release artifacts carry a GitHub build-provenance attestation.
- Corrected the privacy and development docs: clicking a hyperlink inside a
  document does open it in the browser, and recent history is stored in
  `recent-files.json` and erasable with **Clear History**.

## 1.10.0 and earlier

See [docs/releases/1.10.0.md](docs/releases/1.10.0.md) and the
[GitHub releases page](https://github.com/4Raisan/OmniView/releases) for
1.10.0, 1.9.0, 1.8.0, 1.7.0 and earlier.