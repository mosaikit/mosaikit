# SPDX-FileCopyrightText: 2026 Massimo Antonini
# SPDX-License-Identifier: MPL-2.0
#
# Starts Mosaikit with PowerShell (Windows PowerShell 5.1 or PowerShell 7). The Java code of new or
# updated plugins is loaded first: the kernel is rebuilt only when the set of plugin JARs changed
# (MK-011, ADR-0004). If the kernel does not start with the new JARs, they are rolled back and the
# kernel starts again with the previous plugins. In the portable distribution (MK-016) the bundled
# PostgreSQL is started before the kernel and stopped after it.
#
#   mosaikit.cmd [start]   prepare and start the kernel (default), or bin\mosaikit.ps1
#   mosaikit.cmd build     prepare only
#
# Settings go in config\application.properties or in environment variables (QUARKUS_*, MOSAIKIT_*).
# JAVA_OPTS adds JVM options. The Java runtime in bin\java\ is used when present, then JAVA_HOME.
param(
    [ValidateSet('start', 'build')]
    [string] $Command = 'start'
)
$ErrorActionPreference = 'Stop'

$MosaikitHome = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
# Written for Windows PowerShell 5.1 and PowerShell 7, on any operating system.
$JavaExe = if ([IO.Path]::DirectorySeparatorChar -eq '\') { 'java.exe' } else { 'java' }
$Bundled = Join-Path (Join-Path (Join-Path $PSScriptRoot 'java') 'bin') $JavaExe
if (Test-Path $Bundled) {
    $Java = $Bundled
} elseif ($env:JAVA_HOME) {
    $Java = Join-Path (Join-Path $env:JAVA_HOME 'bin') $JavaExe
} else {
    $Java = 'java'
}
$Kernel = Join-Path $PSScriptRoot 'kernel'
$Providers = Join-Path $Kernel 'providers'
$Pending = Join-Path $Providers 'mosaikit-pending.txt'
$DatabaseConfig = Join-Path (Join-Path $MosaikitHome 'config') 'database.properties'
# The launcher is part of the kernel: it runs with the class path of the kernel.
$ClassPath = (Join-Path (Join-Path $Kernel 'app') '*') + [IO.Path]::PathSeparator + (Join-Path (Join-Path (Join-Path $Kernel 'lib') 'main') '*')
Set-Location $MosaikitHome

function Invoke-Launcher {
    & $Java -cp $ClassPath dev.mosaikit.launcher.Launcher @args $MosaikitHome
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

function Invoke-Kernel {
    $JavaOpts = @()
    if ($env:JAVA_OPTS) { $JavaOpts = $env:JAVA_OPTS -split '\s+' | Where-Object { $_ } }
    # A location is a URI: a Windows path such as C:\... would be read as the scheme "C".
    if (Test-Path $DatabaseConfig) { $JavaOpts += "-Dquarkus.config.locations=$([Uri]::new((Resolve-Path -LiteralPath $DatabaseConfig).Path).AbsoluteUri)" }
    & $Java @JavaOpts `
        "-Dmosaikit.plugins.directory=$(Join-Path $MosaikitHome 'plugins')" `
        "-Dmosaikit.plugins.providers-directory=$Providers" `
        "-Dmosaikit.plugins.packages-directory=$(Join-Path $Kernel 'plugin-packages')" `
        -jar (Join-Path $Kernel 'quarkus-run.jar')
    # Called as a statement, so that the output of the kernel goes to the console.
    $script:Status = $LASTEXITCODE
}

if ($Command -eq 'build') {
    Invoke-Launcher 'build'
    exit 0
}

$Status = 0
Invoke-Launcher 'prepare'
Invoke-Launcher 'database' 'start'
try {
    Invoke-Kernel
    if ($Status -ne 0 -and (Test-Path $Pending)) {
        Write-Warning "The kernel stopped (exit code $Status) before starting with the new plugin JARs."
        Invoke-Launcher 'prepare'
        Invoke-Kernel
    }
} finally {
    & $Java -cp $ClassPath dev.mosaikit.launcher.Launcher 'database' 'stop' $MosaikitHome
}
exit $Status
