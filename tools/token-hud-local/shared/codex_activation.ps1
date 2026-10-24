function Get-CodexDesktopPackage {
    $packages = @(Get-AppxPackage -Name OpenAI.Codex | Where-Object { $_.PackageFamilyName -eq 'OpenAI.Codex_2p2nqsd0c76g0' })
    if ($packages.Count -ne 1 -or $packages[0].Status -ne 'Ok' -or $packages[0].SignatureKind -ne 'Store') {
        throw (Get-BetterCodexText 'launch.packageFailed')
    }
    $executable = Join-Path $packages[0].InstallLocation 'app/ChatGPT.exe'
    if (-not (Test-Path -LiteralPath $executable)) { throw (Get-BetterCodexText 'launch.packageFailed') }
    return @{executable=$executable;packageVersion=[string]$packages[0].Version}
}

function Invoke-CodexAdministratorActivation([string]$Arguments) {
    if (-not (Test-BetterCodexAdministrator)) { throw (Get-BetterCodexText 'administrator.notElevated') }
    # Resolve again at launch so Store updates never leave a versioned target behind.
    $package = Get-CodexDesktopPackage
    $parameters = @{FilePath=$package.executable;PassThru=$true}
    if ($Arguments) { $parameters.ArgumentList = $Arguments }
    $process = Start-Process @parameters
    return $process.Id
}

function Invoke-CodexActivation([string]$Arguments) {
    if (!('HudApplicationActivator' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[ComImport, Guid("2e941141-7f97-4756-ba1d-9decde894a3d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IHudApplicationActivationManager {
    [PreserveSig] int ActivateApplication([MarshalAs(UnmanagedType.LPWStr)] string appId,
        [MarshalAs(UnmanagedType.LPWStr)] string arguments, uint options, out uint processId);
}
public static class HudApplicationActivator {
    public static uint Start(string appId, string arguments) {
        object instance = Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C")));
        try {
            uint processId;
            int result = ((IHudApplicationActivationManager)instance).ActivateApplication(appId, arguments, 0, out processId);
            Marshal.ThrowExceptionForHR(result);
            return processId;
        } finally { Marshal.ReleaseComObject(instance); }
    }
}
'@
    }
    [HudApplicationActivator]::Start('OpenAI.Codex_2p2nqsd0c76g0!App', $Arguments)
}
