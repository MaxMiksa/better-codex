using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Globalization;
using System.Text;
using System.Web.Script.Serialization;

internal static class BetterCodexNative
{
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 4 * 1024 * 1024, RecursionLimit = 20 };

    [STAThread]
    private static int Main(string[] args)
    {
        AppContext.SetSwitch("Switch.System.IO.UseLegacyPathHandling", false);
        AppContext.SetSwitch("Switch.System.IO.BlockLongPaths", false);
        Console.InputEncoding = new UTF8Encoding(false, true);
        Console.OutputEncoding = new UTF8Encoding(false);
        object result;
        int exit = 0;
        try
        {
            if (args.Length == 0) throw new ArgumentException();
            switch (args[0])
            {
                case "codex-package":
                    if (args.Length != 1 && (args.Length != 2 || args[1] != "--digest")) throw new ArgumentException();
                    var package = DesktopPackage.Discover();
                    result = new { ok = true, package = args.Length == 2 ? package.WithDigest() : (object)package };
                    break;
                case "codex-processes":
                    RequireCount(args, 1);
                    bool conflict;
                    var processes = ProcessInspector.CodexProcesses(DesktopPackage.Discover(), out conflict);
                    result = new { ok = true, processes = processes, identityConflict = conflict };
                    break;
                case "process-alive":
                    RequireCount(args, 5);
                    uint pid = UInt(Option(args, 1, "--pid"));
                    long created = Long(Option(args, 3, "--created"));
                    using (var process = ProcessInspector.Open(pid))
                        result = new { ok = true, alive = process != null && process.Created == created && process.Alive };
                    break;
                case "process-info":
                    result = ProcessInspector.Info(Input(args));
                    break;
                case "network-environment":
                    RequireCount(args, 1);
                    result = ProcessInspector.NetworkEnvironment();
                    break;
                case "path-in-use":
                    RequireCount(args, 3);
                    result = new { ok = true, status = ProcessInspector.PathUse(ShellActions.LocalPath(Option(args, 1, "--path"))) };
                    break;
                case "port-listeners":
                    RequireCount(args, 3);
                    uint port = UInt(Option(args, 1, "--port"));
                    if (port < 1 || port > 65535) throw new ArgumentException();
                    result = new { ok = true, listeners = ProcessInspector.Listeners((int)port) };
                    break;
                case "graceful-close":
                    if (args.Length != 5 && args.Length != 7) throw new ArgumentException();
                    result = RestartManager.Close(UInt(Option(args, 1, "--pid")), Long(Option(args, 3, "--created")),
                        args.Length == 7 ? checked((int)UInt(Option(args, 5, "--timeout-ms"))) : 30000);
                    break;
                case "shell-action":
                    result = ShellActions.Run(Input(args));
                    break;
                case "shortcut-inspect":
                    RequireCount(args, 3);
                    result = new { ok = true, shortcut = ShortcutManager.Inspect(Option(args, 1, "--path")) };
                    break;
                case "shortcut-install":
                    result = new { ok = true, shortcut = ShortcutManager.Install(Input(args)) };
                    break;
                case "system-theme":
                    RequireCount(args, 1);
                    result = new { ok = true, dark = Object.Equals(Microsoft.Win32.Registry.GetValue(
                        @"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize",
                        "AppsUseLightTheme", 1), 0) };
                    break;
                case "settings-lock":
                    RequireCount(args, 3);
                    using (SettingsLock.Acquire(Option(args, 1, "--path")))
                    {
                        Console.WriteLine("{\"ok\":true}");
                        Console.Out.Flush();
                        Console.In.Read(); // The Node writer closes stdin after its atomic transaction.
                    }
                    return 0;
                default: throw new ArgumentException();
            }
        }
        catch (Exception error)
        {
            var native = error as Win32Exception;
            result = new { ok = false, status = error is ArgumentException ? "invalid-arguments" : "unavailable",
                errorType = error.GetType().Name, code = native != null ? native.NativeErrorCode : error.HResult };
            exit = 1;
        }
        Console.WriteLine(Json.Serialize(result));
        return exit;
    }

    private static Dictionary<string, object> Input(string[] args)
    {
        RequireCount(args, 2);
        if (args[1] != "--input-stdin") throw new ArgumentException();
        var text = new char[196609];
        int length = Console.In.ReadBlock(text, 0, text.Length);
        if (length == text.Length) throw new ArgumentException();
        var value = Json.Deserialize<Dictionary<string, object>>(new string(text, 0, length));
        if (value == null) throw new ArgumentException();
        return value;
    }

    private static void RequireCount(string[] args, int count)
    {
        if (args.Length != count) throw new ArgumentException();
    }

    private static string Option(string[] args, int index, string name)
    {
        if (args[index] != name) throw new ArgumentException();
        return args[index + 1];
    }

    internal static string Text(IDictionary<string, object> values, string key, bool optional = false)
    {
        object value;
        if ((!values.TryGetValue(key, out value) || value == null) && optional) return "";
        var text = value as string;
        if (text == null || text.IndexOf('\0') != -1) throw new ArgumentException();
        return text;
    }

    internal static uint UInt(string value)
    {
        uint parsed;
        if (!uint.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out parsed)) throw new ArgumentException();
        return parsed;
    }

    internal static long Long(string value)
    {
        long parsed;
        if (!long.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out parsed)) throw new ArgumentException();
        return parsed;
    }
}
