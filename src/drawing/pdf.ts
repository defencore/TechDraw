import { jsPDF } from 'jspdf';
import 'svg2pdf.js';
import type { Dimension, DrawingSettings, Part } from '../model';
import { renderDrawing } from './render';

export interface PdfPage {
  part: Part;
  dimensions: Dimension[];
  settings: DrawingSettings;
}

let fontData: Promise<string> | undefined;

/** Cache the same-origin font in memory; drawing data stays in this browser. */
function loadPdfFont(): Promise<string> {
  if (!fontData)
    fontData = (async () => {
      const response = await fetch(`${import.meta.env.BASE_URL}fonts/NotoSans-Regular.ttf`);
      if (!response.ok)
        throw new Error(
          'The PDF font could not be loaded. Reload the page and try exporting again.',
        );
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length < 12 || bytes[0] !== 0 || bytes[1] !== 1 || bytes[2] !== 0 || bytes[3] !== 0)
        throw new Error('The PDF font is invalid. Reload the page and try exporting again.');
      // svg2pdf measures text with browser APIs before writing PDF text runs.
      const browserFont = await new FontFace('TechDraw', bytes).load();
      document.fonts.add(browserFont);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 32768)
        binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
      return btoa(binary);
    })().catch((error) => {
      fontData = undefined;
      throw error;
    });
  return fontData;
}

function applyPdfFont(pdf: jsPDF, svg: SVGSVGElement): void {
  svg.style.fontFamily = 'TechDraw';
  pdf.setFont('TechDraw', 'normal');
  const metadata = pdf.getFont().metadata as { characterToGlyph?: (code: number) => number };
  if (typeof metadata.characterToGlyph !== 'function')
    throw new Error('The PDF font could not be initialized. Reload the page and try again.');
  for (const text of svg.querySelectorAll('text,tspan')) {
    text.setAttribute('font-family', 'TechDraw');
    for (const character of text.textContent || '') {
      if (/\s/u.test(character)) continue;
      if (!metadata.characterToGlyph(character.codePointAt(0)!)) {
        throw new Error(
          `The PDF font does not contain “${character}”. Use supported Latin, Greek or Cyrillic characters in drawing text.`,
        );
      }
    }
  }
}

/** Export the same sheet geometry shown in the workspace as vector PDF pages. */
export async function exportPdf(pages: PdfPage[], filename = 'techdraw.pdf'): Promise<void> {
  if (!pages.length) throw new Error('Select at least one part to export.');
  const rendered = pages.map((p) => renderDrawing(p.part, p.dimensions, p.settings));
  if (rendered.some((p) => p.warnings.some((w) => w.includes('technical note lines do not fit'))))
    throw new Error(
      'Technical notes do not fit on the sheet. Shorten the notes or choose a wider sheet before exporting.',
    );
  if (
    rendered.some((p) =>
      p.warnings.some(
        (w) => w.startsWith('The selected scale') || w.startsWith('Dimensions exceed'),
      ),
    )
  )
    throw new Error(
      'The drawing does not fit the sheet. Choose Auto scale, a larger sheet or reposition dimensions.',
    );
  const first = rendered[0];
  const pdf = new jsPDF({
    orientation: first.width > first.height ? 'landscape' : 'portrait',
    unit: 'mm',
    format: [first.width, first.height],
    compress: true,
  });
  pdf.addFileToVFS('NotoSans-Regular.ttf', await loadPdfFont());
  pdf.addFont('NotoSans-Regular.ttf', 'TechDraw', 'normal');
  pdf.setFont('TechDraw', 'normal');
  pdf.setProperties({
    title: pages[0].settings.title || pages[0].part.name,
    subject: 'Technical drawing — geometric draft',
    creator: 'TechDraw',
    author: pages[0].settings.author,
  });
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-100000px;top:0;pointer-events:none';
  document.body.append(holder);
  try {
    for (const [index, sheet] of rendered.entries()) {
      if (index)
        pdf.addPage(
          [sheet.width, sheet.height],
          sheet.width > sheet.height ? 'landscape' : 'portrait',
        );
      holder.innerHTML = sheet.svg;
      const svg = holder.querySelector('svg');
      if (!svg) throw new Error('The drawing could not be prepared for export.');
      applyPdfFont(pdf, svg);
      await pdf.svg(svg, { x: 0, y: 0, width: sheet.width, height: sheet.height });
    }
    pdf.save(filename.endsWith('.pdf') ? filename : `${filename}.pdf`);
  } finally {
    holder.remove();
  }
}
