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
