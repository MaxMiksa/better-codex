// Off-screen, no-activation native window; no other process receives messages.
using System;
using System.IO;
using System.Runtime.InteropServices;

internal static class NativeExitFixture
{
    private static string receipt;
    private static bool accept;
    private static int queries, ends;
    private static readonly Procedure Callback = Handle;

    private delegate IntPtr Procedure(IntPtr hwnd, uint msg, IntPtr w, IntPtr l);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct WindowClass
    {
        public uint style;
        public Procedure procedure;
        public int clsExtra, wndExtra;
        public IntPtr instance, icon, cursor, brush;
        public string menu, name;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct Message
    {
        public IntPtr hwnd;
        public uint message;
        public IntPtr w, l;
        public uint time;
        public int x, y;
        public uint priv;
    }

    [DllImport("kernel32", CharSet = CharSet.Unicode)] private static extern IntPtr GetModuleHandleW(string name);
    [DllImport("user32", CharSet = CharSet.Unicode)] private static extern ushort RegisterClassW(ref WindowClass value);
    [DllImport("user32", CharSet = CharSet.Unicode)] private static extern IntPtr CreateWindowExW(uint ex, string cls,
        string name, uint style, int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr arg);
    [DllImport("user32", CharSet = CharSet.Unicode)] private static extern IntPtr DefWindowProcW(IntPtr hwnd, uint msg, IntPtr w, IntPtr l);
    [DllImport("user32", CharSet = CharSet.Unicode)] private static extern int GetMessageW(out Message msg, IntPtr hwnd, uint first, uint last);
    [DllImport("user32", CharSet = CharSet.Unicode)] private static extern IntPtr DispatchMessageW(ref Message msg);
    [DllImport("user32")] private static extern bool DestroyWindow(IntPtr hwnd);
    [DllImport("user32")] private static extern void PostQuitMessage(int exit);

    private static void Publish() { File.WriteAllText(receipt, queries + "," + ends); }

    private static IntPtr Handle(IntPtr hwnd, uint msg, IntPtr w, IntPtr l)
    {
        switch (msg)
        {
            case 0x11: // WM_QUERYENDSESSION
                queries++; Publish();
                return new IntPtr(accept ? 1 : 0);
            case 0x16: // WM_ENDSESSION
                if (w != IntPtr.Zero) { ends++; Publish(); DestroyWindow(hwnd); }
                return IntPtr.Zero;
            case 0x02:
                PostQuitMessage(0);
                return IntPtr.Zero;
            default:
                return DefWindowProcW(hwnd, msg, w, l);
        }
    }

    private static int Main(string[] args)
    {
        accept = args[0] == "accept"; receipt = args[1];
        var cls = new WindowClass { name = "BetterCodexNativeExitFixture", instance = GetModuleHandleW(null), procedure = Callback };
        if (RegisterClassW(ref cls) == 0) return 1;
        if (CreateWindowExW(0x08000080, cls.name, "Better-Codex isolated native fixture", 0x10CF0000,
            -20000, -20000, 300, 120, IntPtr.Zero, IntPtr.Zero, cls.instance, IntPtr.Zero) == IntPtr.Zero) return 2;
        Publish();
        Message msg;
        int result;
        while ((result = GetMessageW(out msg, IntPtr.Zero, 0, 0)) > 0) DispatchMessageW(ref msg);
        return result == 0 ? 0 : 3;
    }
}
