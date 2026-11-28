// Presentation only: no Codex configuration, chat content or model traffic changes.

interface ThemeSpec {
  accentSource?: string;
  accent?: string;
  surface?: string;
}

type ThemeMap = Partial<Record<'light' | 'dark', ThemeSpec>>;

interface PaletteSummary {
  accent: string;
  bubble: string;
  bubbleText: string;
  buttonText: string;
  bubbleContrast: number;
  buttonContrast: number;
}

const HEX_COLOR = /^#[a-f\d]{6}$/i;
const TRACKED_VARS = [
  '--codex-base-accent',
  '--color-background-user-message',
  '--color-text-user-message',
  '--color-background-composer-primary',
  '--color-text-composer-primary',
] as const;

function isHexColor(value: string | undefined): value is string {
  return HEX_COLOR.test(value ?? '');
}

function hexToRgb(color: string): [number, number, number] {
  const parts = color.match(/[a-f\d]{2}/gi) ?? ['00', '00', '00'];
  return [parseInt(parts[0], 16), parseInt(parts[1], 16), parseInt(parts[2], 16)];
}

function rgbToHex(channels: number[]): string {
  return '#' + channels.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

function relativeLuminance(color: string): number {
  const weights = [0.2126, 0.7152, 0.0722];
  return hexToRgb(color)
    .map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    })
    .reduce((sum, val, idx) => sum + val * weights[idx], 0);
}

function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function readableForeground(background: string): '#ffffff' | '#000000' {
  return contrastRatio(background, '#ffffff') >= contrastRatio(background, '#000000')
    ? '#ffffff'
    : '#000000';
}

function mixColors(a: string, b: string, weight: number): string {
  const rgbB = hexToRgb(b);
  return rgbToHex(hexToRgb(a).map((val, idx) => val * weight + rgbB[idx] * (1 - weight)));
}

function installCustomAccent(): boolean {
  if (window.__codexCustomAccent) return false;

  let themes: ThemeMap = {};
  let removed = false;
  let queued = false;

  const style = document.createElement('style');
  style.id = 'codex-hud-custom-accent';

  function readColors(): Record<string, string> {
    const computed = getComputedStyle(document.documentElement);
    return Object.fromEntries(
      TRACKED_VARS.map((key) => [key, computed.getPropertyValue(key).trim()]),
    );
  }

  function readNativeColors(): Record<string, string> {
    const wasDisabled = style.disabled;
    style.disabled = true;
    try {
      return readColors();
    } finally {
      style.disabled = wasDisabled;
    }
  }

  function apply(): Record<string, unknown> {
    if (removed || !document.head) return { applied: false, reason: 'document-unavailable' };

    const variant = document.documentElement.dataset.theme as 'light' | 'dark' | undefined;
    const palettes: Partial<Record<'light' | 'dark', PaletteSummary>> = {};
    const rules: string[] = [];
    const baseAccent = getComputedStyle(document.documentElement)
      .getPropertyValue('--codex-base-accent')
      .trim()
      .toLowerCase();

    for (const mode of ['light', 'dark'] as const) {
      const theme = themes?.[mode];
      if (theme?.accentSource !== 'custom' || !isHexColor(theme.accent) || !isHexColor(theme.surface)) {
        continue;
      }
      if (mode === variant && baseAccent !== theme.accent.toLowerCase()) continue;

      const accent = theme.accent.toLowerCase();
      const bubble = mixColors(accent, theme.surface, mode === 'dark' ? 0.52 : 0.14);
      const bubbleText = readableForeground(bubble);
      const buttonText = readableForeground(accent);

      palettes[mode] = {
        accent,
        bubble,
        bubbleText,
        buttonText,
        bubbleContrast: contrastRatio(bubble, bubbleText),
        buttonContrast: contrastRatio(accent, buttonText),
      };

      rules.push(
        `:root[data-theme="${mode}"]:not([data-codex-window-type="extension"]) {\n` +
          `  --color-background-user-message: ${bubble};\n` +
          `  --color-text-user-message: ${bubbleText};\n` +
          `  --color-background-composer-primary: ${accent};\n` +
          `  --color-text-composer-primary: ${buttonText};\n` +
          `}`,
      );
    }

    const css = rules.join('\n');
    if (style.textContent !== css) style.textContent = css;
    if (css && !style.isConnected) document.head.append(style);
    if (!css && style.isConnected) style.remove();

    return { applied: Boolean(variant && palettes[variant]), variant, palettes };
  }

  const observer = new MutationObserver(() => {
    if (queued || removed) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      apply();
    });
  });

  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  if (document.head) {
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
  }

  window.__codexCustomAccent = {
    update(value) {
      themes = value;
      return apply();
    },
    snapshot() {
      return { ...apply(), native: readNativeColors(), current: readColors() };
    },
    remove() {
      removed = true;
      observer.disconnect();
      style.remove();
      delete window.__codexCustomAccent;
    },
  };

  return true;
}

export default installCustomAccent;
