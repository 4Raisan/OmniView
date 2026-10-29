# Installs the NSIS setup for the current Windows user, runs the desktop checks against
# the installed executable, then uninstalls and verifies the registrations are gone.
# This writes HKCU keys, shortcuts and an uninstall entry: run it only on a disposable
# CI runner, never on a maintainer or user machine.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$SetupPath,
    [Parameter(Mandatory = $true)][string]$InstallDir,
    [string]$ExecutableName = 'OmniView.exe',
    [switch]$SkipDesktopChecks
)
$ErrorActionPreference = 'Stop'

if ($env:OS -ne 'Windows_NT') { throw 'The installer check requires Windows.' }
# NSIS reads /D= as the raw remainder of the command line, so it must be last and
# unquoted. A path with a space would silently install somewhere else.
if ($InstallDir -match '\s') { throw "InstallDir must not contain whitespace: $InstallDir" }
if ($InstallDir -notmatch '^[A-Za-z]:\\') { throw "InstallDir must be an absolute drive path: $InstallDir" }

$setup = Get-Item -LiteralPath $SetupPath
if ($setup.PSIsContainer) { throw "Expected a setup executable: $SetupPath" }
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$installedExe = Join-Path $InstallDir $ExecutableName
$uninstaller = Join-Path $InstallDir "Uninstall OmniView.exe"

function Assert-That([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

function Get-DefaultValue([string]$Key) {
    if (-not (Test-Path -LiteralPath $Key)) { return $null }
    return (Get-Item -LiteralPath $Key).GetValue('')
}

function Get-UserChoiceProgId {
    $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.pdf\UserChoice'
    if (-not (Test-Path -LiteralPath $key)) { return $null }
    return (Get-ItemProperty -LiteralPath $key -Name ProgId -ErrorAction SilentlyContinue).ProgId
}

function Get-OmniViewShortcuts {
    $roots = @(
        [Environment]::GetFolderPath('Desktop'),
        [Environment]::GetFolderPath('Programs')
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
    return @(Get-ChildItem -LiteralPath $roots -Filter 'OmniView*.lnk' -Recurse -ErrorAction SilentlyContinue)
}

function Get-UninstallEntry {
    return @(Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName -match '^OmniView( |$)' })
}

function Stop-InstalledApp {
    # A one-click installer can leave the app running. The app holds a single-instance
    # lock, so a leftover process would make the test launch quit instead of opening.
    Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($ExecutableName)) -ErrorAction SilentlyContinue |
        Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
}

# The installer registers an optional PDF handler. It must never touch the protected
# UserChoice key, which is what actually decides the user's default PDF app.
$userChoiceBefore = Get-UserChoiceProgId
$shortcutsBefore = @(Get-OmniViewShortcuts).Count
$uninstallBefore = @(Get-UninstallEntry).Count
Write-Host "Installing $($setup.Name) into $InstallDir"

$install = Start-Process -FilePath $setup.FullName -ArgumentList "/S /D=$InstallDir" -Wait -PassThru
Assert-That ($install.ExitCode -eq 0) "Silent install failed with exit code $($install.ExitCode)."
Stop-InstalledApp

try {
    Assert-That (Test-Path -LiteralPath $installedExe) "The installed executable is missing: $installedExe"
    Assert-That (Test-Path -LiteralPath $uninstaller) "The uninstaller is missing: $uninstaller"

    $command = Get-DefaultValue 'HKCU:\Software\Classes\MultiViewer.PDF\shell\open\command'
    Assert-That ($command -and $command.Contains($InstallDir)) "The PDF open command does not point at the install directory: $command"
    Assert-That ((Get-ItemProperty -LiteralPath 'HKCU:\Software\RegisteredApplications' -Name OmniView -ErrorAction SilentlyContinue).OmniView -eq 'Software\MultiViewer\Capabilities') 'RegisteredApplications is missing the OmniView capabilities entry.'
    Assert-That ((Get-ItemProperty -LiteralPath 'HKCU:\Software\MultiViewer\Capabilities\FileAssociations' -Name '.pdf' -ErrorAction SilentlyContinue).'.pdf' -eq 'MultiViewer.PDF') 'The capabilities key does not advertise .pdf.'
    Assert-That ((Get-ItemProperty -LiteralPath "HKCU:\Software\Classes\Applications\$ExecutableName\SupportedTypes" -Name '.pdf' -ErrorAction SilentlyContinue).'.pdf' -eq '') 'SupportedTypes does not list .pdf.'
    Assert-That ($null -ne (Get-ItemProperty -LiteralPath 'HKCU:\Software\Classes\.pdf\OpenWithProgids' -Name 'MultiViewer.PDF' -ErrorAction SilentlyContinue)) 'The .pdf OpenWithProgids entry is missing.'
    $legacyCommand = Get-DefaultValue 'HKCU:\Software\Classes\Applications\Multi-Viewer.exe\shell\open\command'
    Assert-That ($legacyCommand -and $legacyCommand.Contains($InstallDir)) 'The legacy PDF handler does not point to the current installation.'
    Assert-That (-not (Test-Path -LiteralPath 'HKCU:\Software\Classes\Applications\Multi-Viewer.exe\SupportedTypes')) 'The legacy handler still advertises supported types.'
    Assert-That (@(Get-UninstallEntry).Count -eq $uninstallBefore + 1) 'Add/Remove Programs did not gain exactly one OmniView entry.'
    Assert-That ((Get-UserChoiceProgId) -eq $userChoiceBefore) 'The installer changed the user''s default PDF application.'

    if (-not $SkipDesktopChecks) {
        Write-Host "Running desktop checks against $installedExe"
        $previous = $env:MULTIVIEWER_EXECUTABLE
        $env:MULTIVIEWER_EXECUTABLE = $installedExe
        try {
            Push-Location $repoRoot
            try {
                & npx playwright test --config tooling/playwright.config.cjs
                Assert-That ($LASTEXITCODE -eq 0) "Desktop checks failed against the installed app (exit $LASTEXITCODE)."
            } finally { Pop-Location }
        } finally { $env:MULTIVIEWER_EXECUTABLE = $previous }
    }
}
finally {
    Write-Host 'Uninstalling'
    Stop-InstalledApp
    if (Test-Path -LiteralPath $uninstaller) {
        # _?= keeps the uninstaller in place and synchronous, so the assertions below run
        # after it has finished rather than against a copy still working in %TEMP%.
        $uninstall = Start-Process -FilePath $uninstaller -ArgumentList "/S _?=$InstallDir" -Wait -PassThru
        Stop-InstalledApp
        Assert-That ($uninstall.ExitCode -eq 0) "Silent uninstall failed with exit code $($uninstall.ExitCode)."
    }
}

Assert-That (-not (Test-Path -LiteralPath $installedExe)) "Uninstall left the executable behind: $installedExe"
Assert-That (-not (Test-Path -LiteralPath 'HKCU:\Software\Classes\MultiViewer.PDF')) 'Uninstall left the MultiViewer.PDF class behind.'
Assert-That (-not (Test-Path -LiteralPath "HKCU:\Software\Classes\Applications\$ExecutableName")) 'Uninstall left the Applications registration behind.'
Assert-That ($null -eq (Get-ItemProperty -LiteralPath 'HKCU:\Software\RegisteredApplications' -Name OmniView -ErrorAction SilentlyContinue)) 'Uninstall left the RegisteredApplications value behind.'
Assert-That ($null -eq (Get-ItemProperty -LiteralPath 'HKCU:\Software\Classes\.pdf\OpenWithProgids' -Name 'MultiViewer.PDF' -ErrorAction SilentlyContinue)) 'Uninstall left the .pdf OpenWithProgids value behind.'
Assert-That (-not (Test-Path -LiteralPath 'HKCU:\Software\MultiViewer\Capabilities')) 'Uninstall left the capabilities key behind.'
Assert-That (@(Get-UninstallEntry).Count -eq $uninstallBefore) 'Uninstall left an Add/Remove Programs entry behind.'
Assert-That (@(Get-OmniViewShortcuts).Count -le $shortcutsBefore) 'Uninstall left shortcuts behind.'
Assert-That ((Get-UserChoiceProgId) -eq $userChoiceBefore) 'Uninstall changed the user''s default PDF application.'

[pscustomobject]@{
    Setup        = $setup.Name
    InstallDir   = $InstallDir
    DesktopChecks = -not $SkipDesktopChecks
    Uninstalled  = $true
}
