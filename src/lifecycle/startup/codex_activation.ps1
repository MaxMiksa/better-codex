function Get-CodexAvailableDisplayPort {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    $listener.ExclusiveAddressUse = $true
    try {
        $listener.Start()
        return $listener.LocalEndpoint.Port
    } finally { $listener.Stop() }
}

function Initialize-CodexActivation {
    if (!('HudApplicationActivator' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
[ComImport, Guid("2e941141-7f97-4756-ba1d-9decde894a3d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IHudApplicationActivationManager {
    [PreserveSig] int ActivateApplication([MarshalAs(UnmanagedType.LPWStr)] string appId,
        [MarshalAs(UnmanagedType.LPWStr)] string arguments, uint options, out uint processId);
}
public static class HudApplicationActivator {
    private const string CodexFamily = "OpenAI.Codex_2p2nqsd0c76g0";
    [DllImport("kernel32.dll")]
    private static extern IntPtr OpenProcess(uint access, bool inheritHandle, int processId);
    [DllImport("kernel32.dll")]
    private static extern bool GetProcessTimes(IntPtr process, out long creationTime,
        out long exitTime, out long kernelTime, out long userTime);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern int GetPackageFamilyName(IntPtr process, ref uint length, StringBuilder name);
    [DllImport("kernel32.dll")]
    private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);

    public static bool IsRunningCodex(int processId, long expectedCreationTime) {
        const uint QueryAndSynchronize = 0x00101000;
        const uint WaitTimeout = 258;
        IntPtr process = OpenProcess(QueryAndSynchronize, false, processId);
        if (process == IntPtr.Zero) return false;
        try {
            long creationTime, exitTime, kernelTime, userTime;
            if (!GetProcessTimes(process, out creationTime, out exitTime, out kernelTime, out userTime)
                || creationTime != expectedCreationTime) return false;
            var name = new StringBuilder(256);
            uint length = (uint)name.Capacity;
            return GetPackageFamilyName(process, ref length, name) == 0
                && String.Equals(name.ToString(), CodexFamily, StringComparison.OrdinalIgnoreCase)
                && WaitForSingleObject(process, 0) == WaitTimeout;
        } finally { CloseHandle(process); }
    }

    public static uint Start(string arguments) {
        object instance = Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C")));
        try {
            uint processId;
            int result = ((IHudApplicationActivationManager)instance).ActivateApplication(CodexFamily + "!App", arguments, 0, out processId);
            Marshal.ThrowExceptionForHR(result);
            return processId;
        } finally { Marshal.ReleaseComObject(instance); }
    }
}
'@
    }
}

function Test-CodexRunning {
    $session = [Diagnostics.Process]::GetCurrentProcess().SessionId
    foreach ($process in (Get-Process -Name ChatGPT -ErrorAction SilentlyContinue)) {
        try {
            if ($process.SessionId -ne $session) { continue }
            Initialize-CodexActivation
            if ([HudApplicationActivator]::IsRunningCodex($process.Id, $process.StartTime.ToFileTimeUtc())) { return $true }
        } catch { } # A vanished or unreadable process does not establish a running instance.
    }
    return $false
}

function Invoke-CodexActivation([string]$Arguments) {
    Initialize-CodexActivation
    [HudApplicationActivator]::Start($Arguments)
}
