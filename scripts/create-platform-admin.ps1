$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$name = Read-Host "Platform administrator name"
$email = Read-Host "Platform administrator email"
$password = Read-Host "Platform administrator password" -AsSecureString
$passwordPointer = [IntPtr]::Zero

try {
  $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($password)
  $env:PLATFORM_ADMIN_NAME = $name
  $env:PLATFORM_ADMIN_EMAIL = $email
  $env:PLATFORM_ADMIN_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
  Push-Location $projectRoot
  try {
    & node (Join-Path $PSScriptRoot "create-platform-admin.mjs")
    if ($LASTEXITCODE -ne 0) { throw "Platform administrator setup failed." }
  }
  finally {
    Pop-Location
  }
}
finally {
  Remove-Item Env:PLATFORM_ADMIN_NAME -ErrorAction SilentlyContinue
  Remove-Item Env:PLATFORM_ADMIN_EMAIL -ErrorAction SilentlyContinue
  Remove-Item Env:PLATFORM_ADMIN_PASSWORD -ErrorAction SilentlyContinue
  if ($passwordPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
  }
}
