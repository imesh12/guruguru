# Launcher EXE Guide

## Goal

Create a double-clickable `Kurukuru Monitor.exe` launcher for the client without changing application logic.

The launcher script is:

- [scripts/launcher/KurukuruLauncher.ps1](/C:/Users/cs_in/projects/kurukuru-monitor/scripts/launcher/KurukuruLauncher.ps1)

It does this:

- sets the working directory to the app root
- runs [scripts/start-kurukuru.ps1](/C:/Users/cs_in/projects/kurukuru-monitor/scripts/start-kurukuru.ps1)
- writes launcher activity to `data\logs\launcher.log`
- shows a Windows error dialog if startup fails

## Recommended Conversion Tool

Use PS2EXE:

- PowerShell module: `ps2exe`

Install it on the packaging machine:

```powershell
Install-Module -Name ps2exe -Scope CurrentUser
```

If PowerShell asks for trust confirmation, accept it on the packaging machine.

## Convert PS1 To EXE

From the repo root:

```powershell
Invoke-ps2exe `
  -InputFile .\scripts\launcher\KurukuruLauncher.ps1 `
  -OutputFile .\dist-portable\kurukuru-monitor-windows-portable\Kurukuru Monitor.exe `
  -Title 'Kurukuru Monitor Launcher' `
  -Product 'Kurukuru Monitor' `
  -Company 'Kurukuru Monitor' `
  -NoConsole
```

## Recommended Output Location

Place the EXE in the portable package root:

```text
dist-portable\
  kurukuru-monitor-windows-portable\
    Kurukuru Monitor.exe
    .env.template
    scripts\
    apps\
    prisma\
    data\
```

That lets the client:

1. copy `.env.template` to `.env`
2. configure site values
3. double-click `Kurukuru Monitor.exe`

## Runtime Behavior

When the EXE is launched:

1. it runs the launcher logic from `KurukuruLauncher.ps1`
2. the launcher moves to the app root
3. it starts `scripts/start-kurukuru.ps1`
4. that script starts the API and desktop

No application logic is changed by the EXE conversion. It is only a packaging convenience wrapper.

## Logs

Launcher log:

- `data\logs\launcher.log`

Startup logs used by the existing scripts:

- `data\logs\portable-bootstrap.log`
- `data\logs\api-startup.log`
- `data\logs\desktop-startup.log`

## Failure Behavior

If startup fails:

- the launcher writes the failure to `data\logs\launcher.log`
- a Windows message box appears with a readable error message

## Notes

- Build the EXE on Windows.
- Keep the EXE next to the portable package root, not inside `scripts\launcher`.
- Rebuild the EXE whenever the launcher script changes.
- Do not embed real client secrets in the launcher or in `.env.template`.
