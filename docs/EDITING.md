# Text editing in OmniView

TXT, README/Markdown, Python and other valid UTF-8 text/code files up to **2 MB** support Edit, Preview, Save and Save As. Other formats remain view-only. Ctrl+S saves; Ctrl+Shift+S opens Save As. The app uses a native text area, without a heavyweight editor dependency or syntax parsing on each keystroke.

UTF-16 files (with a BOM) are decoded and shown read-only: saving them would silently re-encode the file as UTF-8, so Edit stays disabled. Files that are not valid UTF-8 are shown with replacement characters and are also read-only.

Drafts stay in their tabs. Closing, refreshing or quitting offers save, discard or cancel. Saving preserves UTF-8 BOM and CRLF/LF line endings, checks whether the original changed externally, and writes via a temporary file that is flushed to disk before it is renamed over the original. A conflict or cancelled save retains the draft. Undo/redo belongs to the current text-area editing session; switching back to Preview ends that session.

Because the save replaces the file by rename, Windows ACLs, alternate data streams and the original creation timestamp are not carried over, and cloud-sync placeholder files may be rehydrated. Keep authoritative copies under version control or a backup if those attributes matter.

A file opened from inside a ZIP has no path on disk, so Save always becomes Save As and writes a new file; the archive itself is never modified. Its BOM and line endings are preserved in that new file.

## Markdown

Choose Split then Edit, or Edit then Live split. Small documents update the sanitized preview **250 ms after the last input**. Documents above **131,072 characters** use Refresh preview to keep editing independent of formatting. Preview rendering is bounded to the first **65,536 characters or 2,000 lines**, with a notice; full text remains in Raw view, Copy, the editor and saved files. Markdown Find searches visible content, with Enter/Shift+Enter scrolling through up to 2,000 highlighted matches. Raw mode searches full rendered source; formatted and split modes search the bounded preview.

Hidden preview tabs release their rendered nodes. Editing tabs retain the native text area and undo state; hidden live previews clear their formatted nodes and stop pending updates. Copy uses selected text first and the full source otherwise. A mild glow indicates Copy is available, and a stronger glow indicates a selection.

## Resource limits

There is no new runtime dependency. Editing retains the text, a comparison baseline and native undo history, so memory varies with document size and editing history. The 2 MB eligibility and save checks protect against accidental large-file editing; they do not guarantee a fixed amount of RAM or constant typing latency. Large pastes and many open drafts can still cost more than read-only previews. See [measured benchmarks](PERFORMANCE.md) for the app as a whole.

Validation covers BOM/CRLF, unsupported encodings and size limits, external-change conflicts, cancelled saves, draft tab switching, close/refresh protection, live preview sanitation, manual large-file preview and selection copying.
