# Privacy policy

OmniView views and edits documents locally. It does not upload document contents, filenames, recent-file paths, drafts or clipboard contents to the maintainer or a conversion service. Recent paths and application preferences are stored on the user's device. There are no analytics, advertising or crash-report uploads in OmniView.

## Update checks

From 1.9.0, the desktop app contacts GitHub's public latest-release API at startup. Help → Check for updates performs the same check manually. Requests include an OmniView User-Agent and standard network information such as the connecting IP address; no document details or installation identifier are included. Results are cached in memory for one hour. A failed or offline check does not prevent document viewing.

GitHub operates that endpoint under its [privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement). Choosing View release, Star on GitHub or another Help link opens GitHub in the user's normal browser, where GitHub's policies and the browser's settings apply.

## Links inside documents

OmniView blocks documents from loading external images, stylesheets, scripts and fonts, so opening a file contacts no server. **Clicking a hyperlink inside a Markdown or DOCX document is an explicit exception:** it opens that URL in the user's normal browser, which reveals the connecting IP address and the fact that the link was followed to whoever operates that site. The URL is chosen by the document's author, not by OmniView, and is not restricted to OmniView's repository. Do not click links in documents from untrusted sources.

## What is stored on the device

Recent history is up to 25 entries of full file path, filename, byte size and a random identifier, written to `recent-files.json` in Electron's per-user data directory (`%APPDATA%/multi-viewer` on Windows, `~/.config/multi-viewer` on Linux, `~/Library/Application Support/multi-viewer` on macOS). Theme, text size and sidebar width are stored in the app's local storage. Neither holds document contents.

**Clear History** (the × beside Recent Files in the sidebar) empties that list and rewrites `recent-files.json`. It does not delete the files themselves, and it does not delete recovered drafts. Uninstalling leaves local history and preferences in place unless removed manually.

## Unsaved draft recovery

While you edit, OmniView writes the unsaved text to a `drafts` folder inside the same per-user data directory, about two seconds after you stop typing. This is what allows an unexpected exit to offer your changes back. **These files contain your document text in plain, unencrypted JSON, readable by any process running as your user.** Each record also stores the file's original SHA-256 hash, a timestamp, and its BOM and line-ending settings; the filename is a hash of the path, not the path itself.

A draft is deleted when you save, when you discard the recovery offer, when you close the tab or quit without unsaved changes, and when you type the text back to its original content. At startup OmniView also removes drafts older than seven days and keeps only the 20 most recent, so abandoned drafts do not accumulate. To remove them immediately, delete the `drafts` folder while OmniView is closed.

Recovery is offered only for files opened from disk. Files opened through the browser-style picker without a path, and read-only formats, are never autosaved. If the file changed on disk after the draft was written, the offer says so and asks you to review before saving over it.

## Local installation

The Windows installer creates per-user app files, shortcuts and optional PDF Open with registrations. It does not change the protected PDF default. Use Windows Settings → Apps → Installed apps → OmniView → Uninstall to remove the installed application. Local history and preferences may remain for reinstall compatibility. The portable EXE does not install the application, although it can retain local preferences.

## Code signing

Code signing is a release-build operation, not an application telemetry service. A future signing provider would receive release binaries and source/build provenance, not users' documents. **Current published Windows builds are unsigned; no SignPath approval or certificate is claimed.**

Questions can be raised through [OmniView issues](https://github.com/4Raisan/OmniView/issues). Do not attach private documents to public issues.
