import type { Bounds2, DrawingSettings, Part } from '../model';
import { effectivePartType, hasManufacturingData } from '../manufacturing/catalog';
import { gearTableLayout } from './gear-table';
import { parameterTableBuilder, type ParameterTableLayout } from './parameter-table-layout';
import {
  appendManufacturingRequirements,
  enteredManufacturingRequirements,
} from './manufacturing-table-rows';
export { renderParameterTable } from './parameter-table-layout';
export type { ParameterTableLayout, ParameterTableRow } from './parameter-table-layout';

/** The selected profile controls the printed requirements; inactive profile values remain stored. */
export function parameterTableLayout(
  part: Part,
  settings: DrawingSettings,
  available: Bounds2,
): ParameterTableLayout | undefined {
  const type = effectivePartType(part);
  if (type === 'gear') return gearTableLayout(part, settings, available);
  if (!hasManufacturingData(part)) return;
  const uk = settings.template === 'eskd-uk';
  const requirements = enteredManufacturingRequirements(part, settings);
  const { empty, name } = requirements;
  const draft = empty || requirements.incompleteParameters;
  const header = `${name} — ${uk ? 'ДАНІ ДЛЯ ВИГОТОВЛЕННЯ' : 'MANUFACTURING DATA'}${draft ? (uk ? ' — ЧЕРНЕТКА' : ' — DRAFT') : ''}`;
  const builder = parameterTableBuilder(type, available);
  builder.add('manufacturing', header, '', '', true);
  appendManufacturingRequirements(builder, requirements);
  if (empty)
    builder.add(
      'requirements',
      uk ? 'Вимоги до виготовлення' : 'Manufacturing requirements',
      '',
      uk ? 'Задати вимоги до виготовлення' : 'Specify manufacturing requirements',
    );
  return builder.finish(
    [],
    'Manufacturing parameter table exceeds the drawing area. Shorten the entered data or choose a larger sheet before export.',
  );
}
