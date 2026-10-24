using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace BetterCodex {
    public class StartupCheckRowData {
        public string id, label, state, status, detail, summary, suggestion;
    }
    public class StartupCheckAppearance {
        public bool dark;
        public string surface;
    }
    public class StartupCheckReport {
        public string state, title, description, checkedAt, packageVersion, note;
        public StartupCheckRowData[] rows;
        public StartupCheckAppearance appearance;
        public StartupRelaunchPlan relaunch;
    }
    public class StartupRelaunchPlan {
        public bool allowed, automatic;
        public string key, reason, packageVersion, packageHash;
        public Dictionary<string, object> target;
    }

    // Lucide circle-check, circle-x, loader-circle and circle-ellipsis geometry.
    // Copyright (c) 2026 Lucide contributors; see diagnostics/LUCIDE-LICENSE.
    public class StartupStatusIcon : Control {
        public string State;
        public float Angle;
        public StartupStatusIcon() { SetStyle(ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint, true); }
        protected override void OnPaint(PaintEventArgs e) {
            base.OnPaint(e);
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            float scale = Math.Min(Width, Height) / 24f;
            g.ScaleTransform(scale, scale);
            using (Pen pen = new Pen(ForeColor, 2)) {
                pen.StartCap = pen.EndCap = LineCap.Round; pen.LineJoin = LineJoin.Round;
                if (State == "checking") {
                    g.TranslateTransform(12, 12); g.RotateTransform(Angle); g.TranslateTransform(-12, -12);
                    g.DrawArc(pen, 3, 3, 18, 18, 0, 288);
                } else {
                    g.DrawEllipse(pen, 2, 2, 20, 20);
                    if (State == "healthy")
                        g.DrawLines(pen, new[] { new PointF(16, 9), new PointF(10.5f, 14.5f), new PointF(8, 12) });
                    else if (State == "failed") {
                        g.DrawLine(pen, 15, 9, 9, 15); g.DrawLine(pen, 9, 9, 15, 15);
                    } else {
                        foreach (int x in new[] { 7, 12, 17 }) g.DrawLine(pen, x, 12, x + .01f, 12);
                    }
                }
            }
        }
    }

    public class StartupTextLabel : Label {
        public bool WrapText;
        protected override void OnPaint(PaintEventArgs e) {
            e.Graphics.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
            using (Brush brush = new SolidBrush(ForeColor))
            using (StringFormat format = new StringFormat()) {
                if (TextAlign == ContentAlignment.TopRight) format.Alignment = StringAlignment.Far;
                if (TextAlign == ContentAlignment.MiddleLeft) format.LineAlignment = StringAlignment.Center;
                if (!WrapText) format.FormatFlags = StringFormatFlags.NoWrap;
                RectangleF bounds = new RectangleF(Padding.Left, Padding.Top,
                    Width - Padding.Horizontal, Height - Padding.Vertical);
                e.Graphics.DrawString(Text, Font, brush, bounds, format);
            }
        }
    }
    public class StartupStatusLabel : StartupTextLabel {
        public Color DotColor;
        public float ScaleFactor = 1;
        protected override void OnPaint(PaintEventArgs e) {
            base.OnPaint(e);
            float scale = ScaleFactor;
            int textWidth = TextRenderer.MeasureText(Text, Font).Width;
            float x = Width - textWidth - 14 * scale;
            if (x >= 0) {
                e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
                using (Brush brush = new SolidBrush(DotColor))
                    e.Graphics.FillEllipse(brush, x, 7 * scale, 8 * scale, 8 * scale);
            }
        }
    }
    public class StartupCheckRow : UserControl {
        public StartupCheckRowData Data;
        private Label name, status, detail, suggestion;
        private Color rule, dot;
        private readonly float scaleFactor;
        public StartupCheckRow(StartupCheckRowData data, string family, bool showSuggestion, float scale) {
            Data = data;
            scaleFactor = scale;
            AutoScaleMode = AutoScaleMode.None;
            SetStyle(ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            name = new StartupTextLabel { Text = data.label, Font = new Font(family, 18 * scale, FontStyle.Bold, GraphicsUnit.Pixel) };
            status = new StartupStatusLabel { Text = data.status, TextAlign = ContentAlignment.TopRight, ScaleFactor = scale,
                Font = new Font(family, 16 * scale, FontStyle.Bold, GraphicsUnit.Pixel) };
            detail = new StartupTextLabel { Text = data.summary ?? data.detail ?? "", Font = new Font(family, 16 * scale, FontStyle.Regular, GraphicsUnit.Pixel) };
            if (data.id == "permissions") detail.Text = "";
            suggestion = new StartupTextLabel { Text = showSuggestion ? data.suggestion ?? "" : "", WrapText = true,
                Padding = new Padding((int)(8 * scale), (int)(6 * scale), (int)(8 * scale), (int)(6 * scale)),
                Font = new Font(family, 14 * scale, FontStyle.Regular, GraphicsUnit.Pixel) };
            Controls.AddRange(new Control[] { name, status, detail, suggestion });
            AccessibleName = data.label + ": " + data.status + ". " + data.detail + ". " + data.suggestion;
        }
        public void Arrange(int width, bool compact) {
            float s = scaleFactor;
            Width = width;
            int statusWidth = Math.Max((int)(160 * s), TextRenderer.MeasureText(status.Text, status.Font).Width + (int)(24 * s));
            int top = (int)((compact ? 10 : 15) * s), line = (int)((compact ? 26 : 28) * s);
            name.Bounds = new Rectangle(0, top, width - statusWidth - (int)(10 * s), line);
            status.Bounds = new Rectangle(width - statusWidth, top, statusWidth, line);
            detail.Text = detail.Text.Replace("\r", "").Replace("\n", " · ");
            int detailHeight = String.IsNullOrEmpty(detail.Text) ? 0 : (int)((compact ? 22 : 24) * s);
            detail.Bounds = new Rectangle(0, top + line, width, detailHeight + (int)(2 * s));
            int next = detail.Bottom + (int)((compact ? 4 : 8) * s);
            suggestion.Visible = !String.IsNullOrEmpty(suggestion.Text);
            if (suggestion.Visible) {
                int height = TextRenderer.MeasureText(suggestion.Text, suggestion.Font,
                    new Size(width - (int)(16 * s), 1000), TextFormatFlags.WordBreak | TextFormatFlags.NoPrefix).Height + (int)(16 * s);
                suggestion.Bounds = new Rectangle(0, next, width, height);
                next = suggestion.Bottom + (int)(8 * s);
            }
            Height = Math.Max((int)((compact ? 56 : 64) * s), next + (int)(4 * s));
        }
        public void ApplyAppearance(bool dark, Color background) {
            BackColor = background;
            name.ForeColor = dark ? Color.FromArgb(241, 241, 241) : Color.FromArgb(21, 21, 21);
            detail.ForeColor = dark ? Color.FromArgb(182, 182, 182) : Color.FromArgb(102, 102, 102);
            rule = dark ? Color.FromArgb(56, 56, 56) : Color.FromArgb(225, 225, 225);
            dot = Data.state == "pass" ? (dark ? Color.FromArgb(111, 218, 130) : Color.FromArgb(30, 120, 49)) :
                Data.state == "fail" ? (dark ? Color.FromArgb(248, 107, 100) : Color.FromArgb(180, 36, 38)) :
                Data.state == "warning" || Data.state == "pending" ? (dark ? Color.FromArgb(224, 185, 92) : Color.FromArgb(147, 106, 19)) :
                detail.ForeColor;
            status.ForeColor = dot;
            ((StartupStatusLabel)status).DotColor = dot;
            suggestion.BackColor = dark ? Color.FromArgb(49, 30, 30) : Color.FromArgb(255, 241, 241);
            suggestion.ForeColor = dark ? Color.FromArgb(248, 147, 135) : Color.FromArgb(153, 46, 39);
            Invalidate();
        }
        protected override void OnPaint(PaintEventArgs e) {
            base.OnPaint(e);
            using (Pen pen = new Pen(rule)) e.Graphics.DrawLine(pen, 0, 0, Width, 0);
        }
    }

    public class StartupCheckDialog : Form {
        private readonly Dictionary<string, string> words;
        private readonly JavaScriptSerializer json = new JavaScriptSerializer();
        private readonly string settings, workerScript, family, language, preview, forcedTheme;
        private readonly EventWaitHandle refreshEvent, updateEvent;
        private readonly List<StartupCheckRow> rows = new List<StartupCheckRow>();
        private readonly System.Windows.Forms.Timer timer;
        private readonly Label caption, heading, description, note;
        private readonly StartupStatusIcon stateIcon;
        private readonly Panel body;
        public RecoveryButton CopyReport { get; private set; }
        public RecoveryButton Recheck { get; private set; }
        public RecoveryButton RelaunchAction { get; private set; }
        private readonly RecoveryButton closeGlyph;
        private StartupCheckReport current;
        private Process worker;
        private string sessionDirectory, outputPath;
        private DateTime started, copiedUntil, lastWrite, nextThemeRead;
        private bool queued, dark, finishing;
        private int fontDpi;
        private string python, configPath;
        private string appearanceStamp;
        private bool appearanceReading;
        private bool afterUpdate, planConsidered, reloading, previewRestarted;
        private string suppressedVersion;
        private int countdown;
        private double countdownElapsed;
        private long countdownTick;
        private Process actionProcess;
        private string actionDirectory, actionOutput, actionNote;
        private DateTime actionStarted;

        protected override bool ShowWithoutActivation { get { return true; } }
        private string T(string key) { string value; return words.TryGetValue("check." + key, out value) ? value : key; }
        private static string Quote(string value) { return "\"" + value.Replace("\"", "\\\"") + "\""; }

        public StartupCheckDialog(string settingsPath, string script, string messages, string locale,
                string previewState, string theme, EventWaitHandle refresh, EventWaitHandle update, bool updated) {
            words = json.Deserialize<Dictionary<string, string>>(messages);
            settings = settingsPath; workerScript = script; language = locale;
            preview = previewState; forcedTheme = theme; refreshEvent = refresh;
            updateEvent = update; afterUpdate = updated;
            family = locale == "zh-CN" ? "Microsoft YaHei UI" : "Segoe UI";
            AutoScaleDimensions = new SizeF(96, 96);
            AutoScaleMode = AutoScaleMode.None;
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(560, 650);
            Text = T("title");
            Font = new Font(family, 16, FontStyle.Regular, GraphicsUnit.Pixel);
            SetStyle(ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            caption = LabelAt(T("title"), new Rectangle(28, 19, 455, 24), 16, false);
            heading = LabelAt("", new Rectangle(68, 61, 464, 44), 32, true);
            stateIcon = new StartupStatusIcon { Bounds = new Rectangle(28, 64, 28, 28) };
            Controls.Add(stateIcon);
            description = LabelAt("", new Rectangle(28, 105, 504, 45), 15, false);
            description.Visible = false;
            body = new Panel { Bounds = new Rectangle(28, 118, 504, 440), AutoScroll = false };
            Controls.Add(body);
            note = new StartupTextLabel { Font = new Font(family, 14, FontStyle.Regular, GraphicsUnit.Pixel), AutoSize = false };
            CopyReport = ButtonAt(T("copy"), new Rectangle(28, ClientSize.Height - 66, 104, 40));
            Recheck = ButtonAt(T("recheck"), new Rectangle(316, ClientSize.Height - 66, 104, 40));
            RelaunchAction = ButtonAt(T("reload"), new Rectangle(428, ClientSize.Height - 66, 104, 40));
            RelaunchAction.Primary = true;
            closeGlyph = ButtonAt("", new Rectangle(514, 14, 32, 32));
            closeGlyph.CloseGlyph = true; closeGlyph.AccessibleName = T("close");
            CopyReport.TabIndex = 0; Recheck.TabIndex = 1; RelaunchAction.TabIndex = 2; closeGlyph.TabIndex = 3;
            closeGlyph.DialogResult = DialogResult.Cancel;
            CancelButton = closeGlyph;
            CopyReport.Click += delegate { CopyCurrentReport(); };
            Recheck.Click += delegate { StartCheck(); };
            RelaunchAction.Click += delegate { StartRelaunch(); };
            closeGlyph.Click += delegate { Close(); };
            caption.MouseDown += Drag; MouseDown += Drag;
            timer = new System.Windows.Forms.Timer { Interval = 200 };
            timer.Tick += Tick;
            UpdateAppearance();
            Shown += delegate { StartCheck(); timer.Start(); };
            FormClosing += delegate { CancelCountdown(true); };
            FormClosed += delegate {
                finishing = true; timer.Stop(); timer.Dispose(); StopOwnWorker();
                if (actionProcess != null) actionProcess.Dispose(); // A started relaunch finishes independently.
                foreach (StartupCheckRow item in rows) item.Dispose();
            };
        }
        private Label LabelAt(string text, Rectangle bounds, float size, bool bold) {
            var label = new StartupTextLabel { Text = text, Bounds = bounds,
                Font = new Font(family, size, bold ? FontStyle.Bold : FontStyle.Regular, GraphicsUnit.Pixel) };
            Controls.Add(label); return label;
        }
        private RecoveryButton ButtonAt(string text, Rectangle bounds) {
            var button = new RecoveryButton { Text = text, Bounds = bounds, Font = Font, GrayscaleText = true };
            Controls.Add(button); return button;
        }
        private void Drag(object sender, MouseEventArgs e) {
            if (e.Button != MouseButtons.Left) return;
            Native.ReleaseCapture(); Native.SendMessage(Handle, 0xA1, new IntPtr(2), IntPtr.Zero);
        }
        private void StopOwnWorker() {
            if (worker != null) {
                try { if (!worker.HasExited) { worker.Kill(); worker.WaitForExit(1500); } } catch (InvalidOperationException) { }
                catch (System.ComponentModel.Win32Exception) { }
                worker.Dispose(); worker = null;
            }
            if (sessionDirectory != null) {
                // Delete only the known files in this instance's own directory.
                foreach (string name in new[] { "result.json", "result.next" }) {
                    try { File.Delete(Path.Combine(sessionDirectory, name)); } catch (IOException) { }
                    catch (UnauthorizedAccessException) { }
                }
                try { Directory.Delete(sessionDirectory, false); } catch (IOException) { }
                catch (UnauthorizedAccessException) { }
                sessionDirectory = outputPath = null;
            }
        }
        private StartupCheckReport Initial(string state, string detail) {
            var list = new List<StartupCheckRowData>();
            foreach (string id in new[] { "app", "sessions", "sandbox", "network", "enhancements", "permissions" })
                list.Add(new StartupCheckRowData { id = id, label = T(id), state = state,
                    status = T(state == "unknown" ? "unknownStatus" : state), detail = detail ?? "" });
            return new StartupCheckReport { state = state == "pending" ? "checking" : "unknown",
                title = T(state == "pending" ? "checking" : "unknown"),
                description = T(state == "pending" ? "checkingDescription" : "unknownDescription"),
                rows = list.ToArray(), note = T("note"), checkedAt = DateTimeOffset.Now.ToString("o") };
        }
        private StartupCheckReport PreviewReport() {
            var data = Initial("pass", "");
            string[] details = { T("appReady"), T("sessionsReady").Replace("{count}", "5"), T("previewSandbox"),
                T("vpnReady"), T("hudReady"), T("permissionReady") };
            for (int i = 0; i < data.rows.Length; i++) data.rows[i].detail = details[i];
            data.rows[0].summary = T("previewApp");
            data.rows[1].summary = T("previewSessions");
            data.rows[4].summary = T("previewEnhancements");
            data.rows[2].status = T("basicPassed"); data.rows[5].status = T("admin");
            data.state = "healthy"; data.title = T("healthy"); data.description = T("healthyDescription");
            string scenario = previewRestarted ? "Healthy" : preview;
            data.relaunch = new StartupRelaunchPlan { allowed = true, packageVersion = "26.1.1.0", key = "plugins:26.1.1.0" };
            if (scenario == "Enhancements" || scenario == "Updated") {
                data.relaunch.automatic = true; data.relaunch.reason = scenario == "Updated" ? "updated" : "plugins";
                if (scenario == "Updated") {
                    data.state = "partial"; data.title = T("partial");
                    data.rows[0].summary = T("updatedSummary"); data.rows[0].status = T("updatedStatus");
                }
                if (scenario == "Enhancements") {
                    data.state = "partial"; data.title = T("partial");
                    data.rows[4].state = "warning"; data.rows[4].status = T("warning");
                    data.rows[4].summary = data.rows[4].detail = T("hudNoInterface");
                }
            } else if (scenario == "Failed") {
                data.state = "failed"; data.title = T("failed"); data.description = T("networkFailed");
                data.rows[3].state = "fail"; data.rows[3].status = T("fail");
                data.rows[3].detail = T("previewFailure"); data.rows[3].suggestion = T("networkHint");
            } else if (scenario == "Checking") {
                data.state = "checking"; data.title = T("checking"); data.description = T("checkingDescription");
                for (int i = 2; i < 5; i++) { data.rows[i].state = "pending"; data.rows[i].status = T("pending"); data.rows[i].detail = ""; }
            } else if (scenario == "Partial") {
                data.state = "unknown"; data.title = T("unknown"); data.description = T("unknownDescription");
                data.rows[2].state = "unknown"; data.rows[2].status = T("unknownStatus"); data.rows[2].detail = T("sandboxUnconfirmed");
            }
            return data;
        }
        private void StartCheck() {
            if (finishing || reloading) return;
            CancelCountdown(false); planConsidered = false; actionNote = null;
            StopOwnWorker(); queued = false; lastWrite = DateTime.MinValue;
            started = DateTime.UtcNow;
            if (!String.IsNullOrEmpty(preview)) { SetReport(PreviewReport()); return; }
            SetReport(Initial("pending", ""));
            TryStartWorker();
        }
        private void TryStartWorker() {
            try {
                var config = json.Deserialize<Dictionary<string, object>>(File.ReadAllText(settings, Encoding.UTF8));
                python = Convert.ToString(config["python"]);
                string home = config.ContainsKey("codexHome") ? Convert.ToString(config["codexHome"]) :
                    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".codex");
                configPath = Path.Combine(home, "config.toml");
                if (!File.Exists(python) || !File.Exists(workerScript)) throw new FileNotFoundException();
                sessionDirectory = Path.Combine(Path.GetDirectoryName(settings), "runtime", "startup-check", Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(sessionDirectory);
                outputPath = Path.Combine(sessionDirectory, "result.json");
                var start = new ProcessStartInfo(python, "-B -X utf8 " + Quote(workerScript) + " --settings " + Quote(settings) + " --output " + Quote(outputPath) + (afterUpdate ? " --after-update" : "")) {
                    UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true
                };
                start.EnvironmentVariables["BETTER_CODEX_LANGUAGE"] = language;
                worker = Process.Start(start);
                worker.BeginOutputReadLine(); worker.BeginErrorReadLine();
                UpdateAppearance();
            } catch (Exception) {
                StopOwnWorker();
                if ((DateTime.UtcNow - started).TotalSeconds >= 12)
                    SetReport(Initial("unknown", T("workerUnavailable")));
            }
        }
        private void Tick(object sender, EventArgs e) {
            if (updateEvent != null && updateEvent.WaitOne(0)) { afterUpdate = true; queued = true; }
            if (refreshEvent != null && refreshEvent.WaitOne(0)) {
                queued = true;
                if (Recheck.Enabled) StartCheck();
            }
            if (copiedUntil != DateTime.MinValue && DateTime.UtcNow >= copiedUntil) {
                CopyReport.Text = T("copy"); copiedUntil = DateTime.MinValue;
            }
            if (reloading || (current != null && current.state == "checking")) { stateIcon.Angle = (stateIcon.Angle + 24) % 360; stateIcon.Invalidate(); }
            if (countdown > 0 && !reloading) {
                long now = Stopwatch.GetTimestamp();
                countdownElapsed += Math.Min(.25, (now - countdownTick) / (double)Stopwatch.Frequency);
                countdownTick = now;
                if (countdownElapsed >= 1) {
                    countdownElapsed -= 1; countdown--;
                    RelaunchAction.Text = T("reloadCountdown").Replace("{count}", countdown.ToString());
                    if (countdown == 0) StartRelaunch();
                }
            }
            if (reloading) PollRelaunch();
            if (worker != null) {
                try {
                    DateTime stamp = File.GetLastWriteTimeUtc(outputPath);
                    if (stamp != lastWrite && File.Exists(outputPath)) {
                        var data = json.Deserialize<StartupCheckReport>(File.ReadAllText(outputPath, Encoding.UTF8));
                        if (data != null && data.rows != null && data.rows.Length == 6) { SetReport(data); lastWrite = stamp; }
                    }
                    if ((worker.HasExited && current.state == "checking") || (DateTime.UtcNow - started).TotalSeconds > 48) {
                        foreach (StartupCheckRowData item in current.rows)
                            if (item.state == "pending") { item.state = "unknown"; item.status = T("unknownStatus"); item.detail = T("workerTimeout"); }
                        current.state = "unknown"; current.title = T("unknown"); current.description = T("unknownDescription");
                        StopOwnWorker(); SetReport(current);
                    } else if (worker.HasExited) { StopOwnWorker(); }
                } catch (IOException) { } catch (InvalidOperationException) { } catch (ArgumentException) { }
            }
            else if (!reloading && String.IsNullOrEmpty(preview) && current != null && current.state == "checking") TryStartWorker();
            if (queued && Recheck.Enabled) StartCheck();
            if (DateTime.UtcNow >= nextThemeRead) { nextThemeRead = DateTime.UtcNow.AddSeconds(1); UpdateAppearance(); }
        }
        private void CancelCountdown(bool remember) {
            bool armed = countdown > 0;
            countdown = 0; RelaunchAction.Text = T("reload");
            if (!remember || reloading || !String.IsNullOrEmpty(preview) || current == null) return;
            string operation;
            if (armed && current.relaunch != null) operation = " --cancel " + Quote(current.relaunch.key);
            else if (afterUpdate || current.state == "checking") {
                operation = " --cancel-check" + (afterUpdate ? " --after-update" : "");
                if (!String.IsNullOrEmpty(current.packageVersion)) operation += " --version " + Quote(current.packageVersion);
            } else return;
            try {
                if (!File.Exists(python)) {
                    var config = json.Deserialize<Dictionary<string, object>>(File.ReadAllText(settings, Encoding.UTF8));
                    python = Convert.ToString(config["python"]);
                }
                if (!File.Exists(python)) return;
                string script = Path.Combine(Path.GetDirectoryName(workerScript), "relaunch.py");
                var info = new ProcessStartInfo(python, "-B -X utf8 " + Quote(script) + " --settings " + Quote(settings) +
                    operation) { UseShellExecute = false, CreateNoWindow = true };
                using (Process child = Process.Start(info)) { }
            } catch (Exception) { }
        }
        private void StartRelaunch() {
            if (finishing || reloading || current == null || current.relaunch == null || !current.relaunch.allowed) return;
            CancelCountdown(false); suppressedVersion = current.relaunch.packageVersion; afterUpdate = false; StopOwnWorker();
            if (!String.IsNullOrEmpty(preview)) {
                previewRestarted = true; actionNote = T("previewRelaunch"); StartCheck(); return;
            }
            try {
                string runtime = Path.Combine(Path.GetDirectoryName(settings), "runtime");
                string nonce = Guid.NewGuid().ToString("N");
                actionDirectory = Path.Combine(runtime, "startup-check", nonce);
                Directory.CreateDirectory(actionDirectory);
                actionOutput = Path.Combine(actionDirectory, "action.json");
                string request = Path.Combine(runtime, "startup-relaunch-request.json");
                File.WriteAllText(request + ".next", json.Serialize(new {
                    nonce = nonce, createdAt = (DateTime.UtcNow - new DateTime(1970, 1, 1)).TotalSeconds, plan = current.relaunch
                }), new UTF8Encoding(false));
                if (File.Exists(request)) File.Delete(request);
                File.Move(request + ".next", request);
                string launcher = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(workerScript), "..", "Start-ComposerHud.ps1"));
                string shell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
                actionProcess = Process.Start(new ProcessStartInfo(shell,
                    "-NoProfile -NonInteractive -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File " + Quote(launcher) + " -TaskMode Reload") {
                    UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true
                });
                actionProcess.BeginOutputReadLine(); actionProcess.BeginErrorReadLine();
                reloading = true; actionStarted = DateTime.UtcNow;
                actionNote = T("reloading"); SetReport(current);
                heading.Text = T("reloading"); stateIcon.State = "checking";
            } catch (Exception) { FinishRelaunch(false, "relaunchFailed"); }
        }
        private void PollRelaunch() {
            try {
                if (File.Exists(actionOutput)) {
                    var result = json.Deserialize<Dictionary<string, object>>(File.ReadAllText(actionOutput, Encoding.UTF8));
                    FinishRelaunch(Convert.ToBoolean(result["success"]), Convert.ToString(result["reason"]));
                } else if ((actionProcess != null && actionProcess.HasExited && actionProcess.ExitCode != 0) ||
                           (DateTime.UtcNow - actionStarted).TotalSeconds > 90) FinishRelaunch(false, "relaunchFailed");
            } catch (IOException) { } catch (ArgumentException) { }
        }
        private void FinishRelaunch(bool success, string reason) {
            reloading = false; actionNote = T(reason);
            if (actionProcess != null) { actionProcess.Dispose(); actionProcess = null; }
            if (actionDirectory != null && File.Exists(actionOutput)) {
                try { File.Delete(actionOutput); Directory.Delete(actionDirectory, false); } catch (IOException) { }
                catch (UnauthorizedAccessException) { }
            }
            actionDirectory = actionOutput = null;
            if (success) { StartCheck(); return; }
            current.state = "failed"; current.title = T("relaunchFailedTitle"); current.description = actionNote;
            current.rows[0].state = "warning"; current.rows[0].status = T("warning");
            current.rows[0].summary = current.rows[0].detail = actionNote;
            SetReport(current);
        }
        private void SetReport(StartupCheckReport data) {
            current = data;
            heading.Text = reloading ? T("reloading") : data.title; description.Text = data.description;
            stateIcon.State = reloading ? "checking" : data.state;
            Recheck.Enabled = data.state != "checking" && !reloading;
            RelaunchAction.Enabled = Recheck.Enabled && data.relaunch != null && data.relaunch.allowed;
            if (data.state != "checking" && !planConsidered && !reloading) {
                planConsidered = true;
                if (RelaunchAction.Enabled && data.relaunch.automatic && data.relaunch.packageVersion != suppressedVersion) {
                    countdown = 15; countdownElapsed = 0; countdownTick = Stopwatch.GetTimestamp();
                    actionNote = T(data.relaunch.reason == "updated" ? "updatedRestart" : "pluginsRestart");
                }
            }
            RelaunchAction.Text = reloading ? T("reloading") : countdown > 0 ?
                T("reloadCountdown").Replace("{count}", countdown.ToString()) : T("reload");
            body.SuspendLayout();
            body.Controls.Clear();
            foreach (StartupCheckRow old in rows) old.Dispose();
            rows.Clear();
            int top = 0;
            int dpi = (int)Native.GetDpiForWindow(Handle);
            float s = dpi / 96f;
            if (fontDpi != dpi) {
                fontDpi = dpi;
                Font = new Font(family, 16 * s, FontStyle.Regular, GraphicsUnit.Pixel);
                caption.Font = new Font(family, 16 * s, FontStyle.Regular, GraphicsUnit.Pixel);
                heading.Font = new Font(family, 32 * s, FontStyle.Bold, GraphicsUnit.Pixel);
                foreach (RecoveryButton button in new[] { CopyReport, Recheck, RelaunchAction, closeGlyph }) { button.Font = Font; button.DpiScaleOverride = s; }
            }
            int padding = (int)(28 * s);
            int contentWidth = (int)(504 * s);
            foreach (StartupCheckRowData item in data.rows) {
                string single = (item.summary ?? item.detail ?? "").Replace("\r", "").Replace("\n", " · ");
                if (item.id == "permissions") single = "";
                contentWidth = Math.Max(contentWidth, TextRenderer.MeasureText(single, Font).Width + (int)(4 * s));
            }
            int copyWidth = Math.Max((int)(104 * s), TextRenderer.MeasureText(T("copy"), Font).Width + (int)(24 * s));
            int recheckWidth = Math.Max((int)(104 * s), TextRenderer.MeasureText(T("recheck"), Font).Width + (int)(24 * s));
            int reloadWidth = TextRenderer.MeasureText(T("reloadCountdown").Replace("{count}", "15"), Font).Width + (int)(28 * s);
            contentWidth = Math.Max(contentWidth, copyWidth + recheckWidth + reloadWidth + (int)(32 * s));
            int formWidth = Math.Min(contentWidth + 2 * padding, Screen.FromControl(this).WorkingArea.Width - (int)(32 * s));
            int width = formWidth - 2 * padding;
            string suggestionId = null;
            foreach (StartupCheckRowData item in data.rows)
                if (item.state == "fail" && !String.IsNullOrEmpty(item.suggestion)) { suggestionId = item.id; break; }
            if (suggestionId == null)
                foreach (StartupCheckRowData item in data.rows)
                    if (!String.IsNullOrEmpty(item.suggestion)) { suggestionId = item.id; break; }
            foreach (StartupCheckRowData item in data.rows) {
                var view = new StartupCheckRow(item, family, item.id == suggestionId, s);
                body.Controls.Add(view);
                view.Arrange(width, false); view.Location = new Point(0, top);
                top += view.Height; rows.Add(view);
            }
            if ((int)(220 * s) + top > Screen.FromControl(this).WorkingArea.Height - (int)(24 * s)) {
                top = 0;
                foreach (StartupCheckRow view in rows) { view.Arrange(width, true); view.Top = top; top += view.Height; }
            }
            int formHeight = (int)(132 * s) + top + (int)(88 * s);
            ClientSize = new Size(formWidth, formHeight);
            caption.Bounds = new Rectangle(padding, (int)(19 * s), formWidth - 2 * padding - (int)(32 * s), (int)(24 * s));
            heading.Bounds = new Rectangle(padding + (int)(42 * s), (int)(61 * s), width - (int)(42 * s), (int)(46 * s));
            stateIcon.Bounds = new Rectangle(padding, (int)(69 * s), (int)(28 * s), (int)(28 * s));
            closeGlyph.Bounds = new Rectangle(formWidth - (int)(46 * s), (int)(14 * s), (int)(32 * s), (int)(32 * s));
            body.Bounds = new Rectangle(padding, (int)(132 * s), width, top);
            int bottom = formHeight - (int)(66 * s);
            CopyReport.Bounds = new Rectangle(padding, bottom, copyWidth, (int)(40 * s));
            RelaunchAction.Bounds = new Rectangle(formWidth - padding - reloadWidth, bottom, reloadWidth, (int)(40 * s));
            Recheck.Bounds = new Rectangle(RelaunchAction.Left - (int)(8 * s) - recheckWidth, bottom, recheckWidth, (int)(40 * s));
            body.ResumeLayout();
            if (data.appearance != null && String.IsNullOrEmpty(forcedTheme)) ApplyAppearance(data.appearance.dark, data.appearance.surface);
            else ApplyAppearance(dark, dark ? "#111111" : "#ffffff");
        }
        private void UpdateAppearance() {
            bool isDark = false;
            try {
                using (var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"))
                    isDark = key != null && Convert.ToInt32(key.GetValue("AppsUseLightTheme", 1)) == 0;
            } catch (Exception) { }
            if (!String.IsNullOrEmpty(forcedTheme)) isDark = forcedTheme == "dark";
            // Reuse the same TOML reader as recovery, without blocking the UI.
            string stamp = isDark + "|" + (configPath == null ? "" : File.GetLastWriteTimeUtc(configPath).Ticks.ToString());
            if (String.IsNullOrEmpty(forcedTheme) && File.Exists(python) && configPath != null && stamp != appearanceStamp && !appearanceReading) {
                appearanceReading = true; appearanceStamp = stamp;
                System.Threading.Tasks.Task.Factory.StartNew(delegate {
                    StartupCheckAppearance updated = null;
                    try {
                        string script = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(workerScript), "..", "shared", "recovery_appearance.py"));
                        using (var child = Process.Start(new ProcessStartInfo(python, "-B -X utf8 " + Quote(script) + " " + Quote(configPath)) {
                            UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true
                        })) {
                            child.BeginErrorReadLine();
                            var output = child.StandardOutput.ReadToEndAsync();
                            if (child.WaitForExit(3000)) updated = new JavaScriptSerializer().Deserialize<StartupCheckAppearance>(output.Result);
                            else child.Kill();
                        }
                    } catch (Exception) { }
                    if (!IsDisposed && !finishing) {
                        try { BeginInvoke(new Action(delegate {
                            appearanceReading = false;
                            if (updated != null && current != null) { current.appearance = updated; ApplyAppearance(updated.dark, updated.surface); }
                        })); } catch (InvalidOperationException) { }
                    }
                });
            }
            if (String.IsNullOrEmpty(forcedTheme) && current != null && current.appearance != null) {
                ApplyAppearance(current.appearance.dark, current.appearance.surface); return;
            }
            ApplyAppearance(isDark, isDark ? "#111111" : "#ffffff");
        }
        public string ReportText() {
            if (current == null) return T("checking");
            var result = new StringBuilder();
            result.AppendLine(T("reportTitle"));
            result.AppendLine(T("time") + ": " + current.checkedAt);
            if (!String.IsNullOrEmpty(current.packageVersion)) result.AppendLine(T("version") + ": " + current.packageVersion);
            result.AppendLine(current.title); result.AppendLine(current.description);
            if (!String.IsNullOrEmpty(actionNote)) result.AppendLine(actionNote);
            if (countdown > 0) result.AppendLine(RelaunchAction.Text);
            foreach (StartupCheckRowData item in current.rows) {
                result.AppendLine(); result.AppendLine(item.label + ": " + item.status);
                if (!String.IsNullOrEmpty(item.detail)) result.AppendLine(item.detail);
                if (!String.IsNullOrEmpty(item.suggestion)) result.AppendLine(T("suggestion").Replace("{value}", item.suggestion));
            }
            result.AppendLine(); result.AppendLine(current.note);
            return result.ToString();
        }
        private void CopyCurrentReport() {
            try { Clipboard.SetText(ReportText(), TextDataFormat.UnicodeText); CopyReport.Text = T("copied"); }
            catch (System.Runtime.InteropServices.ExternalException) { CopyReport.Text = T("copyFailed"); }
            copiedUntil = DateTime.UtcNow.AddSeconds(2);
        }
        private void ApplyAppearance(bool isDark, string surface) {
            dark = isDark;
            Color background;
            try { background = ColorTranslator.FromHtml(surface); } catch (Exception) { background = dark ? Color.FromArgb(17, 17, 17) : Color.White; }
            if (dark) background = Color.FromArgb(background.R + (int)((255 - background.R) * .035),
                background.G + (int)((255 - background.G) * .035), background.B + (int)((255 - background.B) * .035));
            BackColor = body.BackColor = background;
            caption.ForeColor = heading.ForeColor = dark ? Color.FromArgb(241, 241, 241) : Color.FromArgb(21, 21, 21);
            description.ForeColor = note.ForeColor = dark ? Color.FromArgb(182, 182, 182) : Color.FromArgb(102, 102, 102);
            if (IsHandleCreated) {
                int border = dark ? 0x383838 : 0xdedede, mode = dark ? 1 : 0;
                Native.DwmSetWindowAttribute(Handle, 34, ref border, 4);
                Native.DwmSetWindowAttribute(Handle, 20, ref mode, 4);
            }
            stateIcon.ForeColor = current != null && current.state == "healthy" ?
                (dark ? Color.FromArgb(111, 218, 130) : Color.FromArgb(30, 120, 49)) :
                current != null && current.state == "failed" ?
                (dark ? Color.FromArgb(248, 107, 100) : Color.FromArgb(180, 36, 38)) : heading.ForeColor;
            stateIcon.Invalidate();
            foreach (StartupCheckRow view in rows) view.ApplyAppearance(dark, background);
            foreach (RecoveryButton button in new[] { CopyReport, Recheck, RelaunchAction, closeGlyph }) {
                button.Dark = dark;
                button.BackColor = button.Primary ? (dark ? Color.FromArgb(237, 237, 237) : Color.FromArgb(32, 32, 32)) : background;
                button.ForeColor = button.Primary ? (dark ? Color.FromArgb(21, 21, 21) : Color.White) :
                    !button.Enabled ? description.ForeColor : heading.ForeColor;
                button.Invalidate();
            }
            closeGlyph.ForeColor = description.ForeColor;
            Invalidate();
        }
        protected override void OnHandleCreated(EventArgs e) {
            base.OnHandleCreated(e);
            int corner = 2;
            Native.DwmSetWindowAttribute(Handle, 33, ref corner, 4);
        }
        protected override void OnLoad(EventArgs e) {
            SetReport(Initial("pending", ""));
            base.OnLoad(e);
        }
        protected override void WndProc(ref Message message) {
            base.WndProc(ref message);
            if (message.Msg == 0x02E0 && current != null)
                BeginInvoke(new Action(delegate { if (!IsDisposed) SetReport(current); }));
        }
        public static void EnableDpiAwareness() {
            try {
                Native.SetProcessDpiAwarenessContext(new IntPtr(-4));
                Native.SetThreadDpiAwarenessContext(new IntPtr(-4));
            } catch (EntryPointNotFoundException) { }
        }
        public static void Run(string settings, string script, string messages, string locale, string preview, string theme, bool afterUpdate) {
            string name;
            using (var hash = SHA256.Create()) name = BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(
                Path.GetFullPath(settings).ToLowerInvariant()))).Replace("-", "").Substring(0, 16);
            name = @"Local\BetterCodexStartupCheck-" + WindowsIdentity.GetCurrent().User.Value + "-" + name;
            using (var mutex = new Mutex(false, name)) {
                bool held = false;
                try {
                    try { held = mutex.WaitOne(0); } catch (AbandonedMutexException) { held = true; }
                    if (!held) {
                        if (afterUpdate) {
                            try { using (var existing = EventWaitHandle.OpenExisting(name + "-update")) existing.Set(); }
                            catch (WaitHandleCannotBeOpenedException) { }
                        }
                        try { using (var existing = EventWaitHandle.OpenExisting(name + "-refresh")) existing.Set(); }
                        catch (WaitHandleCannotBeOpenedException) { }
                        return;
                    }
                    using (var refresh = new EventWaitHandle(false, EventResetMode.AutoReset, name + "-refresh"))
                    using (var update = new EventWaitHandle(false, EventResetMode.AutoReset, name + "-update"))
                    using (var form = new StartupCheckDialog(settings, script, messages, locale, preview, theme, refresh, update, afterUpdate))
                        Application.Run(form);
                } finally { if (held) mutex.ReleaseMutex(); }
            }
        }
        private static class Native {
            [System.Runtime.InteropServices.DllImport("user32.dll")] internal static extern bool ReleaseCapture();
            [System.Runtime.InteropServices.DllImport("user32.dll")] internal static extern IntPtr SendMessage(IntPtr hwnd, int msg, IntPtr wparam, IntPtr lparam);
            [System.Runtime.InteropServices.DllImport("user32.dll")] internal static extern bool SetProcessDpiAwarenessContext(IntPtr context);
            [System.Runtime.InteropServices.DllImport("user32.dll")] internal static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
            [System.Runtime.InteropServices.DllImport("user32.dll")] internal static extern uint GetDpiForWindow(IntPtr hwnd);
            [System.Runtime.InteropServices.DllImport("dwmapi.dll")] internal static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);
        }
    }
}
