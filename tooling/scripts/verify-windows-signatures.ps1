[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string[]]$Files,
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-fA-F0-9]{40}$')][string]$ExpectedThumbprint
)
$ErrorActionPreference = 'Stop'
if (-not (Get-Command Get-AuthenticodeSignature -ErrorAction SilentlyContinue)) {
    throw 'Signature verification requires Windows Authenticode support.'
}
foreach ($file in $Files) {
    $resolvedFile = Get-Item -LiteralPath $file
    if ($resolvedFile.PSIsContainer) { throw "Expected a file: $file" }
    $signature = Get-AuthenticodeSignature -LiteralPath $resolvedFile.FullName
    if ($signature.Status -ne 'Valid') { throw "Invalid or missing Authenticode signature: $file ($($signature.Status))" }
    if ($signature.SignerCertificate.Thumbprint -ne $ExpectedThumbprint) { throw "Unexpected signing certificate: $file" }
    if ($null -eq $signature.TimeStamperCertificate) { throw "Missing trusted timestamp: $file" }
    [pscustomobject]@{ File = $resolvedFile.Name; Status = $signature.Status; Publisher = $signature.SignerCertificate.Subject; Thumbprint = $signature.SignerCertificate.Thumbprint }
}
