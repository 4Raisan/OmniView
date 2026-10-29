# Security policy

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Use GitHub's private vulnerability reporting: go to the
[Security tab](https://github.com/4Raisan/OmniView/security) and choose
**Report a vulnerability**. That creates a private advisory visible only to the
maintainer. If the Security tab does not offer that option, it has not been
enabled yet — open a minimal public issue asking for a private contact channel
without describing the flaw, and the maintainer will enable it.

Include:

- the OmniView version and operating system,
- the file type involved, and a **minimal synthetic sample** that reproduces it,
- what you expected to happen and what actually happened.

Do not attach real personal or confidential documents. Build a small synthetic
file that triggers the same code path.

You can expect an acknowledgement within 7 days. This is a personal project
maintained in spare time, not a funded product; there is no bug bounty.

## Scope

OmniView's job is to parse files that may come from untrusted sources, so parser
and renderer issues are the most valuable reports.

In scope:

- script execution, DOM injection or sanitization bypass from a document,
- reading or writing files outside the one the user opened,
- any network request triggered by opening a document without a user click,
- denial of service that a realistically sized file can trigger (decompression
  bombs, unbounded allocation, unbounded DOM growth),
- privilege escalation or unsafe installer behaviour.

Out of scope:

- a document's own hyperlinks opening in the browser when the user clicks them
  (documented in [PRIVACY.md](docs/PRIVACY.md)),
- crashes on files above the documented limits (256 MB documents, 32 MB legacy
  DOC, 2 MB editing, 256 MB per ZIP entry),
- unsupported codecs or formats reported as unsupported,
- issues requiring the user to disable the renderer sandbox or CSP,
- the absence of a code-signing certificate. Windows builds are unsigned and
  macOS builds are ad-hoc signed and not notarized; this is disclosed in
  [CODE_SIGNING.md](docs/CODE_SIGNING.md) and is a known limitation, not a
  vulnerability.

## Existing mitigations

These are the boundaries a report should try to cross:

- renderer runs with `sandbox: true`, `contextIsolation: true`,
  `nodeIntegration: false`; the preload exposes a fixed, narrow API,
- a Content-Security-Policy restricts scripts to `'self'` and blocks
  `object-src`,
- every IPC handler validates that the sender is the main window,
- all http(s) subresource requests from the renderer are cancelled, so documents
  cannot contact a server on their own,
- Markdown HTML is passed through DOMPurify; DOCX output is sanitized with a
  layout-preserving configuration that still strips active content,
- legacy DOC parsing runs in a worker thread with a 32 MB input cap, a
  15-second timeout, a 128 MB heap limit and at most two concurrent readers,
- ZIP entries are refused before decompression when they declare more than
  256 MB,
- saves are hash-checked against external changes, written to a temporary file,
  flushed, then renamed.

## Supported versions

Only the latest published release receives fixes. Older versions should be
upgraded; from 1.9.0 the app shows a notice when a newer stable release exists.