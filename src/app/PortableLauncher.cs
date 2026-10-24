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

    private static bool StartDiagnostics(string root) {
        try {
            string script = Path.Combine(root, "tools", "token-hud-local", "Show-StartupCheck.ps1");
            if (!File.Exists(script)) return false;
            string powershell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows),
                "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
            using (var process = Process.Start(new ProcessStartInfo(powershell,
                "-NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File " + Quote(script)) {
                    UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden
                })) return process != null;
        } catch { return false; }
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
            bool diagnosticsStarted = mode == "--launch" && StartDiagnostics(root);
            string python = Path.Combine(root, "runtime", "python", "python.exe");
            string script = Path.Combine(root, "tools", "token-hud-local", "portable_bootstrap.py");
            if (!File.Exists(python) || !File.Exists(script)) throw new FileNotFoundException();
            var start = new ProcessStartInfo(python, "-B -X utf8 " + Quote(script) + " " + mode) {
                WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardOutput = true, RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8
            };
            if (diagnosticsStarted) start.EnvironmentVariables["BETTER_CODEX_STARTUP_CHECK_STARTED"] = "1";
            using (var process = Process.Start(start)) {
                var errors = process.StandardError.ReadToEndAsync();
                string output = process.StandardOutput.ReadToEnd();
                process.WaitForExit();
                Console.Write(output);
                if (process.ExitCode == 2 && normal) {
                    MessageBox.Show(BetterCodexI18n.Text(root, "launch.restart-required"), "Better-Codex", MessageBoxButtons.OK, MessageBoxIcon.Information);
                } else if (process.ExitCode != 0 && normal) {
                    ActivateCodex();
                    string detail = BetterCodexI18n.OutputMessage(output);
                    MessageBox.Show(BetterCodexI18n.Text(root, "portable.failed") + (String.IsNullOrEmpty(detail) ? "" : "\n\n" + detail), "Better-Codex", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                }
                return process.ExitCode;
            }
        } catch (Exception error) {
            if (normal) {
                ActivateCodex();
                MessageBox.Show(BetterCodexI18n.Text(AppDomain.CurrentDomain.BaseDirectory, "portable.extract") + "\n\n" + error.GetType().Name, "Better-Codex", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
            return 1;
        }
    }
}
