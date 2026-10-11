# Performance — OmniView

OmniView was previously named Multi-Viewer. The comparison below is the preserved historical 1.5.0/1.6.0 benchmark; it is not relabeled as a new 1.7.0 measurement.

Measured on 2026-10-11 using packaged Windows x64 builds 1.5.0 and 1.6.0. Results below are medians of **three fresh-profile runs per build** on the same Windows machine (kernel build 10.0.26300): Intel Core i7-13620H, 16 logical CPUs, 15.7 GiB usable RAM. [Raw measurements](benchmark-results.json) include every run and process sample.

## Memory

Private memory is committed process memory, not the same measure as Task Manager’s visible app row. Working set is resident memory; the sum across processes can count shared pages more than once. Both tables include the main process, renderer, GPU and utility processes, not just the main executable. MiB means 1,048,576 bytes.

| Workload | 1.5.0 private MiB | 1.6.0 private MiB | 1.5.0 working-set MiB | 1.6.0 working-set MiB |
| --- | ---: | ---: | ---: | ---: |
| Fresh idle | 265.4 | 263.4 | 394.3 | 392.3 |
| One Python tab | 342.0 | 338.4 | 476.4 | 472.9 |
| 12 Python tabs | 599.4 | 438.5 | 735.3 | 576.5 |
| 12 text tabs + Markdown | 610.0 | 453.7 | 745.3 | 591.4 |
| Those tabs + paused audio | 865.6 | 462.2 | 1003.6 | 603.7 |
| Those tabs + playing audio | 939.8 | 544.8 | 1155.3 | 761.5 |
| All tabs closed, after 0.5 s | 1096.6 | 596.6 | 1287.0 | 797.9 |

12 text tabs use **26.8% less private memory**; the mixed workload with playing audio uses **42.0% less**. Fresh idle stays around **263 MiB private / 392 MiB summed working set**. Closing tabs reduces the footprint versus the previous release, but does not immediately return the process to fresh-start memory. Chromium/V8 and media allocations can retain memory after their views are removed. No forced garbage collection or artificial memory trimming was used.

## Speed and CPU

| Measurement | 1.5.0 | 1.6.0 |
| --- | ---: | ---: |
| Startup to welcome | 809.2 ms | 707.3 ms |
| Open first 2,500-line Python file | 309.0 ms | 364.1 ms |
| Open remaining 11 Python files, including search workload | 1289.4 ms | 595.4 ms |
| Synchronous search input handling | 37.6 ms | 34.6 ms |
| Close all 14 tabs | 2297.1 ms | 128.3 ms |

Batch opening is about **54% faster**. The initial text preview waits 50 ms to coalesce rapid tab changes, so a single text open is approximately 55 ms slower in this run. Startup reflects filesystem caches and normal run variation. Search is roughly comparable; its small improvement should not be treated as a universal speedup.

| CPU sample, percent of the whole 16-thread machine | 1.5.0 | 1.6.0 |
| --- | ---: | ---: |
| Fresh idle, 2 s | 0.80% | 0.84% |
| Paused audio, 0.5 s | 1.01% | 0.91% |
| Playing audio, 0.5 s | 6.51% | 6.71% |

CPU use is essentially unchanged in these short samples. They include automation overhead and early playback activity; this is not a long-duration video, battery-life or codec benchmark.

## Editing

Three additional fresh-profile runs used a 6.6 KB Markdown file in live split mode, then a 1.87 MiB plain-text file in Edit mode. These figures are total app memory, not the incremental cost of the editor alone. The second case includes allocations retained from the first case.

| Case | Private MiB | Summed working-set MiB | Median synchronous input handler | Observed live preview |
| --- | ---: | ---: | ---: | ---: |
| Markdown live split | 308.7 | 441.5 | <0.1 ms timer resolution | 297 ms |
| 1.87 MiB plain text | 496.7 | 626.4 | 0.3 ms | Not applicable |

Input-handler timing measures ten synthetic input-event callbacks; it excludes assigning the text, physical keyboard latency and painting. Preview timing includes the intentional 250 ms debounce and automation observation. Large pastes, native undo history and different document layouts can cost considerably more. No editor dependency was added. Editing remains limited to valid UTF-8 files up to 2 MB. Live formatting is automatic up to 131,072 characters; larger files use manual refresh. Formatted Markdown previews are limited to 65,536 characters or 2,000 lines, with a notice. Full text remains available in Raw view, Copy, editing and saving.

## Historical 1.6.0 package and verification

- Installer: **88,222,223 bytes (88.2 MB / 84.1 MiB)**.
- Portable executable: **88,076,316 bytes (88.1 MB / 84.0 MiB)**.
- Unpacked application payload: **307,479,988 bytes (307.5 MB / 293.2 MiB)**, excluding user history and runtime caches.
- The Electron executable alone is about 214 MB unpacked; the bundled app archive is about 8.2 MB. Runtime size dominates the package.
- **27 desktop integration checks passed on the final packaged build.**
- Native streaming, byte ranges, seeking, hidden-source release and closed-token rejection were verified with a generated **300 MiB WAV**. This is a functional check, not a benchmark of a real 2 GB movie.
- A local Microsoft Defender scan of the release folder reported **no threats**. The executables remain unsigned; this result does not guarantee SmartScreen reputation or other scanners.

## What changed and what remains

Media uses bounded file-range streams rather than whole-file reads and byte copies through IPC. Closing a media tab or refreshing releases tokens and open streams. Inactive text and Markdown previews release rendered nodes, while drafts and small syntax caches remain. A 50 ms activation delay avoids parsing every transient tab during batch opening or rapid closing. Markdown preview work is bounded, debounced and stopped while hidden. PDF canvas limits and lazy parser loading remain in place. Samples and their source module were removed.

The main remaining costs are Electron/Chromium’s baseline, GPU and decoding allocations, large active document views and undo histories in multiple drafts. A different native shell could reduce the bundled runtime, but would require a separate compatibility and feature migration effort. The user’s Notepad/VLC observations were not measured under these workloads, so this report makes no direct comparison with them.

## Reproduce

Run on Windows after installing dependencies and building an unpacked executable. Close other heavy work for a cleaner comparison. Do not compare a main-process-only Task Manager row with these totals.

```powershell
npm ci
npm run build
npx electron-builder --win --x64 --dir
node tooling/scripts/benchmark.cjs "release/win-unpacked/OmniView.exe" "benchmark-results.json" 3
node tooling/scripts/benchmark.cjs "release/win-unpacked/OmniView.exe" "editing-results.json" 3 editing
```

Use the same commands with a preserved 1.5.0 unpacked executable for the baseline. Portable extraction and installer time are excluded from startup measurements. Workloads use 12 synthetic 2,500-line Python files, 200 Markdown paragraphs and 64 MiB PCM audio; audio cases retain the text and Markdown tabs. Snapshots follow a 500 ms settling interval. CPU derives from cumulative process CPU time and is divided by logical CPU count. Profiles and input fixtures are temporary and do not touch normal app history.

## OmniView 1.7.0 final verification

Three fresh-profile runs of the final packaged build used the same standard workload. Median total private memory was **260.9 MiB idle**, **445.2 MiB with 12 text tabs**, **530.4 MiB with the mixed workload and playing audio**, and **596.5 MiB after closing all tabs**. Median startup was **767.5 ms**. These measurements show a similar resource footprint to 1.6.0; the branding and combined title/menu row do not establish a new performance improvement. Historical editing measurements above remain from 1.6.0. Raw 1.7.0 results are included in benchmark-results.json.

All **28 desktop integration checks passed on the final packaged build**, including the single title/menu row, native menu popup, safe editing, Markdown split preview, media streaming and tab cleanup.

- Installer: **88,351,402 bytes (88.4 MB)**.
- Portable executable: **88,177,949 bytes (88.2 MB)**.
- Unpacked payload: **307,527,150 bytes (307.5 MB)**.
- SHA-256 hashes for the current executables are recorded in benchmark-results.json.

A local Microsoft Defender scan of the final 1.7.0 release folder reported no threats. The executables remain unsigned; SmartScreen may still show a publisher warning.


The GitHub release downloads were rebuilt from commit e603f4d on a Windows runner and passed all 28 packaged desktop checks. The memory measurements above remain from the local 1.7.0 benchmark build; they were not rerun on the runner. Current download checksums are stored in releaseArtifacts, and the original benchmark-build checksums remain in benchmarkBuildArtifacts. The Defender scan above covers that original local build.
