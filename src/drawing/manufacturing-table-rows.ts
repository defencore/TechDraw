import type { DrawingSettings, Part } from '../model';
import {
  activeManufacturingProfile,
  effectivePartType,
  manufacturingParameterSections,
  manufacturingProfileDefinition,
} from '../manufacturing/catalog';
import type { parameterTableBuilder } from './parameter-table-layout';

interface RequirementRow {
  key: string;
  label: string;
  symbol: string;
  value: string;
}
interface RequirementGroup {
  key: string;
  label?: string;
  rows: RequirementRow[];
}
export interface EnteredManufacturingRequirements {
  name: string;
  groups: RequirementGroup[];
  empty: boolean;
  incompleteParameters: boolean;
}

/** Preset fields take precedence over reusable sections; each entered key prints exactly once. */
export function enteredManufacturingRequirements(
  part: Part,
  settings: DrawingSettings,
): EnteredManufacturingRequirements {
  const type = effectivePartType(part),
    definition = manufacturingProfileDefinition(type);
  const profile = activeManufacturingProfile(part),
    uk = settings.template === 'eskd-uk';
  const groups: RequirementGroup[] = [];
  const seen = new Set<string>();
  const rowsFor = (fields: typeof definition.fields): RequirementRow[] => {
    const rows: RequirementRow[] = [];
    for (const field of fields) {
      if (seen.has(field.key)) continue;
      seen.add(field.key);
      const value = profile?.fields[field.key];
      if (!value?.trim()) continue;
      rows.push({
        key: `field-${field.key}`,
        label: uk ? field.labelUk : field.label,
        symbol: field.symbol ?? '',
        value,
      });
    }
    return rows;
  };
  const presetRows = rowsFor(definition.fields);
  if (presetRows.length) groups.push({ key: 'preset', rows: presetRows });
  for (const section of manufacturingParameterSections()) {
    const rows = rowsFor(section.fields);
    if (rows.length)
      groups.push({
        key: `section-${section.id}`,
        label: uk ? section.labelUk : section.label,
        rows,
      });
  }
  const parameters = profile?.parameters ?? [];
  if (parameters.length)
    groups.push({
      key: 'custom',
      rows: parameters.map((parameter) => ({
        key: `custom-${parameter.id}`,
        label: parameter.label,
        symbol: parameter.symbol ?? '',
        value: parameter.value || (uk ? 'Задати' : 'Specify'),
      })),
    });
  return {
    name: profile?.customName || (uk ? definition.labelUk : definition.label).toUpperCase(),
    groups,
    empty: groups.length === 0,
    incompleteParameters: parameters.some((parameter) => !parameter.value.trim()),
  };
}

export function appendManufacturingRequirements(
  builder: ReturnType<typeof parameterTableBuilder>,
  requirements: EnteredManufacturingRequirements,
): void {
  for (const group of requirements.groups) {
    if (group.label) builder.add(group.key, group.label, '', '', true);
    for (const row of group.rows) builder.add(row.key, row.label, row.symbol, row.value);
  }
}
