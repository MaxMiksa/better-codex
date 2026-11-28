using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

internal static class ProcessInspector
{
    [StructLayout(LayoutKind.Sequential)]
    internal struct FileTime
    {
        public uint Low, High;
        internal long Value { get { return ((long)High << 32) | Low; } }
    }
    internal sealed class ProcessHandle : SafeHandleZeroOrMinusOneIsInvalid
    {
        public ProcessHandle() : base(true) { }
        protected override bool ReleaseHandle() { return CloseHandle(handle); }
        internal uint Pid;
        internal FileTime Time;
        internal long Created { get { return Time.Value; } }
        internal string CreatedText { get { return Created.ToString(CultureInfo.InvariantCulture); } }
        internal double Started { get { return (Created - 116444736000000000L) / 10000000d; } }
        internal bool Alive { get { return WaitForSingleObject(this, 0) == 258; } }
        internal bool Wait(uint ms) { return WaitForSingleObject(this, ms) == 0; }
        internal string Image
        {
            get
            {
                var text = new StringBuilder(32768);
                int count = text.Capacity;
                return QueryFullProcessImageName(this, 0, text, ref count) ? text.ToString() : null;
            }
        }
        internal string Package { get { return PackageName(this, false); } }
        internal string Family { get { return PackageName(this, true); } }
    }
    [DllImport("kernel32", SetLastError = true)] private static extern ProcessHandle OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32")] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32")] private static extern uint WaitForSingleObject(ProcessHandle process, uint ms);
    [DllImport("kernel32")] private static extern bool GetProcessTimes(ProcessHandle process, out FileTime created,
        out FileTime exited, out FileTime kernel, out FileTime user);
    [DllImport("kernel32", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool QueryFullProcessImageName(ProcessHandle process, int flags, StringBuilder name, ref int length);
    [DllImport("kernel32", CharSet = CharSet.Unicode)]
    private static extern int GetPackageFamilyName(ProcessHandle process, ref int length, StringBuilder name);
    [DllImport("kernel32", CharSet = CharSet.Unicode)]
    private static extern int GetPackageFullName(ProcessHandle process, ref int length, StringBuilder name);
    [DllImport("kernel32")] private static extern bool ProcessIdToSessionId(uint pid, out uint session);
    [DllImport("ntdll")] private static extern int NtQueryInformationProcess(ProcessHandle process, int kind,
        IntPtr buffer, int length, out int returned);
    [DllImport("shell32", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CommandLineToArgvW(string command, out int count);
    [DllImport("kernel32")] private static extern IntPtr LocalFree(IntPtr value);
    [DllImport("iphlpapi")] private static extern uint GetExtendedTcpTable(IntPtr table, ref int size,
        bool order, int family, int type, uint reserved);

    internal delegate bool EnumWindow(IntPtr window, IntPtr parameter);
    [DllImport("user32")] internal static extern bool EnumWindows(EnumWindow callback, IntPtr parameter);
    [DllImport("user32")] internal static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32")] private static extern bool IsHungAppWindow(IntPtr window);
    [DllImport("user32")] private static extern IntPtr GetWindow(IntPtr window, uint command);
    [DllImport("user32")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);

    internal static ProcessHandle Open(uint pid)
    {
        var handle = OpenProcess(0x1000 | 0x100000, false, pid); // QUERY_LIMITED_INFORMATION | SYNCHRONIZE
        FileTime exited, kernel, user;
        if (handle.IsInvalid || !GetProcessTimes(handle, out handle.Time, out exited, out kernel, out user))
        {
            handle.Dispose();
            return null;
        }
        handle.Pid = pid;
        return handle;
    }

    private static string PackageName(ProcessHandle process, bool family)
    {
        int count = 0;
        int rc = family ? GetPackageFamilyName(process, ref count, null) : GetPackageFullName(process, ref count, null);
        if (rc != 122 || count <= 0 || count > 1024) return null;
        var text = new StringBuilder(count);
        rc = family ? GetPackageFamilyName(process, ref count, text) : GetPackageFullName(process, ref count, text);
        return rc == 0 ? text.ToString() : null;
    }

    private static string CommandLine(ProcessHandle process)
    {
        int size;
        const int ProcessCommandLineInformation = 60;
        NtQueryInformationProcess(process, ProcessCommandLineInformation, IntPtr.Zero, 0, out size);
        if (size < 16 || size > 128 * 1024) return null;
        IntPtr buffer = Marshal.AllocHGlobal(size);
        try
        {
            int returned;
            if (NtQueryInformationProcess(process, ProcessCommandLineInformation, buffer, size, out returned) != 0) return null;
            int length = (ushort)Marshal.ReadInt16(buffer);
            IntPtr text = Marshal.ReadIntPtr(buffer, IntPtr.Size);
            long offset = text.ToInt64() - buffer.ToInt64();
            return offset >= 0 && length % 2 == 0 && offset + length <= size ?
                Marshal.PtrToStringUni(text, length / 2) : null;
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }

    private static string[] Arguments(string command)
    {
        if (String.IsNullOrEmpty(command)) return new string[0];
        int count;
        var argv = CommandLineToArgvW(command, out count);
        if (argv == IntPtr.Zero) return new string[0];
        try
        {
            return Enumerable.Range(0, count).Select(i => Marshal.PtrToStringUni(Marshal.ReadIntPtr(argv, i * IntPtr.Size))).ToArray();
        }
        finally { LocalFree(argv); }
    }

    internal static uint WindowProcess(IntPtr window)
    {
        uint pid;
        GetWindowThreadProcessId(window, out pid);
        return pid;
    }

    private static bool CurrentSession(uint pid)
    {
        uint session, current;
        return ProcessIdToSessionId((uint)Process.GetCurrentProcess().Id, out current) &&
               ProcessIdToSessionId(pid, out session) && session == current;
    }

    internal static bool IsCodex(ProcessHandle p, DesktopPackage package)
    {
        return p != null && p.Alive && CurrentSession(p.Pid) && p.Family == DesktopPackage.Family &&
            p.Package == package.packageFullName && String.Equals(p.Image, package.executable, StringComparison.OrdinalIgnoreCase);
    }

    [DllImport("advapi32", SetLastError = true)] private static extern bool OpenProcessToken(ProcessHandle process, uint access, out IntPtr token);
    [DllImport("advapi32", SetLastError = true)] private static extern bool GetTokenInformation(IntPtr token, int kind, out int value, int size, out int sizeNeeded);
    [DllImport("ntdll")] private static extern int NtQueryInformationProcess(ProcessHandle process, int kind, IntPtr[] data, int length, out int actual);

    internal static object Info(Dictionary<string, object> input)
    {
        uint pid = BetterCodexNative.UInt(BetterCodexNative.Text(input, "pid"));
        string expected = BetterCodexNative.Text(input, "executable", true);
        string argument = BetterCodexNative.Text(input, "argument", true);
        using (var p = Open(pid))
        {
            if (p == null || !p.Alive || !CurrentSession(pid) ||
                (expected.Length != 0 && !String.Equals(expected, p.Image, StringComparison.OrdinalIgnoreCase)) ||
                (argument.Length != 0 && !Arguments(CommandLine(p)).Skip(1).Contains(argument, StringComparer.OrdinalIgnoreCase)))
                return new { ok = true, matches = false };
            bool? elevated = null;
            IntPtr token;
            if (OpenProcessToken(p, 8, out token))
            {
                try { int value, used; if (GetTokenInformation(token, 20, out value, 4, out used)) elevated = value != 0; }
                finally { CloseHandle(token); }
            }
            var basic = new IntPtr[6];
            int length;
            long? parent = NtQueryInformationProcess(p, 0, basic, basic.Length * IntPtr.Size, out length) == 0 ? (long?)basic[5].ToInt64() : null;
            return new { ok = true, matches = p.Alive, created = p.CreatedText, started = p.Started, elevated = elevated, parent = parent };
        }
    }

    internal static object NetworkEnvironment()
    {
        string proxy = "";
        using (var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Internet Settings"))
            if (key != null && Object.Equals(key.GetValue("ProxyEnable"), 1)) proxy = key.GetValue("ProxyServer") as string ?? "";
        bool installed = false, running = false;
        try
        {
            using (var service = new System.ServiceProcess.ServiceController("luyucloudHelperService"))
            {
                running = service.Status == System.ServiceProcess.ServiceControllerStatus.Running;
                installed = true;
            }
        }
        catch (InvalidOperationException) { }
        bool core = false;
        foreach (var process in Process.GetProcessesByName("luyucloudcore"))
            using (process) core = true;
        return new { ok = true, proxy = proxy, vpnInstalled = installed, vpnService = running, vpnCore = core };
    }

    [DllImport("kernel32")] private static extern bool ReadProcessMemory(ProcessHandle p, IntPtr at, [Out] byte[] data, IntPtr size, out IntPtr count);
    private static byte[] ReadMemory(ProcessHandle process, IntPtr address, int size)
    {
        byte[] data = new byte[size]; IntPtr count;
        return ReadProcessMemory(process, address, data, new IntPtr(size), out count) && count.ToInt64() == size ? data : null;
    }
    private static string CurrentDirectory(uint pid)
    {
        using (var p = OpenProcess(0x0400 | 0x0010, false, pid)) // QUERY_INFORMATION | VM_READ
        {
            if (p.IsInvalid) return null;
            var wow = new IntPtr[1]; int length;
            if (NtQueryInformationProcess(p, 26, wow, IntPtr.Size, out length) != 0) return null;
            bool x86 = wow[0] != IntPtr.Zero;
            var basic = new IntPtr[6];
            if (!x86 && NtQueryInformationProcess(p, 0, basic, basic.Length * IntPtr.Size, out length) != 0) return null;
            // Native / WOW64 PEB ProcessParameters -> RTL_USER_PROCESS_PARAMETERS CurrentDirectory.
            int pointerSize = x86 ? 4 : 8;
            var parameters = ReadMemory(p, IntPtr.Add(x86 ? wow[0] : basic[1], x86 ? 0x10 : 0x20), pointerSize);
            if (parameters == null) return null;
            var directory = ReadMemory(p, IntPtr.Add(new IntPtr(x86 ? BitConverter.ToUInt32(parameters, 0) : BitConverter.ToInt64(parameters, 0)),
                x86 ? 0x24 : 0x38), 2 * pointerSize);
            if (directory == null) return null;
            int size = BitConverter.ToUInt16(directory, 0);
            if (size == 0 || size % 2 != 0) return null;
            var value = ReadMemory(p, new IntPtr(x86 ? BitConverter.ToUInt32(directory, 4) : BitConverter.ToInt64(directory, 8)), size);
            return value == null ? null : Encoding.Unicode.GetString(value);
        }
    }
    internal static string PathUse(string directory)
    {
        string prefix = directory.TrimEnd('\\');
        var relevant = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "ChatGPT", "codex", "node", "node_repl",
            "powershell", "pwsh", "cmd", "wscript", "BetterCodex" };
        bool incomplete = false;
        uint self = (uint)Process.GetCurrentProcess().Id;
        foreach (var process in Process.GetProcesses())
        using (process)
        {
            uint pid = (uint)process.Id;
            if (pid == self || !CurrentSession(pid)) continue;
            bool required = relevant.Contains(process.ProcessName);
            using (var handle = Open(pid))
            {
                if (handle == null) { incomplete |= required; continue; }
                var command = CommandLine(handle);
                string cwd = CurrentDirectory(pid);
                if (!handle.Alive) continue;
                if (cwd != null && (String.Equals(cwd.TrimEnd('\\'), prefix, StringComparison.OrdinalIgnoreCase) ||
                    cwd.StartsWith(prefix + "\\", StringComparison.OrdinalIgnoreCase))) return "in-use";
                if (command != null && command.IndexOf(prefix, StringComparison.OrdinalIgnoreCase) >= 0) return "in-use";
                incomplete |= required && (cwd == null || command == null);
            }
        }
        return incomplete ? "unknown" : "unused";
    }

    internal sealed class Listener
    {
        public uint pid { get; set; }
        public int port { get; set; }
        public string address { get; set; }
        public bool loopback { get; set; }
        public string executable { get; set; }
        public string created { get; set; }
        public double? started { get; set; }
        public string packageFamily { get; set; }
        public string packageFullName { get; set; }
        public bool currentSession { get; set; }
    }

    private static IEnumerable<Listener> ReadTcp(int family, int port)
    {
        int size = 0;
        const int OwnerPidListener = 3;
        uint rc = GetExtendedTcpTable(IntPtr.Zero, ref size, false, family, OwnerPidListener, 0);
        for (int retry = 0; rc == 122 && retry < 5; retry++)
        {
            if (size < 4 || size > 64 * 1024 * 1024) throw new InvalidOperationException();
            var buffer = Marshal.AllocHGlobal(size);
            try
            {
                int allocated = size;
                rc = GetExtendedTcpTable(buffer, ref size, false, family, OwnerPidListener, 0);
                if (rc != 0) continue;
                bool ipv6 = family == 23;
                int stride = ipv6 ? 56 : 24;
                int count = Marshal.ReadInt32(buffer);
                if (count < 0 || count > (allocated - 4) / stride) throw new InvalidOperationException();
                for (int i = 0; i < count; i++)
                {
                    var row = IntPtr.Add(buffer, 4 + i * stride);
                    int offset = ipv6 ? 20 : 8;
                    int localPort = (Marshal.ReadByte(row, offset) << 8) | Marshal.ReadByte(row, offset + 1);
                    if (port != 0 && localPort != port) continue;
                    byte[] bytes = new byte[ipv6 ? 16 : 4];
                    Marshal.Copy(IntPtr.Add(row, ipv6 ? 0 : 4), bytes, 0, bytes.Length);
                    var address = new IPAddress(bytes);
                    uint pid = unchecked((uint)Marshal.ReadInt32(row, ipv6 ? 52 : 20));
                    yield return new Listener { pid = pid, port = localPort, address = address.ToString(), loopback = IPAddress.IsLoopback(address) };
                }
                yield break;
            }
            finally { Marshal.FreeHGlobal(buffer); }
        }
        if (rc != 0) throw new Win32Exception((int)rc);
    }

    private static List<Listener> Tcp(int port)
    {
        return ReadTcp(2, port).Concat(ReadTcp(23, port)).ToList();
    }

    internal static List<Listener> Listeners(int port)
    {
        // Include wildcard and non-loopback listeners as conflicts, never as eligible owners.
        var listeners = Tcp(port);
        foreach (var row in listeners)
        {
            using (var p = Open(row.pid))
            {
                if (p == null || !p.Alive) continue;
                row.executable = p.Image;
                row.created = p.CreatedText;
                row.started = p.Started;
                if (row.loopback) { row.packageFamily = p.Family; row.packageFullName = p.Package; }
                row.currentSession = CurrentSession(p.Pid);
            }
        }
        return listeners;
    }

    internal static List<object> CodexProcesses(DesktopPackage package, out bool conflict)
    {
        conflict = false;
        var output = new List<object>();
        var listeners = Tcp(0).Where(row => row.loopback).ToLookup(row => row.pid);
        foreach (var candidate in Process.GetProcessesByName("ChatGPT"))
        using (candidate)
        using (var process = Open((uint)candidate.Id))
        {
            if (!IsCodex(process, package))
            {
                if (CurrentSession((uint)candidate.Id) && (process == null || process.Alive)) conflict = true;
                continue;
            }
            string command = CommandLine(process);
            string[] args = Arguments(command);
            if (args.Length == 0)
            {
                if (!process.Alive) continue;
                throw new InvalidOperationException();
            }
            IntPtr main = IntPtr.Zero;
            EnumWindows((window, ignored) =>
            {
                if (WindowProcess(window) == process.Pid && GetWindow(window, 4) == IntPtr.Zero)
                {
                    if (main == IntPtr.Zero) main = window;
                    if (IsWindowVisible(window)) { main = window; return false; }
                }
                return true;
            }, IntPtr.Zero);
            if (!process.Alive) continue;
            output.Add(new { pid = process.Pid, executable = process.Image, packageFamily = process.Family,
                packageFullName = process.Package, created = process.CreatedText, started = process.Started,
                main = !args.Skip(1).Any(a => a.StartsWith("--type=", StringComparison.Ordinal)),
                debuggingRequested = args.Skip(1).Any(a => a.StartsWith("--remote-debugging-port", StringComparison.Ordinal)),
                windowHandle = main.ToInt64().ToString(CultureInfo.InvariantCulture),
                visible = main != IntPtr.Zero && IsWindowVisible(main),
                responding = main != IntPtr.Zero && !IsHungAppWindow(main),
                listening = listeners[process.Pid].Select(row => new { row.address, row.port }).ToArray() });
        }
        return output;
    }
}
