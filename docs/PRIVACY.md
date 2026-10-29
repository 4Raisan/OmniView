# Privacy policy

OmniView views and edits documents locally. It does not upload document contents, filenames, recent-file paths, drafts or clipboard contents to the maintainer or a conversion service. Recent paths and application preferences are stored on the user's device. There are no analytics, advertising or crash-report uploads in OmniView.

## Update checks

From 1.9.0, the desktop app contacts GitHub's public latest-release API at startup. Help → Check for updates performs the same check manually. Requests include an OmniView User-Agent and standard network information such as the connecting IP address; no document details or installation identifier are included. Results are cached in memory for one hour. A failed or offline check does not prevent document viewing.

GitHub operates that endpoint under its [privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement). Choosing View release, Star on GitHub or another Help link opens GitHub in the user's normal browser, where GitHub's policies and the browser's settings apply.

## Links inside documents

OmniView blocks documents from loading external images, stylesheets, scripts and fonts, so opening a file contacts no server. **Clicking a hyperlink inside a Markdown or DOCX document is an explicit exception:** it opens that URL in the user's normal browser, which reveals the connecting IP address and the fact that the link was followed to whoever operates that site. The URL is chosen by the document's author, not by OmniView, and is not restricted to OmniView's repository. Do not click links in documents from untrusted sources.

## What is stored on the device

Recent history is up to 25 entries of full file path, filename, byte size and a random identifier, written to `recent-files.json` in Electron's per-user data directory (`%APPDATA%/OmniView` on Windows, `~/.config/OmniView` on Linux, `~/Library/Application Support/OmniView` on macOS). Theme, text size and sidebar width are stored in the app's local storage. No document contents are copied there.

**Clear History** (the × beside Recent Files in the sidebar) empties that list and rewrites `recent-files.json`. It does not delete the files themselves. Uninstalling leaves local history and preferences in place unless removed manually.

## Local installation

The Windows installer creates per-user app files, shortcuts and optional PDF Open with registrations. It does not change the protected PDF default. Use Windows Settings → Apps → Installed apps → OmniView → Uninstall to remove the installed application. Local history and preferences may remain for reinstall compatibility. The portable EXE does not install the application, although it can retain local preferences.

## Code signing

Code signing is a release-build operation, not an application telemetry service. A future signing provider would receive release binaries and source/build provenance, not users' documents. **Current published Windows builds are unsigned; no SignPath approval or certificate is claimed.**

Questions can be raised through [OmniView issues](https://github.com/4Raisan/OmniView/issues). Do not attach private documents to public issues.
