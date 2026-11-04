import type {
  Dimension,
  DrawingAnnotation,
  DrawingSettings,
  Part,
  Point2,
  Projection,
  ViewId,
} from '../model';
import { annotationBounds, renderAnnotations } from './annotations';
import { applyDrawingAppearance, type DrawingAppearance } from './appearance';
import { drawingSettingsForInstructions } from './manufacturing-instructions';
export type { DrawingAppearance } from './appearance';
import { autoDimensionWarnings } from './dimensions';
import { dimensionGeometry, toPaper, type ViewTransform } from './dimension-geometry';
import {
  calculateDrawingLayout,
  drawingLayoutFits,
  drawingPage,
  dimensionLabelsOverlap,
  projectionMetrics,
} from './page-layout';
import { isGostTemplate, renderGostForm1 } from './gost-form1';
import { renderParameterTable } from './parameter-table';
import { gearDatumPaperGeometry, gearReferenceCircles } from './gear-dimensions';
export { paperSize } from './page-layout';
export type { ViewTransform } from './dimension-geometry';

export interface RenderedDrawing {
  svg: string;
  width: number;
  height: number;
  scale: number;
  viewTransforms: Record<ViewId, ViewTransform>;
  warnings: string[];
}
export interface DrawingRenderOptions {
  appearance?: DrawingAppearance;
  annotations?: readonly DrawingAnnotation[];
  instructions?: string;
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
const scaleLabel = (scale: number): string => (scale >= 1 ? `${n(scale)}:1` : `1:${n(1 / scale)}`);

export function renderDimension(
  d: Dimension,
  t: ViewTransform,
  precision: number,
  selected: boolean,
  appearance: DrawingAppearance = 'paper',
): string {
  const geometry = dimensionGeometry(d, t, precision);
  const color = selected ? '#16745e' : '#20262b';
  let content = geometry.lines
    .map((segment) => line(segment.a, segment.b, segment.grip ? 'data-dimension-grip="line"' : ''))
    .join('');
  content += geometry.arcs
    .map(
      (arc) =>
        `<path data-dimension-grip="line" d="M${f(arc.a)} A${arc.radius},${arc.radius} 0 0 ${arc.delta > 0 ? 1 : 0} ${f(arc.b)}"/>`,
    )
    .join('');
  content += geometry.arrows
    .map(
      (triangle) =>
        `<path class="dimension-arrow" d="M${f(triangle[0])} L${f(triangle[1])} L${f(triangle[2])} Z" fill="${color}" stroke="none"/>`,
    )
    .join('');
  const {
    origin: [x, y],
    angle,
    data,
  } = geometry.label;
  const runs = data.runs
    .map(
      (run) =>
        `<text x="${n(x + run.x)}" y="${n(y + run.y)}" fill="${color}" stroke="none" text-anchor="${run.anchor}" font-size="${run.fontSize}" data-dimension-label-run="${run.role}">${escapeXml(run.text)}</text>`,
    )
    .join('');
  content += `<g class="dimension-label" data-dimension-grip="label" aria-label="${escapeXml(data.plainText)}"${angle ? ` transform="rotate(${angle} ${n(x)} ${n(y)})"` : ''}><rect x="${n(x + data.bounds.minX)}" y="${n(y + data.bounds.minY)}" width="${n(data.width)}" height="${n(data.height)}" fill="white" stroke="none"/>${runs}</g>`;
  return applyDrawingAppearance(
    `<g class="dimension${selected ? ' selected' : ''}" data-dimension-id="${escapeXml(d.id)}" data-view-id="${d.viewId}" fill="none" stroke="${color}" stroke-width="${selected ? 0.4 : 0.18}" style="cursor:move">${content}</g>`,
    appearance,
  );
}

function projectionMarkup(view: Projection, t: ViewTransform, settings: DrawingSettings): string {
  let markup = '';
  for (const edge of [...view.edges].sort((a, b) => Number(b.hidden) - Number(a.hidden))) {
    if (edge.hidden && !settings.hiddenLines) continue;
    if (edge.points.length < 2) continue;
    const path = edge.points.map((p, i) => `${i ? 'L' : 'M'}${f(toPaper(p, t))}`).join(' ');
    markup += `<path d="${path}" data-edge-id="${escapeXml(edge.id)}" data-view-id="${view.id}" fill="none" stroke="${edge.hidden ? '#7d858a' : '#20262b'}" stroke-width="${edge.hidden ? 0.18 : 0.32}" ${edge.hidden ? 'stroke-dasharray="2 1"' : ''} style="cursor:crosshair"/>`;
    if (
      settings.centerLines &&
      edge.kind === 'circle' &&
      edge.closed !== false &&
      edge.center &&
      edge.radius
    ) {
      const c = toPaper(edge.center, t),
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
    const p = toPaper(anchor.point, t);
    markup += `<circle class="snap-anchor" data-anchor-id="${escapeXml(anchor.id)}" data-view-id="${view.id}" data-model-x="${anchor.point[0]}" data-model-y="${anchor.point[1]}" cx="${n(p[0])}" cy="${n(p[1])}" r="1.2" fill="#16745e" fill-opacity="0" stroke="none" style="cursor:crosshair"/>`;
  }
  return markup;
}

function gearReferences(part: Part, view: ViewId, transform: ViewTransform): string {
  let svg = gearReferenceCircles(part, view)
    .map((circle) => {
      const center = toPaper(circle.center, transform);
      return `<circle data-gear-reference="${circle.kind}" cx="${n(center[0])}" cy="${n(center[1])}" r="${n(circle.radius * transform.scale)}" fill="none" stroke="#667983" stroke-width=".15" stroke-dasharray="${circle.kind === 'pitch' ? '4 1 .7 1' : '1.5 1'}"/>`;
    })
    .join('');
  const datum = gearDatumPaperGeometry(part, view, transform);
  if (datum) {
    svg += `<g data-gear-datum="A" fill="none" stroke="#667983" stroke-width=".15" stroke-dasharray="4 1 .7 1">${datum.lines.map((segment) => line(segment.a, segment.b)).join('')}</g>`;
    svg += text(
      datum.label[0],
      datum.label[1],
      'A',
      3,
      'data-gear-datum-label="A" text-anchor="middle" fill="#20262b"',
    );
  }
  return svg;
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

export function renderDrawing(
  part: Part,
  dimensions: Dimension[],
  settings: DrawingSettings,
  selectedDimensionId?: string,
  layoutOverride?: Pick<RenderedDrawing, 'scale' | 'viewTransforms'>,
  options: DrawingRenderOptions = {},
): RenderedDrawing {
  settings = drawingSettingsForInstructions(settings, options.instructions);
  const page = drawingPage(settings, part);
  const { width, height, left, right, top, bottom, blockHeight } = page;
  const { minX: clipLeft, minY: clipTop, maxX: clipRight, maxY: clipBottom } = page.content;
  const gost = isGostTemplate(settings.template);
  const calculated = layoutOverride
    ? undefined
    : calculateDrawingLayout(part, dimensions, settings);
  const scale = layoutOverride?.scale ?? calculated!.scale;
  const transforms = layoutOverride?.viewTransforms ?? calculated!.viewTransforms;
  const fits = layoutOverride
    ? drawingLayoutFits(part, dimensions, settings, layoutOverride)
    : calculated!.fits;
  const warnings: string[] = autoDimensionWarnings(part, dimensions);
  if (page.parameterTable) warnings.push(...page.parameterTable.warnings);
  if (
    options.annotations?.some((annotation) => {
      const bounds = annotationBounds(annotation);
      return bounds.minX < 0 || bounds.minY < 0 || bounds.maxX > width || bounds.maxY > height;
    })
  )
    warnings.push('Review annotations exceed the paper. Move them inside the sheet before export.');
  if (!fits)
    warnings.push(
      layoutOverride || settings.scale === 'auto'
        ? 'Dimensions exceed the drawing area. Use a larger sheet or reposition dimensions before export.'
        : 'The selected scale exceeds the drawing area. Choose Auto fit or a larger sheet before export.',
    );
  if (
    fits &&
    dimensionLabelsOverlap(dimensions, { scale, viewTransforms: transforms }, settings.precision)
  )
    warnings.push(
      'Some dimension labels overlap. Use Auto layout or move the affected dimensions.',
    );
  let views = '';
  for (const view of part.views) {
    const t = transforms[view.id];
    if (!t) throw new Error(`Missing ${view.id} drawing transform.`);
    const metrics =
      calculated?.metrics[view.id] ?? projectionMetrics(view, dimensions, t.scale, settings, part);
    const caption = metrics.caption;
    views += `<g data-projection="${view.id}">${text(caption.origin[0] + t.x, caption.origin[1] + t.y, caption.text, 2.5, 'text-anchor="middle" fill="#69737b" letter-spacing=".7"')}${gearReferences(part, view.id, t)}${projectionMarkup(view, t, settings)}${dimensions
      .filter((d) => d.viewId === view.id)
      .map((d) => renderDimension(d, t, settings.precision, d.id === selectedDimensionId))
      .join('')}</g>`;
  }
  const bx = Math.max(left, width - right - 185),
    by = height - bottom - blockHeight,
    bw = width - right - bx;
  let titleBlock = '';
  if (gost) {
    const form = renderGostForm1(part, settings, width, height, scale);
    titleBlock = form.svg;
    warnings.push(...form.warnings);
  } else {
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
    titleBlock = `<rect x="${bx}" y="${by}" width="${bw}" height="${blockHeight}" fill="none" stroke="#20262b" stroke-width=".35"/>`;
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
        cellText(
          bx + 3,
          by + 37,
          settings.material || 'Not specified',
          mainCellWidth,
          3,
          'Material',
        );
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
  }
  const notes = page.notes;
  if (notes.omitted)
    warnings.push(
      `${notes.omitted} technical note lines do not fit on this sheet. Shorten the notes or choose a larger sheet.`,
    );
  const noteMarkup = notes.lines
    .map((v, i) =>
      text(
        notes.x,
        notes.y + i * notes.lineHeight,
        v,
        notes.fontSize,
        'data-field="technical-note"',
      ),
    )
    .join('');
  const templateName = settings.template === 'minimal' ? 'MINIMAL' : 'ISO TECHNICAL';
  const header = gost
    ? ''
    : `<g stroke="none">${text(left + 3, top + 5, `${templateName} · ${part.sourceName}`.slice(0, 100), 2.2, 'fill="#7a838a"')}${text(width - right - 3, top + 5, 'GEOMETRIC DRAFT · REVIEW REQUIRED', 2.2, 'text-anchor="end" fill="#7a838a"')}</g>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}" role="img" aria-label="Technical drawing of ${escapeXml(part.name)}" style="font-family:Arial,Helvetica,sans-serif;background:white;color:#20262b"><defs><clipPath id="sheet-content"><rect x="${clipLeft}" y="${clipTop}" width="${clipRight - clipLeft}" height="${clipBottom - clipTop}"/></clipPath></defs><rect width="${width}" height="${height}" fill="white"/><g fill="#20262b" stroke="#20262b"><rect x="${left}" y="${top}" width="${width - left - right}" height="${height - top - bottom}" fill="none" stroke-width=".5"/>${header}<g clip-path="url(#sheet-content)" stroke="none">${views}</g>${page.parameterTable ? renderParameterTable(page.parameterTable) : ''}<g stroke="none">${noteMarkup}</g>${titleBlock}</g></svg>`;
  const annotated = applyDrawingAppearance(svg, options.appearance).replace(
    '</svg>',
    `${renderAnnotations(options.annotations ?? [], options.appearance)}</svg>`,
  );
  return {
    svg: annotated,
    width,
    height,
    scale,
    viewTransforms: transforms,
    warnings,
  };
}
