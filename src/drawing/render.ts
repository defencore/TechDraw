import type {
  Bounds2,
  Dimension,
  DrawingSettings,
  Part,
  Point2,
  Projection,
  ViewId,
} from '../model';
import { autoDimensionWarnings, formatDimension } from './dimensions';

export interface ViewTransform {
  x: number;
  y: number;
  scale: number;
}
export interface RenderedDrawing {
  svg: string;
  width: number;
  height: number;
  scale: number;
  viewTransforms: Record<ViewId, ViewTransform>;
  warnings: string[];
}

export const escapeXml = (value: unknown): string =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[ch]!,
  );
const n = (value: number) => Number(value.toFixed(5));
const f = (point: Point2) => `${n(point[0])},${n(point[1])}`;
const text = (x: number, y: number, value: unknown, size = 3, attrs = '') =>
  `<text x="${n(x)}" y="${n(y)}" font-size="${size}" stroke="none" ${attrs}>${escapeXml(value)}</text>`;
const line = (a: Point2, b: Point2, attrs = '') =>
  `<line x1="${n(a[0])}" y1="${n(a[1])}" x2="${n(b[0])}" y2="${n(b[1])}" ${attrs}/>`;
const sheetPoint = (p: Point2, t: ViewTransform): Point2 => [
  t.x + p[0] * t.scale,
  t.y - p[1] * t.scale,
];
const scaleLabel = (scale: number): string => (scale >= 1 ? `${n(scale)}:1` : `1:${n(1 / scale)}`);

export function paperSize(
  settings: Pick<DrawingSettings, 'format' | 'orientation'>,
): [number, number] {
  const formats = { A4: [210, 297], A3: [297, 420], A2: [420, 594], A1: [594, 841] } as const;
  const [short, long] = formats[settings.format];
  return settings.orientation === 'landscape' ? [long, short] : [short, long];
}

function dimensionMarkup(
  d: Dimension,
  t: ViewTransform,
  precision: number,
  selected: boolean,
): string {
  const a = sheetPoint(d.a, t),
    b = sheetPoint(d.b, t);
  const color = selected ? '#16745e' : '#20262b';
  const label = escapeXml(formatDimension(d, precision));
  const labelHalf = textWidth(formatDimension(d, precision), 3.2) / 2 + 0.5;
  const tx = d.textOffset?.[0] ?? 0,
    ty = d.textOffset?.[1] ?? 0;
  let content = '';
  // Explicit filled triangles and label backgrounds render identically in SVG and PDF.
  const arrow = (tip: Point2, towardBase: Point2) => {
    const length = Math.hypot(towardBase[0], towardBase[1]) || 1;
    const ux = towardBase[0] / length,
      uy = towardBase[1] / length;
    const base: Point2 = [tip[0] + ux * 2.7, tip[1] + uy * 2.7];
    const left: Point2 = [base[0] - uy * 0.85, base[1] + ux * 0.85];
    const right: Point2 = [base[0] + uy * 0.85, base[1] - ux * 0.85];
    return `<path class="dimension-arrow" d="M${f(tip)} L${f(left)} L${f(right)} Z" fill="${color}" stroke="none"/>`;
  };
  const dimensionLine = (p: Point2, q: Point2) =>
    line(p, q) + arrow(p, [q[0] - p[0], q[1] - p[1]]) + arrow(q, [p[0] - q[0], p[1] - q[1]]);
  const labelAt = (p: Point2, angle = 0, includeOffset = true) => {
    const x = p[0] + (includeOffset ? tx : 0),
      y = p[1] + (includeOffset ? ty : 0);
    return `<g class="dimension-label"${angle ? ` transform="rotate(${angle} ${n(x)} ${n(y)})"` : ''}><rect x="${n(x - labelHalf)}" y="${n(y - 3.5)}" width="${n(labelHalf * 2)}" height="4.5" fill="white" stroke="none"/><text x="${n(x)}" y="${n(y)}" fill="${color}" stroke="none" text-anchor="middle" font-size="3.2">${label}</text></g>`;
  };
  if (d.kind === 'horizontal') {
    const y = Math.max(a[1], b[1]) + d.offset;
    const left = Math.min(a[0], b[0]),
      right = Math.max(a[0], b[0]);
    const short = right - left < labelHalf * 2 + 5;
    content =
      line([a[0], a[1] + 1], [a[0], y + 2]) +
      line([b[0], b[1] + 1], [b[0], y + 2]) +
      (short
        ? line([left, y], [right, y]) +
          line([left - 4, y], [left, y]) +
          arrow([left, y], [-1, 0]) +
          line([right + 4, y], [right, y]) +
          arrow([right, y], [1, 0])
        : dimensionLine([a[0], y], [b[0], y])) +
      labelAt([short ? right + 5 + labelHalf : (a[0] + b[0]) / 2, y - 1.2]);
  } else if (d.kind === 'vertical') {
    const x = Math.min(a[0], b[0]) - d.offset;
    const top = Math.min(a[1], b[1]),
      bottom = Math.max(a[1], b[1]);
    const short = bottom - top < labelHalf * 2 + 5;
    content =
      line([a[0] - 1, a[1]], [x - 2, a[1]]) +
      line([b[0] - 1, b[1]], [x - 2, b[1]]) +
      (short
        ? line([x, top], [x, bottom]) +
          line([x, top - 4], [x, top]) +
          arrow([x, top], [0, -1]) +
          line([x, bottom + 4], [x, bottom]) +
          arrow([x, bottom], [0, 1])
        : dimensionLine([x, a[1]], [x, b[1]])) +
      labelAt([x - 1.2, short ? top - 5 - labelHalf : (a[1] + b[1]) / 2], -90);
  } else if (d.kind === 'aligned') {
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      length = Math.hypot(dx, dy) || 1;
    const normal: Point2 = [-dy / length, dx / length];
    const p: Point2 = [a[0] + normal[0] * d.offset, a[1] + normal[1] * d.offset];
    const q: Point2 = [b[0] + normal[0] * d.offset, b[1] + normal[1] * d.offset];
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    content =
      line(a, p) +
      line(b, q) +
      dimensionLine(p, q) +
      labelAt(
        [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2 - 1.3],
        angle > 90 || angle < -90 ? angle + 180 : angle,
      );
  } else if (d.kind === 'diameter' || d.kind === 'radius') {
    const radius = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const side = d.offset < 0 ? -1 : 1;
    const point: Point2 =
      d.kind === 'radius' ? b : [a[0] + side * radius * 0.7071, a[1] - radius * 0.7071];
    const elbow: Point2 = [point[0] + d.offset + tx, point[1] - Math.abs(d.offset) * 0.6 + ty];
    const end: Point2 = [elbow[0] + side * 12, elbow[1]];
    content =
      line(point, elbow) +
      arrow(point, [elbow[0] - point[0], elbow[1] - point[1]]) +
      line(elbow, end) +
      labelAt([(elbow[0] + end[0]) / 2, elbow[1] - 1.4], 0, false);
  } else if (d.kind === 'angle') {
    const vertex = sheetPoint(d.vertex ?? d.a, t);
    const start = Math.atan2(a[1] - vertex[1], a[0] - vertex[0]);
    let delta = Math.atan2(b[1] - vertex[1], b[0] - vertex[0]) - start;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    const radius = Math.max(6, Math.abs(d.offset));
    const p: Point2 = [vertex[0] + Math.cos(start) * radius, vertex[1] + Math.sin(start) * radius];
    const q: Point2 = [
      vertex[0] + Math.cos(start + delta) * radius,
      vertex[1] + Math.sin(start + delta) * radius,
    ];
    const mid = start + delta / 2;
    content =
      line(vertex, p) +
      line(vertex, q) +
      `<path d="M${f(p)} A${radius},${radius} 0 0 ${delta > 0 ? 1 : 0} ${f(q)}"/>` +
      arrow(p, [-Math.sin(start) * Math.sign(delta), Math.cos(start) * Math.sign(delta)]) +
      arrow(q, [
        Math.sin(start + delta) * Math.sign(delta),
        -Math.cos(start + delta) * Math.sign(delta),
      ]) +
      labelAt([vertex[0] + Math.cos(mid) * (radius + 3), vertex[1] + Math.sin(mid) * (radius + 3)]);
  }
  return `<g class="dimension${selected ? ' selected' : ''}" data-dimension-id="${escapeXml(d.id)}" data-view-id="${d.viewId}" fill="none" stroke="${color}" stroke-width="${selected ? 0.4 : 0.18}" style="cursor:move">${content}</g>`;
}

function projectionMarkup(view: Projection, t: ViewTransform, settings: DrawingSettings): string {
  let markup = '';
  for (const edge of [...view.edges].sort((a, b) => Number(b.hidden) - Number(a.hidden))) {
    if (edge.hidden && !settings.hiddenLines) continue;
    if (edge.points.length < 2) continue;
    const path = edge.points.map((p, i) => `${i ? 'L' : 'M'}${f(sheetPoint(p, t))}`).join(' ');
    markup += `<path d="${path}" data-edge-id="${escapeXml(edge.id)}" data-view-id="${view.id}" fill="none" stroke="${edge.hidden ? '#7d858a' : '#20262b'}" stroke-width="${edge.hidden ? 0.18 : 0.32}" ${edge.hidden ? 'stroke-dasharray="2 1"' : ''} style="cursor:crosshair"/>`;
    if (
      settings.centerLines &&
      edge.kind === 'circle' &&
      edge.closed !== false &&
      edge.center &&
      edge.radius
    ) {
      const c = sheetPoint(edge.center, t),
        r = edge.radius * t.scale + 3;
      markup += `<g fill="none" stroke="#667983" stroke-width=".15" stroke-dasharray="4 1 .7 1">${line([c[0] - r, c[1]], [c[0] + r, c[1]])}${line([c[0], c[1] - r], [c[0], c[1] + r])}</g>`;
    }
  }
  const anchors = [
    ...(view.anchors ??
      view.edges.flatMap((e) =>
        e.points.length
          ? [
              { id: `${e.id}-start`, point: e.points[0] },
              { id: `${e.id}-end`, point: e.points.at(-1)! },
            ]
          : [],
      )),
    ...view.edges.filter((e) => e.center).map((e) => ({ id: `${e.id}-center`, point: e.center! })),
  ];
  const emitted = new Set<string>();
  for (const anchor of anchors) {
    const key = anchor.point.map((v) => v.toFixed(5)).join(',');
    if (emitted.has(key)) continue;
    emitted.add(key);
    const p = sheetPoint(anchor.point, t);
    markup += `<circle class="snap-anchor" data-anchor-id="${escapeXml(anchor.id)}" data-view-id="${view.id}" data-model-x="${anchor.point[0]}" data-model-y="${anchor.point[1]}" cx="${n(p[0])}" cy="${n(p[1])}" r="1.2" fill="#16745e" fill-opacity="0" stroke="none" style="cursor:crosshair"/>`;
  }
  return markup;
}

const glyphWidth = (character: string): number =>
  /[ilI1.,:;!'|]/.test(character)
    ? 0.34
    : /[MW@%]/.test(character)
      ? 1
      : /\s/.test(character)
        ? 0.36
        : /[A-Z0-9]/.test(character)
          ? 0.76
          : /[a-z]/.test(character)
            ? 0.65
            : 0.95;
const textWidth = (value: string, size: number): number =>
  Array.from(value).reduce((width, character) => width + glyphWidth(character) * size, 0);
function truncateText(value: string, width: number, size: number): string {
  let output = '';
  for (const character of value) {
    if (textWidth(output + character + '...', size) > width) break;
    output += character;
  }
  return `${output}...`;
}
function wrapText(
  value: string,
  width: number,
  limit: number,
  size: number,
): { lines: string[]; omitted: number } {
  const lines: string[] = [];
  for (const paragraph of value.replace(/\r\n?/g, '\n').split('\n')) {
    let current = '';
    for (const word of paragraph
      .trim()
      .split(/[\t ]+/)
      .filter(Boolean)) {
      if (current && textWidth(`${current} ${word}`, size) <= width) {
        current += ` ${word}`;
        continue;
      }
      if (current) {
        lines.push(current);
        current = '';
      }
      for (const character of word) {
        if (current && textWidth(current + character, size) > width) {
          lines.push(current);
          current = '';
        }
        current += character;
      }
    }
    lines.push(current);
  }
  const omitted = Math.max(0, lines.length - limit);
  if (omitted) lines[limit - 1] = truncateText(lines[limit - 1], width, size);
  return { lines: lines.slice(0, limit), omitted };
}

/** Bounds include paper-space labels and leaders, rather than a global margin guess. */
function occupiedBounds(
  view: Projection,
  dimensions: Dimension[],
  scale: number,
  precision: number,
): Bounds2 {
  const bounds: Bounds2 = {
    minX: view.bounds.minX * scale,
    maxX: view.bounds.maxX * scale,
    minY: -view.bounds.maxY * scale,
    maxY: -view.bounds.minY * scale,
  };
  const add = (x: number, y: number) => {
    bounds.minX = Math.min(bounds.minX, x);
    bounds.maxX = Math.max(bounds.maxX, x);
    bounds.minY = Math.min(bounds.minY, y);
    bounds.maxY = Math.max(bounds.maxY, y);
  };
  for (const d of dimensions.filter((item) => item.viewId === view.id)) {
    const a: Point2 = [d.a[0] * scale, -d.a[1] * scale],
      b: Point2 = [d.b[0] * scale, -d.b[1] * scale];
    const labelHalf = textWidth(formatDimension(d, precision), 3.2) / 2 + 0.5;
    const tx = d.textOffset?.[0] ?? 0,
      ty = d.textOffset?.[1] ?? 0;
    const label = (x: number, y: number, rotated = false) => {
      add(x + tx - (rotated ? 4 : labelHalf), y + ty - (rotated ? labelHalf : 3.8));
      add(x + tx + (rotated ? 1 : labelHalf), y + ty + (rotated ? labelHalf : 1));
    };
    if (d.kind === 'horizontal') {
      const y = Math.max(a[1], b[1]) + d.offset;
      const left = Math.min(a[0], b[0]),
        right = Math.max(a[0], b[0]);
      const short = right - left < labelHalf * 2 + 5;
      add(a[0], y + 2);
      add(b[0], y + 2);
      if (short) {
        add(left - 4, y);
        add(right + 4, y);
      }
      label(short ? right + 5 + labelHalf : (a[0] + b[0]) / 2, y - 1.2);
    } else if (d.kind === 'vertical') {
      const x = Math.min(a[0], b[0]) - d.offset;
      const top = Math.min(a[1], b[1]),
        bottom = Math.max(a[1], b[1]);
      const short = bottom - top < labelHalf * 2 + 5;
      add(x - 2, a[1]);
      add(x - 2, b[1]);
      if (short) {
        add(x, top - 4);
        add(x, bottom + 4);
      }
      label(x - 1.2, short ? top - 5 - labelHalf : (a[1] + b[1]) / 2, true);
    } else if (d.kind === 'diameter' || d.kind === 'radius') {
      const r = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const side = d.offset < 0 ? -1 : 1;
      const x = (d.kind === 'radius' ? b[0] : a[0] + side * r * 0.7071) + d.offset,
        y = (d.kind === 'radius' ? b[1] : a[1] - r * 0.7071) - Math.abs(d.offset) * 0.6;
      add(x + tx, y + ty);
      add(x + side * 12 + tx, y + ty);
      label(x + side * 6, y - 1.4);
    } else if (d.kind === 'aligned') {
      const dx = b[0] - a[0],
        dy = b[1] - a[1],
        length = Math.hypot(dx, dy) || 1;
      const nx = (-dy / length) * d.offset,
        ny = (dx / length) * d.offset;
      add(a[0] + nx, a[1] + ny);
      add(b[0] + nx, b[1] + ny);
      const x = (a[0] + b[0]) / 2 + nx + tx,
        y = (a[1] + b[1]) / 2 + ny - 1.3 + ty;
      const radius = Math.hypot(labelHalf, 4);
      add(x - radius, y - radius);
      add(x + radius, y + radius);
    } else {
      const v = d.vertex ?? d.a,
        r = Math.abs(d.offset) + labelHalf + 7;
      add(v[0] * scale - r + tx, -v[1] * scale - r + ty);
      add(v[0] * scale + r + tx, -v[1] * scale + r + ty);
    }
  }
  return bounds;
}

function alignedBounds(
  part: Part,
  dimensions: Dimension[],
  scale: number,
  precision: number,
): Record<ViewId, Bounds2> {
  const bounds = Object.fromEntries(
    part.views.map((view) => [view.id, occupiedBounds(view, dimensions, scale, precision)]),
  ) as Record<ViewId, Bounds2>;
  // Shared translation preserves orthographic alignment despite unequal dimension lanes.
  if (bounds.front && bounds.top) {
    const min = Math.min(bounds.front.minX, bounds.top.minX),
      max = Math.max(bounds.front.maxX, bounds.top.maxX);
    bounds.front.minX = bounds.top.minX = min;
    bounds.front.maxX = bounds.top.maxX = max;
  }
  if (bounds.front && bounds.right) {
    const min = Math.min(bounds.front.minY, bounds.right.minY),
      max = Math.max(bounds.front.maxY, bounds.right.maxY);
    bounds.front.minY = bounds.right.minY = min;
    bounds.front.maxY = bounds.right.maxY = max;
  }
  return bounds;
}

export function renderDrawing(
  part: Part,
  dimensions: Dimension[],
  settings: DrawingSettings,
  selectedDimensionId?: string,
  layoutOverride?: Pick<RenderedDrawing, 'scale' | 'viewTransforms'>,
): RenderedDrawing {
  const [width, height] = paperSize(settings);
  const left = settings.template === 'eskd' ? 20 : 10;
  const right = 5,
    top = 5,
    bottom = 5;
  const blockHeight = settings.template === 'minimal' ? 35 : 55;
  const contentLeft = left + 5,
    contentTop = top + 10;
  const contentWidth = width - contentLeft - right - 5;
  const contentHeight = height - blockHeight - contentTop - bottom - 13;
  const cellWidth = contentWidth / 2,
    cellHeight = contentHeight / 2;
  const fits = (scale: number) =>
    Object.values(alignedBounds(part, dimensions, scale, settings.precision)).every(
      (b) => b.maxX - b.minX <= cellWidth - 8 && b.maxY - b.minY <= cellHeight - 14,
    );
  const preferred = [
    100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01, 0.005, 0.002, 0.001, 0.0005, 0.0002,
    0.0001,
  ];
  const scale =
    layoutOverride?.scale ??
    (settings.scale === 'auto' ? (preferred.find(fits) ?? 0.0001) : settings.scale);
  const bounds = alignedBounds(part, dimensions, scale, settings.precision);
  const warnings: string[] = autoDimensionWarnings(part, dimensions);
  if (!fits(scale))
    warnings.push(
      settings.scale === 'auto'
        ? 'Dimensions exceed the drawing area. Use a larger sheet or reposition dimensions before export.'
        : 'The selected scale exceeds the drawing area. Choose Auto scale or a larger sheet before export.',
    );
  if (dimensions.length > 30)
    warnings.push(
      'Dense dimensions may overlap. Review and reposition dimensions or use a larger sheet.',
    );
  if (width === 210 && settings.template === 'eskd' && settings.orientation === 'portrait')
    warnings.push(
      'A4 portrait has limited drawing space. A3 landscape is recommended for detailed parts.',
    );
  const cells: Record<ViewId, [number, number]> = {
    right: [0, 0],
    front: [1, 0],
    iso: [0, 1],
    top: [1, 1],
  };
  const transforms = {} as Record<ViewId, ViewTransform>;
  let views = '';
  for (const view of part.views) {
    const [col, row] = cells[view.id];
    const x0 = contentLeft + col * cellWidth,
      y0 = contentTop + row * cellHeight;
    const box = bounds[view.id];
    const t: ViewTransform = layoutOverride?.viewTransforms[view.id] ?? {
      x: x0 + (cellWidth - box.maxX + box.minX) / 2 - box.minX,
      y: y0 + 9 + (cellHeight - 14 - box.maxY + box.minY) / 2 - box.minY,
      scale,
    };
    transforms[view.id] = t;
    views += `<g data-projection="${view.id}">${text(x0 + cellWidth / 2, y0 + 3, view.name.toUpperCase(), 2.5, 'text-anchor="middle" fill="#69737b" letter-spacing=".7"')}${projectionMarkup(view, t, settings)}${dimensions
      .filter((d) => d.viewId === view.id)
      .map((d) => dimensionMarkup(d, t, settings.precision, d.id === selectedDimensionId))
      .join('')}</g>`;
  }
  const bx = Math.max(left, width - right - 185),
    by = height - bottom - blockHeight,
    bw = width - right - bx;
  const mainCellWidth = bw - 49;
  const cellText = (
    x: number,
    y: number,
    value: string,
    available: number,
    size: number,
    fieldName: string,
  ): string => {
    const singleLine = value.replace(/\s+/g, ' ');
    const fittedSize = Math.min(
      size,
      Math.max(2.2, available / Math.max(textWidth(singleLine, 1), 1)),
    );
    const truncated = textWidth(singleLine, fittedSize) > available;
    if (truncated)
      warnings.push(
        `${fieldName} is shortened in the title block. Reduce its length to include the full text.`,
      );
    return text(
      x,
      y,
      truncated ? truncateText(singleLine, available, fittedSize) : singleLine,
      fittedSize,
      `data-field="${fieldName.toLowerCase().replace(/ /g, '-')}"`,
    );
  };
  const title = settings.title || part.name;
  let titleSize = 4;
  let titleLines = wrapText(title, mainCellWidth, 2, titleSize);
  if (titleLines.omitted) {
    titleSize = 2.8;
    titleLines = wrapText(title, mainCellWidth, 2, titleSize);
  }
  if (titleLines.omitted)
    warnings.push(
      'Drawing title is shortened in the title block. Reduce its length to include the full text.',
    );
  let titleBlock = `<rect x="${bx}" y="${by}" width="${bw}" height="${blockHeight}" fill="none" stroke="#20262b" stroke-width=".35"/>`;
  titleBlock +=
    line([bx, by + 11], [bx + bw, by + 11], 'stroke-width=".25"') +
    line([bx, by + 27], [bx + bw, by + 27], 'stroke-width=".25"');
  titleBlock += line([bx + bw - 43, by], [bx + bw - 43, by + blockHeight], 'stroke-width=".25"');
  titleBlock +=
    text(bx + 3, by + 4, 'DRAWING NUMBER', 2, 'fill="#667079"') +
    cellText(
      bx + 3,
      by + 8.5,
      settings.number || 'UNASSIGNED',
      mainCellWidth,
      3.5,
      'Drawing number',
    );
  titleBlock +=
    text(bx + 3, by + 15, 'TITLE', 2, 'fill="#667079"') +
    titleLines.lines
      .map((value, index) =>
        text(
          bx + 3,
          by + (titleLines.lines.length > 1 ? 20.2 : 22) + index * 4.8,
          value,
          titleSize,
          'data-field="title"',
        ),
      )
      .join('');
  titleBlock +=
    text(bx + bw - 40, by + 4, 'SCALE / SHEET', 2, 'fill="#667079"') +
    cellText(bx + bw - 40, by + 9, `${scaleLabel(scale)} / ${settings.format}`, 37, 3, 'Scale');
  titleBlock +=
    text(bx + bw - 40, by + 15, 'REVISION', 2, 'fill="#667079"') +
    cellText(bx + bw - 40, by + 22, settings.revision || '—', 37, 3.5, 'Revision');
  if (blockHeight > 35) {
    titleBlock += line([bx, by + 40], [bx + bw, by + 40], 'stroke-width=".25"');
    titleBlock +=
      text(bx + 3, by + 31, 'MATERIAL', 2, 'fill="#667079"') +
      cellText(bx + 3, by + 37, settings.material || 'Not specified', mainCellWidth, 3, 'Material');
    titleBlock +=
      text(bx + 3, by + 44, 'GENERAL TOLERANCE', 2, 'fill="#667079"') +
      cellText(
        bx + 3,
        by + 50,
        settings.tolerance || 'Not specified',
        mainCellWidth,
        3,
        'General tolerance',
      );
    titleBlock +=
      text(bx + bw - 40, by + 31, 'DRAWN BY', 2, 'fill="#667079"') +
      cellText(bx + bw - 40, by + 37, settings.author || '—', 37, 3, 'Author');
    titleBlock +=
      text(bx + bw - 40, by + 44, 'PROJECTION / UNITS', 2, 'fill="#667079"') +
      text(bx + bw - 40, by + 50, 'FIRST ANGLE / mm', 2.7);
  } else
    titleBlock += cellText(
      bx + 3,
      by + 32,
      `mm · First angle · ${settings.material || 'Material not specified'}`,
      mainCellWidth,
      2.8,
      'Material',
    );
  const noteWidth = Math.max(0, bx - left - 8);
  const notes = wrapText(
    settings.notes || 'Review geometry, tolerances and manufacturing requirements before release.',
    noteWidth > 50 ? noteWidth : width - left - right - 6,
    noteWidth > 50 ? 8 : 2,
    2.6,
  );
  if (notes.omitted)
    warnings.push(
      `${notes.omitted} technical note lines do not fit on this sheet. Shorten the notes or choose a wider sheet.`,
    );
  const noteX = noteWidth > 50 ? left + 3 : left + 3,
    noteY = noteWidth > 50 ? by + 4 : by - 10;
  const noteMarkup = notes.lines
    .map((v, i) => text(noteX, noteY + i * 3.7, v, 2.6, 'data-field="technical-note"'))
    .join('');
  const templateName = { eskd: 'ESKD-INSPIRED', iso: 'ISO TECHNICAL', minimal: 'MINIMAL' }[
    settings.template
  ];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}" role="img" aria-label="Technical drawing of ${escapeXml(part.name)}" style="font-family:Arial,Helvetica,sans-serif;background:white;color:#20262b"><defs><clipPath id="sheet-content"><rect x="${left + 1}" y="${top + 1}" width="${width - left - right - 2}" height="${height - top - bottom - blockHeight - 14}"/></clipPath></defs><rect width="${width}" height="${height}" fill="white"/><g fill="#20262b" stroke="#20262b"><rect x="${left}" y="${top}" width="${width - left - right}" height="${height - top - bottom}" fill="none" stroke-width=".5"/><g stroke="none">${text(left + 3, top + 5, `${templateName} · ${part.sourceName}`.slice(0, 100), 2.2, 'fill="#7a838a"')}${text(width - right - 3, top + 5, 'GEOMETRIC DRAFT · REVIEW REQUIRED', 2.2, 'text-anchor="end" fill="#7a838a"')}</g><g clip-path="url(#sheet-content)" stroke="none">${views}</g><g stroke="none">${noteMarkup}</g>${titleBlock}</g></svg>`;
  return { svg, width, height, scale, viewTransforms: transforms, warnings };
}
