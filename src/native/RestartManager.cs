using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

internal static class RestartManager
{
    [StructLayout(LayoutKind.Sequential)]
    private struct UniqueProcess { public uint Pid; public ProcessInspector.FileTime Created; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct ProcessInfo
    {
        public UniqueProcess Process;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string Name;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string Service;
        public int Type;
        public uint Status, Session;
        public bool Restartable;
    }

    [DllImport("rstrtmgr", CharSet = CharSet.Unicode)] private static extern uint RmStartSession(out uint session, uint flags, StringBuilder key);
    [DllImport("rstrtmgr")] private static extern uint RmRegisterResources(uint session, uint files, IntPtr names,
        uint processes, ref UniqueProcess target, uint services, IntPtr serviceNames);
    [DllImport("rstrtmgr")] private static extern uint RmGetList(uint session, out uint needed, ref uint count,
        [In, Out] ProcessInfo[] affected, ref uint reasons);
    [DllImport("rstrtmgr")] private static extern uint RmShutdown(uint session, uint flags, IntPtr callback);
    [DllImport("rstrtmgr")] private static extern uint RmCancelCurrentTask(uint session);
    [DllImport("rstrtmgr")] private static extern uint RmEndSession(uint session);

    private static object Result(string status, uint code = 0)
    {
        return new { ok = status == "closed", status = status, code = code };
    }

    internal static object Close(uint pid, long created, int timeout)
    {
        if (pid == 0 || timeout < 1 || timeout > 120000) throw new ArgumentException();
        var clock = Stopwatch.StartNew();
        using (var p = ProcessInspector.Open(pid))
        {
            if (p == null || p.Created != created || !p.Alive) return Result("identity-mismatch");
            var target = new UniqueProcess { Pid = pid, Created = p.Time };
            uint session;
            uint rc = RmStartSession(out session, 0, new StringBuilder(33));
            if (rc != 0) return Result("unavailable", rc);
            try
            {
                rc = RmRegisterResources(session, 0, IntPtr.Zero, 1, ref target, 0, IntPtr.Zero);
                if (rc != 0) return Result("unavailable", rc);
                uint needed, count = 1, reasons = 0;
                var affected = new ProcessInfo[1];
                rc = RmGetList(session, out needed, ref count, affected, ref reasons);
                if (rc != 0 || count != 1 || affected[0].Process.Pid != pid ||
                    affected[0].Process.Created.Value != created || !p.Alive) return Result("identity-mismatch", rc);
                int remaining = timeout - (int)clock.ElapsedMilliseconds;
                if (remaining <= 0) return Result("timed-out");
                var timer = new Timer(ignored => RmCancelCurrentTask(session), null, remaining, Timeout.Infinite);
                try { rc = RmShutdown(session, 0, IntPtr.Zero); } // Never force shutdown.
                finally
                {
                    // Do not let the cancellation callback race RmEndSession.
                    using (var drained = new ManualResetEvent(false)) { timer.Dispose(drained); drained.WaitOne(); }
                }
                if (rc == 0 && p.Wait((uint)Math.Max(0, timeout - clock.ElapsedMilliseconds))) return Result("closed");
                if (clock.ElapsedMilliseconds >= timeout || rc == 1223) return Result("timed-out", rc);
                return Result("refused", rc);
            }
            finally { RmEndSession(session); }
        }
    }
}
