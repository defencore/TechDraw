import type {
  ManufacturingData,
  ManufacturingProfile,
  ManufacturingProfileType,
  Part,
  PartType,
} from '../model';

export interface ManufacturingFieldDefinition {
  key: string;
  label: string;
  labelUk: string;
  symbol?: string;
  multiline?: boolean;
}
export interface ManufacturingProfileDefinition {
  label: string;
  labelUk: string;
  fields: readonly ManufacturingFieldDefinition[];
}
export interface ManufacturingParameterSection {
  id: string;
  label: string;
  labelUk: string;
  fields: readonly ManufacturingFieldDefinition[];
}

export const PART_TYPES: readonly { id: PartType; label: string; labelUk: string }[] = [
  { id: 'auto', label: 'Automatic', labelUk: 'Автоматично' },
  { id: 'general', label: 'General part', labelUk: 'Загальна деталь' },
  { id: 'shaft', label: 'Shaft / axle', labelUk: 'Вал / вісь' },
  { id: 'bushing', label: 'Bushing / spacer', labelUk: 'Втулка / проставка' },
  { id: 'nut', label: 'Nut', labelUk: 'Гайка' },
  { id: 'screw', label: 'Screw / lead screw', labelUk: 'Гвинт / ходовий гвинт' },
  {
    id: 'linear-nut',
    label: 'Ball-screw / lead-screw nut',
    labelUk: 'Гайка кулькового / ходового гвинта',
  },
  { id: 'bearing', label: 'Bearing', labelUk: 'Підшипник' },
  { id: 'plate', label: 'Plate / cover', labelUk: 'Пластина / кришка' },
  { id: 'flange', label: 'Flange', labelUk: 'Фланець' },
  { id: 'gear', label: 'Gear', labelUk: 'Шестерня' },
  { id: 'frame', label: 'Frame / bulkhead', labelUk: 'Рама / шпангоут' },
  { id: 'custom', label: 'Custom type', labelUk: 'Власний тип' },
];

const common: readonly ManufacturingFieldDefinition[] = [
  {
    key: 'inspection',
    label: 'Inspection requirements',
    labelUk: 'Вимоги до контролю',
    multiline: true,
  },
  { key: 'surfaceFinish', label: 'Surface finish', labelUk: 'Шорсткість поверхонь' },
  { key: 'heatTreatment', label: 'Heat treatment / hardness', labelUk: 'Термообробка / твердість' },
];
const sections: readonly ManufacturingParameterSection[] = [
  {
    id: 'holes-axes',
    label: 'Holes and axes',
    labelUk: 'Отвори та осі',
    fields: [
      {
        key: 'holeAxes',
        label: 'Hole axes, datums and angular locations',
        labelUk: 'Осі отворів, бази та кутове розташування',
        multiline: true,
      },
      {
        key: 'holeDiameters',
        label: 'Hole diameters and limits',
        labelUk: 'Діаметри отворів і граничні відхилення',
        multiline: true,
      },
      {
        key: 'holeDepths',
        label: 'Hole depths and end conditions',
        labelUk: 'Глибини отворів і форма дна',
        multiline: true,
      },
      {
        key: 'holePattern',
        label: 'Hole-pattern requirements',
        labelUk: 'Вимоги до розташування отворів',
        multiline: true,
      },
      {
        key: 'counterbores',
        label: 'Counterbores, countersinks and spotfaces',
        labelUk: 'Цекування, зенкування та опорні площадки',
        multiline: true,
      },
      {
        key: 'holeIntersections',
        label: 'Angled holes and intersections',
        labelUk: 'Похилі отвори та перетини каналів',
        multiline: true,
      },
    ],
  },
  {
    id: 'threads',
    label: 'Threads',
    labelUk: 'Різьби',
    fields: [
      { key: 'thread', label: 'Thread specification', labelUk: 'Позначення різьби' },
      {
        key: 'threadDiameter',
        label: 'Thread nominal diameter',
        labelUk: 'Номінальний діаметр різьби',
      },
      { key: 'threadPitch', label: 'Thread pitch', labelUk: 'Крок різьби' },
      {
        key: 'threadClass',
        label: 'Thread tolerance class and fit',
        labelUk: 'Поле допуску та посадка різьби',
      },
      {
        key: 'threadProfile',
        label: 'Thread profile and standard',
        labelUk: 'Профіль і стандарт різьби',
      },
      { key: 'threadHand', label: 'Thread hand', labelUk: 'Напрямок різьби' },
      {
        key: 'threadStarts',
        label: 'Number of thread starts',
        labelUk: 'Кількість заходів різьби',
      },
      {
        key: 'threadLength',
        label: 'Thread length, depth and runout',
        labelUk: 'Довжина, глибина та збіг різьби',
        multiline: true,
      },
      {
        key: 'threadInspection',
        label: 'Thread gauges and inspection limits',
        labelUk: 'Калібри різьби та вимоги до контролю',
        multiline: true,
      },
    ],
  },
  {
    id: 'fits-datums',
    label: 'Fits and geometric requirements',
    labelUk: 'Посадки та геометричні вимоги',
    fields: [
      { key: 'datumSystem', label: 'Datum system', labelUk: 'Система баз', multiline: true },
      {
        key: 'journalFits',
        label: 'Journal and seat fits',
        labelUk: 'Посадки шийок і посадкових поверхонь',
      },
      {
        key: 'geometricTolerances',
        label: 'Geometric tolerances and referenced features',
        labelUk: 'Геометричні допуски та елементи, яких вони стосуються',
        multiline: true,
      },
      { key: 'coaxiality', label: 'Coaxiality and datums', labelUk: 'Співвісність і бази' },
      { key: 'datumRunout', label: 'Datums and runout', labelUk: 'Бази та биття', multiline: true },
      { key: 'flatness', label: 'Flatness and datums', labelUk: 'Площинність і бази' },
      {
        key: 'straightness',
        label: 'Straightness and alignment',
        labelUk: 'Прямолінійність і вирівнювання',
      },
    ],
  },
  {
    id: 'linear-drives',
    label: 'Linear drives',
    labelUk: 'Лінійні приводи',
    fields: [
      {
        key: 'driveDesignation',
        label: 'Linear-drive designation and standard',
        labelUk: 'Позначення та стандарт лінійного приводу',
      },
      { key: 'driveLead', label: 'Screw lead and pitch', labelUk: 'Хід і крок гвинта' },
      {
        key: 'driveTravel',
        label: 'Usable travel and stroke limits',
        labelUk: 'Робочий хід і межі переміщення',
      },
      { key: 'driveBacklash', label: 'Backlash and axial play', labelUk: 'Люфт та осьовий зазор' },
      {
        key: 'drivePreload',
        label: 'Linear-drive preload',
        labelUk: 'Попередній натяг лінійного приводу',
      },
      {
        key: 'leadAccuracy',
        label: 'Lead accuracy and reference',
        labelUk: 'Точність ходу та нормативний документ',
      },
      {
        key: 'nutMounting',
        label: 'Nut mounting and interfaces',
        labelUk: 'Кріплення та приєднувальні поверхні гайки',
        multiline: true,
      },
      {
        key: 'recirculation',
        label: 'Ball recirculation and return system',
        labelUk: 'Циркуляція кульок і система їх повернення',
        multiline: true,
      },
      {
        key: 'driveSupports',
        label: 'Drive supports and mounting arrangement',
        labelUk: 'Опори приводу та схема кріплення',
        multiline: true,
      },
    ],
  },
  {
    id: 'bearings',
    label: 'Bearings and seats',
    labelUk: 'Підшипники та посадкові поверхні',
    fields: [
      {
        key: 'bearingDesignation',
        label: 'Bearing designation and standard',
        labelUk: 'Позначення та стандарт підшипника',
      },
      {
        key: 'bearingSeats',
        label: 'Shaft and housing seats',
        labelUk: 'Посадкові поверхні вала та корпуса',
        multiline: true,
      },
      {
        key: 'bearingClearance',
        label: 'Bearing internal clearance',
        labelUk: 'Внутрішній зазор підшипника',
      },
      {
        key: 'bearingPreload',
        label: 'Bearing preload and axial setting',
        labelUk: 'Натяг підшипника та осьове регулювання',
      },
      {
        key: 'bearingAlignment',
        label: 'Bearing alignment and support',
        labelUk: 'Вирівнювання та опори підшипника',
        multiline: true,
      },
      { key: 'lubrication', label: 'Lubrication and sealing', labelUk: 'Змащення та ущільнення' },
    ],
  },
  {
    id: 'material-process',
    label: 'Material and process',
    labelUk: 'Матеріал і технологія',
    fields: [
      {
        key: 'stockMaterial',
        label: 'Stock and material specification',
        labelUk: 'Заготовка та вимоги до матеріалу',
      },
      common[1],
      common[2],
      { key: 'coating', label: 'Coating and protection', labelUk: 'Покриття та захист' },
      {
        key: 'manufacturingProcess',
        label: 'Manufacturing process constraints',
        labelUk: 'Вимоги до технології виготовлення',
        multiline: true,
      },
      { key: 'edgeTreatment', label: 'Edge treatment', labelUk: 'Обробка кромок' },
      {
        key: 'joiningRequirements',
        label: 'Welds, joints and assembly requirements',
        labelUk: 'Вимоги до зварювання, з’єднань і складання',
        multiline: true,
      },
      common[0],
    ],
  },
];
const sectionFields = new Map(
  sections.flatMap((section) => section.fields).map((field) => [field.key, field]),
);
function universalField(key: string): ManufacturingFieldDefinition {
  const field = sectionFields.get(key);
  if (!field) throw new Error(`Unknown manufacturing catalog field: ${key}`);
  return field;
}
const definitions: Record<ManufacturingProfileType, ManufacturingProfileDefinition> = {
  general: { label: 'General part', labelUk: 'Загальна деталь', fields: common },
  shaft: {
    label: 'Shaft / axle',
    labelUk: 'Вал / вісь',
    fields: [
      {
        key: 'journalFits',
        label: 'Journal and seat fits',
        labelUk: 'Посадки шийок і посадкових поверхонь',
      },
      { key: 'datumRunout', label: 'Datums and runout', labelUk: 'Бази та биття', multiline: true },
      {
        key: 'keyway',
        label: 'Keyway / spline requirements',
        labelUk: 'Вимоги до шпонкового паза / шліців',
      },
      { key: 'thread', label: 'Thread specification', labelUk: 'Позначення різьби' },
      { key: 'endFaces', label: 'End-face requirements', labelUk: 'Вимоги до торців' },
      ...common,
    ],
  },
  bushing: {
    label: 'Bushing / spacer',
    labelUk: 'Втулка / проставка',
    fields: [
      { key: 'boreFit', label: 'Bore fit', labelUk: 'Посадка отвору' },
      { key: 'outsideFit', label: 'Outside fit', labelUk: 'Посадка зовнішньої поверхні' },
      { key: 'coaxiality', label: 'Coaxiality and datums', labelUk: 'Співвісність і бази' },
      { key: 'endFaces', label: 'End-face requirements', labelUk: 'Вимоги до торців' },
      {
        key: 'standoffInterfaces',
        label: 'Standoff and extension interfaces',
        labelUk: 'Приєднувальні поверхні стійки та подовжувача',
        multiline: true,
      },
      ...common,
    ],
  },
  nut: {
    label: 'Nut',
    labelUk: 'Гайка',
    fields: [
      universalField('thread'),
      {
        key: 'acrossFlats',
        label: 'Across flats and wrench interface',
        labelUk: 'Розмір під ключ і поверхні для інструмента',
      },
      { key: 'nutHeight', label: 'Nut height requirements', labelUk: 'Вимоги до висоти гайки' },
      {
        key: 'bearingFace',
        label: 'Bearing-face and seating requirements',
        labelUk: 'Вимоги до опорної поверхні та прилягання',
      },
      {
        key: 'lockingMethod',
        label: 'Locking and retention method',
        labelUk: 'Спосіб стопоріння та фіксації',
      },
      ...common,
    ],
  },
  screw: {
    label: 'Screw / lead screw',
    labelUk: 'Гвинт / ходовий гвинт',
    fields: [
      universalField('thread'),
      universalField('driveLead'),
      {
        key: 'screwLength',
        label: 'Screw and threaded lengths',
        labelUk: 'Довжина гвинта та різьбової частини',
      },
      {
        key: 'headDrive',
        label: 'Head and drive interface',
        labelUk: 'Головка та інтерфейс під інструмент',
      },
      {
        key: 'tipEnd',
        label: 'Tip and end requirements',
        labelUk: 'Вимоги до наконечника та торців',
      },
      universalField('straightness'),
      ...common,
    ],
  },
  'linear-nut': {
    label: 'Ball-screw / lead-screw nut',
    labelUk: 'Гайка кулькового / ходового гвинта',
    fields: [
      universalField('driveDesignation'),
      universalField('driveLead'),
      universalField('nutMounting'),
      universalField('drivePreload'),
      universalField('driveBacklash'),
      universalField('recirculation'),
      universalField('lubrication'),
      ...common,
    ],
  },
  bearing: {
    label: 'Bearing',
    labelUk: 'Підшипник',
    fields: [
      universalField('bearingDesignation'),
      universalField('bearingSeats'),
      universalField('bearingClearance'),
      universalField('bearingPreload'),
      universalField('bearingAlignment'),
      universalField('lubrication'),
      ...common,
    ],
  },
  gear: {
    label: 'Additional gear requirements',
    labelUk: 'Додаткові вимоги до шестерні',
    fields: [],
  },
  frame: {
    label: 'Frame / bulkhead',
    labelUk: 'Рама / шпангоут',
    fields: [
      {
        key: 'overallEnvelope',
        label: 'Envelope and installation requirements',
        labelUk: 'Габаритні та монтажні вимоги',
        multiline: true,
      },
      {
        key: 'mountingInterfaces',
        label: 'Mounting interfaces',
        labelUk: 'Приєднувальні поверхні',
        multiline: true,
      },
      {
        key: 'frameAlignment',
        label: 'Frame alignment and squareness',
        labelUk: 'Вирівнювання рами та перпендикулярність',
        multiline: true,
      },
      universalField('joiningRequirements'),
      ...common,
    ],
  },
  plate: {
    label: 'Plate / cover',
    labelUk: 'Пластина / кришка',
    fields: [
      { key: 'thickness', label: 'Thickness specification', labelUk: 'Вимоги до товщини' },
      { key: 'flatness', label: 'Flatness and datums', labelUk: 'Площинність і бази' },
      {
        key: 'holePattern',
        label: 'Hole-pattern requirements',
        labelUk: 'Вимоги до розташування отворів',
        multiline: true,
      },
      { key: 'edgeTreatment', label: 'Edge treatment', labelUk: 'Обробка кромок' },
      ...common,
    ],
  },
  flange: {
    label: 'Flange',
    labelUk: 'Фланець',
    fields: [
      {
        key: 'interfaceReference',
        label: 'Mating interface reference',
        labelUk: 'Вимоги до сполучення',
      },
      {
        key: 'pilotFit',
        label: 'Pilot / bore fit',
        labelUk: 'Посадка центрувальної поверхні / отвору',
      },
      {
        key: 'boltPattern',
        label: 'Bolt-pattern requirements',
        labelUk: 'Вимоги до кріпильних отворів',
        multiline: true,
      },
      {
        key: 'sealingFace',
        label: 'Sealing-face requirements',
        labelUk: 'Вимоги до ущільнювальної поверхні',
      },
      ...common,
    ],
  },
  custom: { label: 'Custom type', labelUk: 'Власний тип', fields: common },
};

export function manufacturingProfileDefinition(
  type: ManufacturingProfileType,
): ManufacturingProfileDefinition {
  return definitions[type];
}

/** Every part type can carry these engineer-entered requirements independently of its preset. */
export function manufacturingParameterSections(): readonly ManufacturingParameterSection[] {
  return sections;
}

/** Preset fields lead; shared sections add each remaining key once for capture and validation. */
export function manufacturingProfileFields(
  type: ManufacturingProfileType,
): readonly ManufacturingFieldDefinition[] {
  const fields = new Map<string, ManufacturingFieldDefinition>();
  for (const field of [
    ...definitions[type].fields,
    ...sections.flatMap((section) => section.fields),
  ])
    if (!fields.has(field.key)) fields.set(field.key, field);
  return [...fields.values()];
}

/** Detection is a default; an explicit selection always controls the drawing profile. */
export function effectivePartType(part: Part): Exclude<PartType, 'auto'> {
  const selected = part.manufacturing?.type;
  if (selected && selected !== 'auto') return selected;
  return part.features?.gear || part.gearSpecification ? 'gear' : 'general';
}
export function activeManufacturingProfile(part: Part): ManufacturingProfile | undefined {
  const type = effectivePartType(part);
  return part.manufacturing?.profiles[type];
}
export function hasManufacturingData(part: Part): boolean {
  const type = effectivePartType(part);
  if (type !== 'general') return true;
  const profile = activeManufacturingProfile(part);
  return Boolean(
    profile &&
    (profile.customName?.trim() ||
      Object.values(profile.fields).some((v) => v.trim()) ||
      profile.parameters.length),
  );
}

function invalid(message: string): never {
  throw new Error(`Invalid manufacturing data: ${message}`);
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return invalid('expected an object.');
  return value as Record<string, unknown>;
}
function text(value: unknown, maximum: number): string {
  if (
    typeof value !== 'string' ||
    value.length > maximum ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\uD800-\uDFFF\uFFFE\uFFFF]/u.test(value)
  )
    return invalid('use bounded plain text.');
  return value.trim();
}

/** Each type keeps its own validated values; changing the active type does not erase another. */
export function parseManufacturingProfile(
  type: ManufacturingProfileType,
  value: unknown,
): ManufacturingProfile {
  const raw = record(value);
  if (Object.keys(raw).some((key) => !['fields', 'customName', 'parameters'].includes(key)))
    return invalid('unknown profile field.');
  const rawFields = record(raw.fields),
    allowed = new Map(manufacturingProfileFields(type).map((field) => [field.key, field]));
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawFields)) {
    const field = allowed.get(key);
    if (!field) return invalid('the field does not belong to the selected profile.');
    const clean = text(value, field.multiline ? 1000 : 400);
    if (clean) fields[key] = clean;
  }
  if (!Array.isArray(raw.parameters) || raw.parameters.length > 20)
    return invalid('use at most 20 additional parameters.');
  const seen = new Set<string>();
  const parameters: ManufacturingProfile['parameters'] = [];
  for (const value of raw.parameters) {
    const row = record(value);
    if (Object.keys(row).some((key) => !['id', 'label', 'symbol', 'value'].includes(key)))
      return invalid('unknown parameter field.');
    const id = text(row.id, 128),
      label = text(row.label, 80),
      entry = text(row.value, 400);
    const symbol = row.symbol === undefined ? undefined : text(row.symbol, 24);
    if (!id || seen.has(id) || ['__proto__', 'constructor', 'prototype'].includes(id))
      return invalid('parameter identifiers must be unique.');
    seen.add(id);
    if (!label && !entry && !symbol) continue;
    if (!label) return invalid('give each additional parameter a name.');
    parameters.push({ id, label, value: entry, ...(symbol ? { symbol } : {}) });
  }
  const customName = raw.customName === undefined ? undefined : text(raw.customName, 80);
  return { fields, parameters, ...(customName ? { customName } : {}) };
}
export function parseManufacturingData(value: unknown): ManufacturingData {
  const raw = record(value);
  if (Object.keys(raw).some((key) => !['type', 'profiles'].includes(key)))
    return invalid('unknown manufacturing field.');
  if (!PART_TYPES.some((type) => type.id === raw.type))
    return invalid('choose a supported part type.');
  const profiles = record(raw.profiles),
    result: ManufacturingData = { type: raw.type as PartType, profiles: {} };
  for (const [type, profile] of Object.entries(profiles)) {
    if (!Object.hasOwn(definitions, type)) return invalid('unknown profile type.');
    result.profiles[type as ManufacturingProfileType] = parseManufacturingProfile(
      type as ManufacturingProfileType,
      profile,
    );
  }
  return result;
}
