export type DrawingAppearance = 'paper' | 'blueprint';
export interface DrawingPalette {
  background: string;
  foreground: string;
  muted: string;
  hidden: string;
  center: string;
  selected: string;
}
export function drawingPalette(appearance: DrawingAppearance = 'paper'): DrawingPalette {
  return appearance === 'blueprint'
    ? {
        background: '#082c49',
        foreground: '#f4fbff',
        muted: '#a8c4d5',
        hidden: '#789bb3',
        center: '#91c7df',
        selected: '#6ee7ff',
      }
    : {
        background: '#ffffff',
        foreground: '#20262b',
        muted: '#69737b',
        hidden: '#7d858a',
        center: '#667983',
        selected: '#16745e',
      };
}

/** Repaint SVG attributes only; user text and document metadata are never rewritten. */
export function applyDrawingAppearance(
  svg: string,
  appearance: DrawingAppearance = 'paper',
): string {
  if (appearance === 'paper') return svg;
  const palette = drawingPalette(appearance);
  const colors: Record<string, string> = {
    white: palette.background,
    '#fff': palette.background,
    '#ffffff': palette.background,
    '#20262b': palette.foreground,
    '#16745e': palette.selected,
    '#69737b': palette.muted,
    '#667079': palette.muted,
    '#7a838a': palette.muted,
    '#7d858a': palette.hidden,
    '#667983': palette.center,
    '#a0b2ad': palette.muted,
    '#879e96': palette.muted,
  };
  return svg.replace(/<[^>]+>/g, (tag) =>
    tag
      .replace(/\b(fill|stroke)="([^"]+)"/g, (attribute, name: string, value: string) =>
        colors[value.toLowerCase()] ? `${name}="${colors[value.toLowerCase()]}"` : attribute,
      )
      .replace(
        /\bstyle="([^"]*)"/g,
        (_attribute, style: string) =>
          `style="${style.replace(
            /\b(background|color):\s*(white|#[a-fA-F0-9]{3,6})(?=;|$)/g,
            (declaration, property: string, color: string) =>
              colors[color.toLowerCase()]
                ? `${property}:${colors[color.toLowerCase()]}`
                : declaration,
          )}"`,
      ),
  );
}
