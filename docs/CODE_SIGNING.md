# Code signing policy

## Current status

Published Windows downloads through 1.10.0 are unsigned. Microsoft Defender SmartScreen may identify them as unrecognized. A successful build, antivirus scan or SHA256 checksum is not a trusted Authenticode signature and does not remove that warning.

The maintainer is preparing an application for the [SignPath Foundation open-source program](https://signpath.org/apply). Approval, account access and a production signing policy are not configured yet. SignPath sponsorship must not be claimed until approved. If accepted, the provider attribution will be: Free code signing provided by [SignPath.io](https://signpath.io/), certificate by [SignPath Foundation](https://signpath.org/).

## Responsibilities

- Source maintainer, committer and reviewer: [4Raisan](https://github.com/4Raisan).
- Intended release-signing approver: 4Raisan, subject to provider enrollment and MFA verification.
- External contributions require maintainer review before inclusion in a signed release.
- Production signing requires explicit maintainer approval for each release. Automation must not approve signing requests on the maintainer's behalf.

## What must be signed and checked

1. Build on GitHub-hosted runners from an identified source commit. Preserve the link between that commit, workflow run and submitted artifact.
2. Sign the app's own Windows executable before packaging. Sign the uninstaller and the final installer/portable EXEs as part of packaging. Do not re-sign upstream Electron/DLL binaries using the project's identity.
3. Use a provider-approved artifact configuration that restricts filenames, OmniView product identity and version. Do not enable a broad arbitrary-file signing service.
4. Verify a trusted, valid, timestamped signature from the enrolled signing certificate on the application and final downloads. Verify the uninstaller during packaging before its temporary file is removed.
5. Run the packaged desktop checks on the signed app. Calculate release checksums after all signing is complete. Do not modify signed files afterward.
6. Keep unsigned builds explicitly labelled. Do not silently fall back to unsigned files after a production signing failure, and do not replace already-published release bytes without a new version.

`tooling/scripts/verify-windows-signatures.ps1` validates named files against the expected certificate thumbprint. It is a verification gate, not a signing service. It cannot establish publisher reputation or guarantee that every Windows configuration will suppress SmartScreen.

See the [privacy policy](PRIVACY.md). View SignPath's [program terms](https://signpath.org/terms) and [GitHub integration requirements](https://docs.signpath.io/trusted-build-systems/github) before enrollment. Installation of their GitHub App, new token access and acceptance of their terms require the maintainer's explicit review.
