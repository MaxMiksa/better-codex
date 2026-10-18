using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

public static class BetterCodexI18n {
    [DllImport("kernel32.dll")] private static extern ushort GetUserDefaultUILanguage();
    public static string Normalize(string value) {
        return Regex.IsMatch((value ?? "").Trim().Replace('_', '-'), @"^zh($|-(cn|sg|hans)(-|$))", RegexOptions.IgnoreCase) ? "zh-CN" : "en";
    }

    public static string Language() {
        string value = Environment.GetEnvironmentVariable("BETTER_CODEX_LANGUAGE");
        if (!String.IsNullOrEmpty(value) && !String.Equals(value, "auto", StringComparison.OrdinalIgnoreCase)) return Normalize(value);
        return Normalize(CultureInfo.GetCultureInfo((int)GetUserDefaultUILanguage()).Name);
    }

    public static string Text(string root, string key) {
        try {
            string source = File.ReadAllText(Path.Combine(root, "tools", "token-hud-local", "shared", "messages.json"));
            var messages = new JavaScriptSerializer().Deserialize<Dictionary<string, Dictionary<string, string>>>(source);
            string message;
            if (messages != null && (messages[Language()].TryGetValue(key, out message) || messages["en"].TryGetValue(key, out message))) return message;
        } catch (IOException) { } catch (UnauthorizedAccessException) { } catch (ArgumentException) { } catch (KeyNotFoundException) { } catch (InvalidOperationException) { }
        // A damaged package must still explain recovery and allow Codex activation.
        return "Better Codex: extract the complete portable ZIP and try again.";
    }

    public static string OutputMessage(string output) {
        try {
            var receipt = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(output.Trim());
            object message;
            return receipt != null && receipt.TryGetValue("message", out message) ? Convert.ToString(message) : "";
        } catch (ArgumentException) { return ""; } catch (InvalidOperationException) { return ""; }
    }
}
