using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace BetterCodex {
    public class RecoveryBody : Label {
        protected override void OnPaint(PaintEventArgs e) {
            int top = 0;
            foreach (string line in Text.Split('\n')) {
                TextRenderer.DrawText(e.Graphics, line, Font, new Rectangle(0, top, Width, Height - top),
                    ForeColor, TextFormatFlags.NoPrefix | TextFormatFlags.SingleLine);
                top += (int)(26 * DeviceDpi / 96f);
            }
        }
    }

    public class RecoveryButton : Button {
        public bool Primary { get; set; }
        public bool CloseGlyph { get; set; }
        public bool Dark { get; set; }
        public bool GrayscaleText { get; set; }
        public float DpiScaleOverride { get; set; }
        private bool hovered, pressed;

        public RecoveryButton() {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint |
                ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            Cursor = Cursors.Hand;
            UseVisualStyleBackColor = false;
        }

        internal static GraphicsPath Rounded(RectangleF bounds, float radius) {
            float diameter = radius * 2;
            GraphicsPath path = new GraphicsPath();
            path.AddArc(bounds.X, bounds.Y, diameter, diameter, 180, 90);
            path.AddArc(bounds.Right - diameter, bounds.Y, diameter, diameter, 270, 90);
            path.AddArc(bounds.Right - diameter, bounds.Bottom - diameter, diameter, diameter, 0, 90);
            path.AddArc(bounds.X, bounds.Bottom - diameter, diameter, diameter, 90, 90);
            path.CloseFigure();
            return path;
        }

        protected override void OnMouseEnter(EventArgs e) { hovered = true; Invalidate(); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { hovered = pressed = false; Invalidate(); base.OnMouseLeave(e); }
        protected override void OnMouseDown(MouseEventArgs e) { pressed = true; Invalidate(); base.OnMouseDown(e); }
        protected override void OnMouseUp(MouseEventArgs e) { pressed = false; Invalidate(); base.OnMouseUp(e); }
        protected override void OnGotFocus(EventArgs e) { Invalidate(); base.OnGotFocus(e); }
        protected override void OnLostFocus(EventArgs e) { Invalidate(); base.OnLostFocus(e); }

        protected override void OnPaint(PaintEventArgs e) {
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(Parent.BackColor);
            float scale = DpiScaleOverride > 0 ? DpiScaleOverride : DeviceDpi / 96f;
            Color fill = BackColor;
            if (pressed || hovered) {
                int delta = pressed ? 22 : 12;
                bool lighten = Dark != Primary;
                fill = Color.FromArgb(Math.Max(0, Math.Min(255, fill.R + (lighten ? delta : -delta))),
                    Math.Max(0, Math.Min(255, fill.G + (lighten ? delta : -delta))),
                    Math.Max(0, Math.Min(255, fill.B + (lighten ? delta : -delta))));
            }
            using (GraphicsPath path = Rounded(new RectangleF(.5f, .5f, Width - 1, Height - 1), 7 * scale)) {
                using (Brush brush = new SolidBrush(fill)) g.FillPath(brush, path);
                if (!CloseGlyph && !Primary) {
                    using (Pen pen = new Pen(Dark ? Color.FromArgb(105, 105, 105) : Color.FromArgb(184, 184, 184)))
                        g.DrawPath(pen, path);
                }
            }
            if (CloseGlyph) {
                float centerX = Width / 2f, centerY = Height / 2f, arm = 5 * scale;
                using (Pen pen = new Pen(ForeColor, 1.5f * scale)) {
                    g.DrawLine(pen, centerX - arm, centerY - arm, centerX + arm, centerY + arm);
                    g.DrawLine(pen, centerX + arm, centerY - arm, centerX - arm, centerY + arm);
                }
            } else {
                if (GrayscaleText) {
                    g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
                    using (Brush brush = new SolidBrush(ForeColor))
                    using (StringFormat format = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center })
                        g.DrawString(Text, Font, brush, ClientRectangle, format);
                } else {
                    TextRenderer.DrawText(g, Text, Font, ClientRectangle, ForeColor,
                        TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine);
                }
            }
            if (Focused && ShowFocusCues) {
                Rectangle focus = ClientRectangle;
                focus.Inflate(-4, -4);
                ControlPaint.DrawFocusRectangle(g, focus, ForeColor, fill);
            }
        }
    }

    public class RecoveryDialog : Form {
        public Label Heading { get; private set; }
        public Label Description { get; private set; }
        public Label Remaining { get; private set; }
        public RecoveryButton Cancel { get; private set; }
        public RecoveryButton RestartNow { get; private set; }
        public RecoveryButton CloseAction { get; private set; }
        private Color outline;

        [DllImport("user32.dll")] private static extern bool ReleaseCapture();
        [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr hwnd, int message, IntPtr wparam, IntPtr lparam);

        public RecoveryDialog(string title, string description, string cancel, string restart, string close, string fontFamily) {
            AutoScaleDimensions = new SizeF(96, 96);
            AutoScaleMode = AutoScaleMode.Dpi;
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(480, 240);
            TopMost = true;
            Text = title;
            Font = new Font(fontFamily, 16, FontStyle.Regular, GraphicsUnit.Pixel);
            SetStyle(ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            Heading = MakeLabel(title, new Rectangle(28, 24, 386, 32));
            Heading.Font = new Font(fontFamily, 20, FontStyle.Bold, GraphicsUnit.Pixel);
            Description = new RecoveryBody { Text = description, Bounds = new Rectangle(28, 76, 424, 66) };
            Controls.Add(Description);
            Remaining = MakeLabel("", new Rectangle(28, 172, 184, 40));
            Remaining.TextAlign = ContentAlignment.MiddleLeft;
            Cancel = MakeButton(cancel, new Rectangle(222, 172, 118, 40));
            Cancel.DialogResult = DialogResult.Cancel;
            Cancel.TabIndex = 0;
            RestartNow = MakeButton(restart, new Rectangle(350, 172, 102, 40));
            RestartNow.Primary = true;
            RestartNow.TabIndex = 1;
            CloseAction = MakeButton("", new Rectangle(430, 16, 32, 32));
            CloseAction.CloseGlyph = true;
            CloseAction.AccessibleName = close;
            CloseAction.DialogResult = DialogResult.Cancel;
            CloseAction.TabIndex = 2;
            CancelButton = Cancel;
            AcceptButton = Cancel;
            Heading.MouseDown += DragTitle;
            MouseDown += DragTitle;
            ApplyAppearance(false, "#ffffff");
        }

        private Label MakeLabel(string text, Rectangle bounds) {
            Label label = new Label { Text = text, Bounds = bounds, UseCompatibleTextRendering = false };
            Controls.Add(label);
            return label;
        }

        private RecoveryButton MakeButton(string text, Rectangle bounds) {
            RecoveryButton button = new RecoveryButton { Text = text, Bounds = bounds, Font = Font };
            Controls.Add(button);
            return button;
        }

        private void DragTitle(object sender, MouseEventArgs e) {
            if (e.Button != MouseButtons.Left) return;
            ReleaseCapture();
            SendMessage(Handle, 0x00A1, new IntPtr(2), IntPtr.Zero);
        }

        public void ApplyAppearance(bool dark, string surface) {
            Color background = ColorTranslator.FromHtml(surface);
            if (dark) background = Color.FromArgb(background.R + (int)((255 - background.R) * .035),
                background.G + (int)((255 - background.G) * .035), background.B + (int)((255 - background.B) * .035));
            BackColor = background;
            Heading.ForeColor = dark ? Color.FromArgb(241, 241, 241) : Color.FromArgb(21, 21, 21);
            Description.ForeColor = dark ? Color.FromArgb(182, 182, 182) : Color.FromArgb(102, 102, 102);
            Remaining.ForeColor = dark ? Color.FromArgb(170, 170, 170) : Color.FromArgb(110, 110, 110);
            outline = dark ? Color.FromArgb(70, 70, 70) : Color.FromArgb(222, 222, 222);
            foreach (RecoveryButton button in new [] { Cancel, RestartNow, CloseAction }) {
                button.Dark = dark;
                button.BackColor = button.Primary ? (dark ? Color.FromArgb(237, 237, 237) : Color.FromArgb(32, 32, 32)) : background;
                button.ForeColor = button.Primary ? (dark ? Color.FromArgb(21, 21, 21) : Color.White) : Heading.ForeColor;
                if (button.CloseGlyph) button.ForeColor = Remaining.ForeColor;
                button.Invalidate();
            }
            Invalidate();
        }

        protected override void OnSizeChanged(EventArgs e) {
            base.OnSizeChanged(e);
            if (Width <= 0 || Height <= 0) return;
            using (GraphicsPath path = RecoveryButton.Rounded(new RectangleF(0, 0, Width, Height), 12 * DeviceDpi / 96f)) {
                Region previous = Region;
                Region = new Region(path);
                if (previous != null) previous.Dispose();
            }
        }

        protected override void OnPaint(PaintEventArgs e) {
            base.OnPaint(e);
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            using (GraphicsPath path = RecoveryButton.Rounded(new RectangleF(.5f, .5f, Width - 1, Height - 1), 12 * DeviceDpi / 96f))
            using (Pen pen = new Pen(outline)) e.Graphics.DrawPath(pen, path);
        }
    }
}
