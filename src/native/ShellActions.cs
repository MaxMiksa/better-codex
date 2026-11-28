using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Threading;
using Microsoft.CSharp.RuntimeBinder;
using Microsoft.Win32.SafeHandles;

internal static class ShellActions
{
    private const uint Cloud = 0x00441000, Reparse = 0x400, Directory = 0x10, Device = 0x40;
    private static readonly HashSet<string> Documents = Extensions(
        "txt text md markdown rst adoc org log csv tsv json jsonc yml yaml toml ini xml sql css scss less " +
        "c h cpp hpp cs java go rs swift kt vue svelte pdf docx xlsx pptx odt ods odp rtf " +
        "png jpg jpeg gif bmp ico webp heic avif tiff tif mp3 wav flac ogg mp4 mov webm mkv");
    private static readonly HashSet<string> Sources = Extensions(
        "js mjs cjs ts tsx jsx py ps1 psm1 sh bash zsh bat cmd html htm svg reg vbs lua pl rb php");
    private static readonly HashSet<string> PreviewNames = new HashSet<string>(
        new[] { ".gitignore", ".gitattributes", ".env.example", "dockerfile", "makefile", "readme", "license" },
        StringComparer.OrdinalIgnoreCase);

    private static HashSet<string> Extensions(string values)
    {
        return new HashSet<string>(Array.ConvertAll(values.Split(' '), ext => "." + ext), StringComparer.OrdinalIgnoreCase);
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct FindData
    {
        public uint Attributes;
        public ProcessInspector.FileTime Created, Accessed, Modified;
        public uint SizeHigh, SizeLow, Tag, Reserved;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string Name;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 14)] public string Alias;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct HandleInfo
    {
        public uint Attributes;
        public ProcessInspector.FileTime Created, Accessed, Modified;
        public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
        internal long Size { get { return ((long)SizeHigh << 32) | SizeLow; } }
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct FlashInfo
    {
        public uint Size;
        public IntPtr Window;
        public uint Flags, Count, Timeout;
    }
    [DllImport("shell32", CharSet = CharSet.Unicode)]
    private static extern int SHParseDisplayName(string path, IntPtr bind, out IntPtr id, uint requested, IntPtr attrs);
    [DllImport("shell32")] private static extern int SHOpenFolderAndSelectItems(IntPtr id, uint count, IntPtr children, uint flags);
    [DllImport("kernel32", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr FindFirstFileW(string path, out FindData data);
    [DllImport("kernel32")] private static extern bool FindClose(IntPtr find);
    [DllImport("kernel32", CharSet = CharSet.Unicode)] private static extern uint GetDriveTypeW(string root);
    [DllImport("kernel32", CharSet = CharSet.Unicode, SetLastError = true)] private static extern SafeFileHandle CreateFileW(
        string path, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool ReplaceFileW(
        string replaced, string replacement, IntPtr backup, uint flags, IntPtr exclude, IntPtr reserved);
    [DllImport("kernel32", CharSet = CharSet.Unicode)] private static extern uint GetFinalPathNameByHandleW(
        SafeFileHandle file, StringBuilder path, int size, uint flags);
    [DllImport("kernel32")] private static extern bool GetFileInformationByHandle(SafeFileHandle file, out HandleInfo info);
    [DllImport("kernel32")] private static extern bool GetNamedPipeServerProcessId(SafeFileHandle pipe, out uint pid);
    [DllImport("kernel32")] private static extern bool WriteFile(SafeFileHandle file, byte[] buffer, uint count, out uint written, IntPtr overlapped);
    [DllImport("user32")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32", CharSet = CharSet.Unicode)] private static extern int GetClassNameW(IntPtr window, StringBuilder name, int count);
    [DllImport("user32")] private static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32")] private static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32")] private static extern IntPtr GetTopWindow(IntPtr window);
    [DllImport("user32")] private static extern IntPtr GetWindow(IntPtr window, uint command);
    [DllImport("user32")] private static extern bool FlashWindowEx(ref FlashInfo info);

    internal static string LocalPath(string input)
    {
        if (input.Length < 3 || input.Length > 32760 || !Char.IsLetter(input[0]) || input[1] != ':' ||
            input[2] != '\\' || input.IndexOf(':', 2) >= 0 || input.IndexOfAny(new[] { '*', '?', '"', '|', '<', '>', '/', '\r', '\n' }) >= 0)
            throw new ArgumentException();
        string full = Path.GetFullPath(input);
        if (!String.Equals(input, full, StringComparison.OrdinalIgnoreCase)) throw new ArgumentException();
        uint drive = GetDriveTypeW(full.Substring(0, 3));
        if (drive != 2 && drive != 3 && drive != 5 && drive != 6) throw new ArgumentException();
        return full;
    }

    private static object Result(string status, int code = 0) { return new { ok = code == 0, status = status, code = code }; }

    internal static object Run(Dictionary<string, object> input)
    {
        string verb = BetterCodexNative.Text(input, "verb"), file = LocalPath(BetterCodexNative.Text(input, "path"));
        if (verb == "preview-file-info") return PreviewInfo(file);
        if (verb == "replace-preview")
            return Replace(file, LocalPath(BetterCodexNative.Text(input, "staged")),
                BetterCodexNative.Long(BetterCodexNative.Text(input, "mtimeNs")), BetterCodexNative.Long(BetterCodexNative.Text(input, "size")));
        if (verb == "folder")
        {
            if (!System.IO.Directory.Exists(file)) throw new ArgumentException();
            string pidText = BetterCodexNative.Text(input, "desktopPid", true);
            uint pid = pidText.Length == 0 ? 0 : BetterCodexNative.UInt(pidText);
            return OpenFolder(file, pid) ? Result("opened") : Result("folder-background", 3);
        }
        var data = Find(file);
        string ext = Path.GetExtension(file);
        bool document = Documents.Contains(ext);
        switch (verb)
        {
            case "open":
                if (!document) { Locate(file); return Result("located"); }
                try { StartShell(file, "open"); }
                catch (Win32Exception e) { if (e.NativeErrorCode == 1155) return Result("association-missing", 2); throw; }
                return Result("opened");
            case "locate":
                Locate(file); return Result("located");
            case "quicklook":
            case "peek":
                // Previewing scripts means giving the path to a known preview program, never to ShellExecute.
                if ((data.Attributes & Cloud) != 0) return Result("preview-unavailable", 4);
                if (!document && !Sources.Contains(ext) && !PreviewNames.Contains(Path.GetFileName(file)))
                { Locate(file); return Result("located"); }
                if (verb == "peek") return Peek(file);
                string executable = LocalPath(BetterCodexNative.Text(input, "executable"));
                if (!String.Equals(Path.GetFileName(executable), "QuickLook.exe", StringComparison.OrdinalIgnoreCase))
                    throw new ArgumentException();
                return QuickLook(file, executable);
            default: throw new ArgumentException();
        }
    }

    private static FindData Find(string file)
    {
        FindData data;
        IntPtr find = FindFirstFileW(@"\\?\" + file, out data);
        if (find == new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error());
        FindClose(find);
        if (!String.Equals(data.Name, Path.GetFileName(file), StringComparison.OrdinalIgnoreCase) ||
            (data.Attributes & (Directory | Device)) != 0 ||
            ((data.Attributes & Reparse) != 0 && ((data.Tag & 0x20000000) != 0 ||
                ((data.Attributes & Cloud) != 0 && (data.Tag & ~0xF000u) != 0x9000001Au))))
            throw new ArgumentException();
        return data;
    }

    private static object PreviewInfo(string file)
    {
        FindData data = Find(file); // This does not hydrate an offline cloud file.
        return new { ok = true, cloudOnly = (data.Attributes & Cloud) != 0, size = ((long)data.SizeHigh << 32) | data.SizeLow };
    }

    private static void Locate(string file)
    {
        IntPtr id;
        Marshal.ThrowExceptionForHR(SHParseDisplayName(file, IntPtr.Zero, out id, 0, IntPtr.Zero));
        try { Marshal.ThrowExceptionForHR(SHOpenFolderAndSelectItems(id, 0, IntPtr.Zero, 0)); }
        finally { Marshal.FreeCoTaskMem(id); }
    }

    private static void StartShell(string file, string verb)
    {
        using (Process.Start(new ProcessStartInfo(file) { UseShellExecute = true, Verb = verb })) { }
    }

    private static bool IsExplorer(IntPtr window)
    {
        var name = new StringBuilder(64);
        GetClassNameW(window, name, name.Capacity);
        return name.ToString() == "CabinetWClass" || name.ToString() == "ExploreWClass";
    }

    private static bool OpenFolder(string file, uint pid)
    {
        IntPtr source = GetForegroundWindow();
        bool tracked = false;
        if (pid != 0 && source != IntPtr.Zero && ProcessInspector.WindowProcess(source) == pid)
        {
            using (var process = ProcessInspector.Open(pid))
                tracked = process != null && process.Alive && process.Family == DesktopPackage.Family;
        }
        var previous = new HashSet<IntPtr>();
        if (tracked) ProcessInspector.EnumWindows((window, ignored) =>
            { if (IsExplorer(window)) previous.Add(window); return true; }, IntPtr.Zero);
        StartShell(file, "opennewwindow");
        if (!tracked) return true;
        var clock = Stopwatch.StartNew();
        try
        {
            dynamic shell = Activator.CreateInstance(Type.GetTypeFromProgID("Shell.Application", true));
            while (clock.ElapsedMilliseconds < 1800)
            {
                var current = GetForegroundWindow();
                if (current != IntPtr.Zero && current != source && !IsExplorer(current)) return true;
                var matches = new HashSet<IntPtr>();
                foreach (dynamic view in shell.Windows())
                {
                    try
                    {
                        var window = new IntPtr(Convert.ToInt64(view.HWND));
                        if (!previous.Contains(window) && IsExplorer(window) && ProcessInspector.IsWindowVisible(window) &&
                            String.Equals(Path.GetFullPath((string)view.Document.Folder.Self.Path), file, StringComparison.OrdinalIgnoreCase))
                            matches.Add(window);
                    }
                    catch (COMException) { }
                    catch (RuntimeBinderException) { }
                    catch (ArgumentException) { }
                }
                if (matches.Count == 1)
                {
                    foreach (var target in matches)
                    {
                        if (GetForegroundWindow() != source) return GetForegroundWindow() != IntPtr.Zero;
                        SetForegroundWindow(target);
                        if (GetForegroundWindow() != source) return true;
                        SetWindowPos(target, IntPtr.Zero, 0, 0, 0, 0, 0x213); // No move, resize, activation or owner changes.
                        var preceding = GetTopWindow(IntPtr.Zero);
                        for (int i = 0; i < 256 && preceding != source && preceding != IntPtr.Zero; i++)
                        {
                            if (preceding == target) return true;
                            preceding = GetWindow(preceding, 2);
                        }
                        var flash = new FlashInfo { Size = (uint)Marshal.SizeOf(typeof(FlashInfo)), Window = target, Flags = 2, Count = 3 };
                        FlashWindowEx(ref flash);
                        return false;
                    }
                }
                if (current != source && previous.Contains(current)) return true;
                Thread.Sleep(75);
            }
        }
        catch (COMException) { }
        catch (RuntimeBinderException) { }
        IntPtr foreground = GetForegroundWindow();
        return foreground != IntPtr.Zero && foreground != source;
    }

    private static bool SameFile(string first, string second)
    {
        if (first == null) return false;
        HandleInfo a, b;
        using (var x = OpenMetadata(first))
        using (var y = OpenMetadata(second))
            return !x.IsInvalid && !y.IsInvalid && GetFileInformationByHandle(x, out a) &&
                GetFileInformationByHandle(y, out b) && a.Volume == b.Volume && a.IndexHigh == b.IndexHigh && a.IndexLow == b.IndexLow;
    }

    private static SafeFileHandle OpenMetadata(string file)
    {
        return CreateFileW(@"\\?\" + file, 0x80, 7, IntPtr.Zero, 3, 0x00200000, IntPtr.Zero); // No reparse following at the leaf.
    }

    private static void StartPreview(string executable, string file)
    {
        using (Process.Start(new ProcessStartInfo(executable, "\"" + file + "\"") {
            UseShellExecute = false, WorkingDirectory = Path.GetDirectoryName(executable) })) { }
    }

    private static object QuickLook(string file, string executable)
    {
        if ((Find(executable).Attributes & (Reparse | Cloud)) != 0) throw new ArgumentException();
        string sid;
        using (var identity = WindowsIdentity.GetCurrent()) sid = identity.User.Value;
        using (var pipe = CreateFileW(@"\\.\pipe\QuickLook.App.Pipe." + sid, 0x40000000, 0,
            IntPtr.Zero, 3, 0x00110000, IntPtr.Zero)) // SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION
        {
            if (pipe.IsInvalid)
            {
                int error = Marshal.GetLastWin32Error();
                if (error != 2) return Result("quicklook-unavailable", 4);
                StartPreview(executable, file);
                return Result("quicklook-started");
            }
            uint pid;
            if (!GetNamedPipeServerProcessId(pipe, out pid)) return Result("quicklook-unverified", 1);
            using (var owner = ProcessInspector.Open(pid))
            {
                if (owner == null || !owner.Alive || !SameFile(owner.Image, executable))
                    return Result("quicklook-unverified", 1);
                byte[] payload = Encoding.UTF8.GetBytes("QuickLook.App.PipeMessages.Invoke|" + file + "|\n");
                uint written;
                if (!WriteFile(pipe, payload, (uint)payload.Length, out written, IntPtr.Zero) || written != payload.Length)
                    return Result("quicklook-unavailable", 1);
            }
            return Result("previewed");
        }
    }

    private static object Peek(string file)
    {
        foreach (string key in new[] { "LOCALAPPDATA", "ProgramW6432", "ProgramFiles" })
        {
            string root = Environment.GetEnvironmentVariable(key);
            if (String.IsNullOrEmpty(root)) continue;
            string executable = Path.Combine(root, "PowerToys", "WinUI3Apps", "PowerToys.Peek.UI.exe");
            if (!File.Exists(executable)) continue;
            executable = LocalPath(executable);
            if ((Find(executable).Attributes & (Reparse | Cloud)) != 0) continue;
            StartPreview(executable, file);
            return Result("previewed");
        }
        return Result("preview-unavailable", 4);
    }

    private static bool Unchanged(string file, long ns, long size, out HandleInfo id)
    {
        id = new HandleInfo();
        using (var handle = OpenMetadata(file))
        {
            if (handle.IsInvalid || !GetFileInformationByHandle(handle, out id) ||
                (id.Attributes & (1 | Reparse | Cloud | Directory | Device)) != 0 || id.Links != 1 ||
                id.Size != size || checked((id.Modified.Value - 116444736000000000L) * 100) != ns) return false;
            var name = new StringBuilder(32768);
            uint count = GetFinalPathNameByHandleW(handle, name, name.Capacity, 0);
            return count != 0 && count < name.Capacity && String.Equals(name.ToString(), @"\\?\" + file, StringComparison.OrdinalIgnoreCase);
        }
    }

    private static object Replace(string file, string staged, long ns, long size)
    {
        HandleInfo before, after;
        if (!Unchanged(file, ns, size, out before)) return Result("conflict", 5);
        byte[] bytes = new byte[160 * 1024 + 1];
        int used = 0;
        using (var source = File.OpenRead(staged))
        {
            int count;
            while (used < bytes.Length && (count = source.Read(bytes, used, bytes.Length - used)) > 0) used += count;
        }
        if (used == bytes.Length) throw new ArgumentException();
        string temp = Path.Combine(Path.GetDirectoryName(file), ".bc-preview-" + Guid.NewGuid().ToString("N") + ".tmp");
        try
        {
            var acl = File.GetAccessControl(file, AccessControlSections.Access);
            using (var output = new FileStream(temp, FileMode.CreateNew, FileSystemRights.Write, FileShare.None, 4096,
                FileOptions.None, acl))
            {
                output.Write(bytes, 0, used);
                output.Flush(true);
            }
            if (!Unchanged(file, ns, size, out after) || before.Volume != after.Volume ||
                before.IndexHigh != after.IndexHigh || before.IndexLow != after.IndexLow) return Result("conflict", 5);
            if (!ReplaceFileW(file, temp, IntPtr.Zero, 0, IntPtr.Zero, IntPtr.Zero))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            return Result("saved");
        }
        finally { File.Delete(temp); }
    }
}
