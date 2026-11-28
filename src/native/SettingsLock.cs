using System;
using System.Diagnostics;
using System.IO;
using System.Threading;

internal static class SettingsLock
{
    // Same Windows byte-range lock as Python's msvcrt.locking compatibility writer.
    // The process exits and releases the lock automatically if its stdin owner dies.
    internal static FileStream Acquire(string path)
    {
        path = ShellActions.LocalPath(path);
        Directory.CreateDirectory(Path.GetDirectoryName(path));
        var file = new FileStream(path + ".lock", FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.ReadWrite);
        try
        {
            var clock = Stopwatch.StartNew();
            for (;;)
            {
                try { file.Lock(0, 1); break; }
                catch (IOException e)
                {
                    int code = e.HResult & 0xffff;
                    if ((code != 32 && code != 33) || clock.ElapsedMilliseconds >= 3000) throw;
                    Thread.Sleep(25);
                }
            }
            if (file.Length == 0) { file.WriteByte(0); file.Flush(); }
            return file;
        }
        catch { file.Dispose(); throw; }
    }
}
