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

}
