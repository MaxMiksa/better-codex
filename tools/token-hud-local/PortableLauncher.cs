using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using System.Windows.Forms;

internal static class PortableLauncher {
    private static string Quote(string value) { return "\"" + value.Replace("\"", "\\\"") + "\""; }
    private static void ActivateCodex() {
        try {
            Process.Start(new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "explorer.exe"),
                "shell:AppsFolder\\OpenAI.Codex_2p2nqsd0c76g0!App") { UseShellExecute = true });
        } catch { }
    }

    [STAThread]
    private static int Main(string[] args) {
        using (var mutex = new Mutex(false, "Local\\BetterCodexPortableBootstrap")) {
            bool held = false;
            try {
                try { held = mutex.WaitOne(30000); } catch (AbandonedMutexException) { held = true; }
                return held ? Run(args) : 0;
            } finally { if (held) mutex.ReleaseMutex(); }
        }
    }

    private static int Run(string[] args) {
        bool normal = args.Length == 0;
        try {
            string mode = normal ? "--launch" : args[0];
            if (args.Length > 1 || (mode != "--launch" && mode != "--check" && mode != "--prepare-only" && mode != "--stop")) return 1;
            string root = AppDomain.CurrentDomain.BaseDirectory;
            string python = Path.Combine(root, "runtime", "python", "python.exe");
            string script = Path.Combine(root, "tools", "token-hud-local", "portable_bootstrap.py");
            if (!File.Exists(python) || !File.Exists(script)) throw new FileNotFoundException();
            var start = new ProcessStartInfo(python, "-B -X utf8 " + Quote(script) + " " + mode) {
                WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardOutput = true, RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8
            };
            using (var process = Process.Start(start)) {
                var errors = process.StandardError.ReadToEndAsync();
                string output = process.StandardOutput.ReadToEnd();
                process.WaitForExit();
                Console.Write(output);
                if (process.ExitCode == 2 && normal) {
                    MessageBox.Show("Save your work and exit Codex normally when convenient, then open BetterCodex.exe again. Your current Codex session has been preserved.", "Better Codex", MessageBoxButtons.OK, MessageBoxIcon.Information);
                } else if (process.ExitCode != 0 && normal) {
                    ActivateCodex();
                    MessageBox.Show("Better Codex could not start its enhancements. Extract the entire portable ZIP to a writable folder, and make sure the official Codex Windows app is installed. Codex activation was attempted.\n\n" + output.Trim(), "Better Codex", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                }
                return process.ExitCode;
            }
        } catch (Exception error) {
            if (normal) {
                ActivateCodex();
                MessageBox.Show("Extract the entire Better Codex portable ZIP before starting it.\n\n" + error.GetType().Name, "Better Codex", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
            return 1;
        }
    }
}
