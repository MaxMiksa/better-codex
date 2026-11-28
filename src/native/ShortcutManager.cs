using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;

internal static class ShortcutManager
{
    [ComImport, Guid("00021401-0000-0000-C000-000000000046")]
    private class ShellLink { }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("000214F9-0000-0000-C000-000000000046")]
    private interface IShellLinkW
    {
        void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int size, IntPtr data, uint flags);
        void GetIDList(out IntPtr id);
        void SetIDList(IntPtr id);
        void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder text, int size);
        void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string text);
        void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int size);
        void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string path);
        void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder text, int size);
        void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string text);
        void GetHotkey(out ushort key);
        void SetHotkey(ushort key);
        void GetShowCmd(out int cmd);
        void SetShowCmd(int cmd);
        void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int size, out int index);
        void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string path, int index);
        void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string path, uint reserved);
        void Resolve(IntPtr window, uint flags);
        void SetPath([MarshalAs(UnmanagedType.LPWStr)] string path);
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PropertyKey { public Guid Format; public uint Id; }

    // PROPVARIANT is 24 bytes on x64 (the union includes a counted pointer).
    [StructLayout(LayoutKind.Explicit, Size = 24)]
    private struct PropertyValue
    {
        [FieldOffset(0)] public ushort Type;
        [FieldOffset(8)] public IntPtr Pointer;
    }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")]
    private interface IPropertyStore
    {
        void GetCount(out uint count);
        void GetAt(uint index, out PropertyKey key);
        void GetValue(ref PropertyKey key, out PropertyValue value);
        void SetValue(ref PropertyKey key, ref PropertyValue value);
        void Commit();
    }

    [DllImport("ole32")] private static extern int PropVariantClear(ref PropertyValue value);
    [DllImport("shell32", CharSet = CharSet.Unicode)] private static extern void SHChangeNotify(int evt, uint flags, string first, IntPtr second);
    private static PropertyKey AppKey()
    {
        return new PropertyKey { Format = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), Id = 5 }; // PKEY_AppUserModel_ID
    }

    private static string LinkPath(string input)
    {
        string file = ShellActions.LocalPath(input);
        if (!String.Equals(Path.GetExtension(file), ".lnk", StringComparison.OrdinalIgnoreCase)) throw new ArgumentException();
        if (File.Exists(file) && (File.GetAttributes(file) & FileAttributes.ReparsePoint) != 0) throw new ArgumentException();
        return file;
    }

    internal static object Inspect(string input)
    {
        string file = LinkPath(input);
        if (!File.Exists(file)) throw new FileNotFoundException();
        var link = (IShellLinkW)new ShellLink();
        try
        {
            ((IPersistFile)link).Load(file, 0);
            var target = new StringBuilder(32768);
            var args = new StringBuilder(32768);
            var working = new StringBuilder(32768);
            var icon = new StringBuilder(32768);
            var description = new StringBuilder(1024);
            int index;
            link.GetPath(target, target.Capacity, IntPtr.Zero, 4); // SLGP_RAWPATH, no resolving or launching.
            link.GetArguments(args, args.Capacity);
            link.GetWorkingDirectory(working, working.Capacity);
            link.GetIconLocation(icon, icon.Capacity, out index);
            link.GetDescription(description, description.Capacity);
            PropertyValue value;
            PropertyKey key = AppKey();
            ((IPropertyStore)link).GetValue(ref key, out value);
            try
            {
                return new { target = target.ToString(), arguments = args.ToString(), workingDirectory = working.ToString(),
                    icon = icon.ToString(), iconIndex = index, description = description.ToString(),
                    appId = value.Type == 31 ? Marshal.PtrToStringUni(value.Pointer) : null };
            }
            finally { PropVariantClear(ref value); }
        }
        finally { Marshal.FinalReleaseComObject(link); }
    }

    internal static object Install(Dictionary<string, object> input)
    {
        string file = LinkPath(BetterCodexNative.Text(input, "path"));
        string target = ShellActions.LocalPath(BetterCodexNative.Text(input, "target"));
        string appId = BetterCodexNative.Text(input, "appId");
        string working = BetterCodexNative.Text(input, "workingDirectory", true), icon = BetterCodexNative.Text(input, "icon", true);
        string index = BetterCodexNative.Text(input, "iconIndex", true);
        if (appId.Length == 0 || appId.Length > 128) throw new ArgumentException();
        var link = (IShellLinkW)new ShellLink();
        try
        {
            var persist = (IPersistFile)link;
            if (File.Exists(file)) persist.Load(file, 2);
            link.SetPath(target);
            link.SetArguments(BetterCodexNative.Text(input, "arguments", true));
            if (working.Length != 0) link.SetWorkingDirectory(ShellActions.LocalPath(working));
            if (icon.Length != 0) link.SetIconLocation(ShellActions.LocalPath(icon),
                index.Length == 0 ? 0 : checked((int)BetterCodexNative.UInt(index)));
            link.SetDescription(BetterCodexNative.Text(input, "description", true));
            var property = (IPropertyStore)link;
            var key = AppKey();
            var value = new PropertyValue { Type = 31, Pointer = Marshal.StringToCoTaskMemUni(appId) }; // VT_LPWSTR
            try { property.SetValue(ref key, ref value); property.Commit(); }
            finally { PropVariantClear(ref value); }
            persist.Save(file, true);
        }
        finally { Marshal.FinalReleaseComObject(link); }
        SHChangeNotify(0x2000, 5, file, IntPtr.Zero); // SHCNE_UPDATEITEM / SHCNF_PATHW
        SHChangeNotify(0x08000000, 0, null, IntPtr.Zero);
        return Inspect(file);
    }
}
