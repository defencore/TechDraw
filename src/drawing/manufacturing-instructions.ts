import type { DrawingSettings } from '../model';

/** Per-part operation text affects this drawing only; cached global notes remain untouched. */
export function drawingSettingsForInstructions(
  settings: DrawingSettings,
  instructions = '',
): DrawingSettings {
  if (!instructions.trim()) return settings;
  const heading =
    settings.template === 'eskd-uk' ? 'Вказівки щодо виготовлення' : 'Manufacturing instructions';
  let step = 0;
  const lines = instructions
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      step++;
      return /^\d+[.)]\s/.test(line) ? line : `${step}. ${line}`;
    });
  return {
    ...settings,
    notes: [settings.notes, `${heading}\n${lines.join('\n')}`].filter(Boolean).join('\n\n'),
  };
}
