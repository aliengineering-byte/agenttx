[CmdletBinding()]
param(
  [string]$Node = "node",
  [string]$Python = "python",
  [string]$Font = ""
)

$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$cli = Join-Path $repo "dist\src\cli.js"
$renderer = Join-Path $PSScriptRoot "render_demo.py"
$gif = Join-Path $repo "docs\assets\agenttx-demo.gif"
$png = Join-Path $repo "docs\assets\agenttx-demo.png"
$transcript = Join-Path $repo "docs\assets\terminal-demo.txt"
$capture = [IO.Path]::GetTempFileName()

try {
  if (-not (Test-Path -LiteralPath $cli)) {
    throw "Built CLI not found. Run the repository build before recording."
  }

  $process = New-Object System.Diagnostics.Process
  $process.StartInfo.FileName = $Node
  $process.StartInfo.Arguments = '"' + $cli.Replace('"', '\"') + '" demo'
  $process.StartInfo.WorkingDirectory = $repo
  $process.StartInfo.UseShellExecute = $false
  $process.StartInfo.CreateNoWindow = $true
  $process.StartInfo.RedirectStandardOutput = $true
  $process.StartInfo.RedirectStandardError = $true
  $null = $process.Start()
  $stdout = $process.StandardOutput.ReadToEnd()
  $stderr = $process.StandardError.ReadToEnd()
  $process.WaitForExit()
  $output = $stdout + [Environment]::NewLine + $stderr

  if ($process.ExitCode -ne 0) {
    throw "The real AgentTX demo failed with exit code $($process.ExitCode).`n$output"
  }
  if ($output -notmatch "Original workspace unchanged") {
    throw "The demo did not verify that the original workspace stayed unchanged."
  }
  if ($output -match "[A-Za-z]:\\Users\\|/Users/|/home/|files-mentioned-by-the-user|Codex[\\/]20\d\d") {
    throw "The demo output exposed a private machine path; refusing to render."
  }

  [IO.File]::WriteAllText($capture, $output, (New-Object Text.UTF8Encoding($false)))
  $arguments = @(
    $renderer,
    "--source", $capture,
    "--gif", $gif,
    "--png", $png,
    "--transcript", $transcript
  )
  if ($Font) { $arguments += @("--font", $Font) }
  & $Python @arguments
  if ($LASTEXITCODE -ne 0) { throw "Demo asset rendering failed." }

  $gifInfo = Get-Item -LiteralPath $gif
  $pngInfo = Get-Item -LiteralPath $png
  Write-Host "Verified real transaction demo and rollback."
  Write-Host "GIF: $($gifInfo.Name) ($($gifInfo.Length) bytes, 13.8 seconds)"
  Write-Host "PNG: $($pngInfo.Name) ($($pngInfo.Length) bytes)"
  Write-Host "Privacy check: passed"
} finally {
  if (Test-Path -LiteralPath $capture) {
    Remove-Item -LiteralPath $capture -Force
  }
}
