# Privacy policy

OmniView views and edits documents locally. It does not upload document contents, filenames, recent-file paths, drafts or clipboard contents to the maintainer or a conversion service. Recent paths and application preferences are stored on the user's device. There are no analytics, advertising or crash-report uploads in OmniView.

## Update checks

From 1.9.0, the desktop app contacts GitHub's public latest-release API at startup. Help → Check for updates performs the same check manually. Requests include an OmniView User-Agent and standard network information such as the connecting IP address; no document details or installation identifier are included. Results are cached in memory for one hour. A failed or offline check does not prevent document viewing.

GitHub operates that endpoint under its [privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement). Choosing View release, Star on GitHub or another Help link opens GitHub in the user's normal browser, where GitHub's policies and the browser's settings apply.

## Local installation

The Windows installer creates per-user app files, shortcuts and optional PDF Open with registrations. It does not change the protected PDF default. Use Windows Settings → Apps → Installed apps → OmniView → Uninstall to remove the installed application. Local history and preferences may remain for reinstall compatibility. The portable EXE does not install the application, although it can retain local preferences.

## Code signing

Code signing is a release-build operation, not an application telemetry service. A future signing provider would receive release binaries and source/build provenance, not users' documents. **Current published Windows builds are unsigned; no SignPath approval or certificate is claimed.**

Questions can be raised through [OmniView issues](https://github.com/4Raisan/OmniView/issues). Do not attach private documents to public issues.
