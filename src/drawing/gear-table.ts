import type { Bounds2, DrawingSettings, Part } from '../model';
import { gearReferenceDiameter, missingGearFields } from '../gears/specification';
import { effectivePartType } from '../manufacturing/catalog';
import { measuredPinHoleAngle } from './gear-dimensions';
import { parameterTableBuilder, type ParameterTableLayout } from './parameter-table-layout';
import {
  appendManufacturingRequirements,
  enteredManufacturingRequirements,
} from './manufacturing-table-rows';

/** Three groups follow GOST 2.403; row heights expand to retain entered engineering data. */
export function gearTableLayout(
  part: Part,
  settings: DrawingSettings,
  available: Bounds2,
): ParameterTableLayout | undefined {
  if (effectivePartType(part) !== 'gear') return;
  const measured = part.features?.gear;
  const spec = part.gearSpecification;
  const supplemental = enteredManufacturingRequirements(part, settings);
  const missing = missingGearFields(part);
  const countMismatch = measured && spec?.teeth !== undefined && spec.teeth !== measured.toothCount;
  const draft = missing.length > 0 || countMismatch || supplemental.incompleteParameters;
  const uk = settings.template === 'eskd-uk';
  const words = (en: string, ua: string) => (uk ? ua : en);
  const specify = words('Specify', 'Задати');
  const numeric = (value: number | undefined, unit = '') =>
    value === undefined
      ? specify
      : `${Number(value.toFixed(Math.max(4, settings.precision)))}${unit}`;
  const text = (value: string | undefined) => value?.trim() || specify;
  const builder = parameterTableBuilder('gear', available);
  const add = builder.add;
  add(
    'basic',
    draft
      ? words('BASIC GEAR DATA — DRAFT', 'ОСНОВНІ ДАНІ — ЧЕРНЕТКА')
      : words('BASIC GEAR DATA', 'ОСНОВНІ ДАНІ ЗАЧЕПЛЕННЯ'),
    '',
    '',
    true,
  );
  add(
    'type',
    words('Gear type', 'Тип колеса'),
    '',
    spec
      ? spec.type === 'external-spur'
        ? words('External spur', 'Прямозубе зовнішнє')
        : words('External helical', 'Косозубе зовнішнє')
      : specify,
  );
  add(
    'module',
    words('Normal module, mm', 'Нормальний модуль, мм'),
    'mn',
    numeric(spec?.normalModule),
  );
  add(
    'teeth',
    words('Number of teeth', 'Кількість зубців'),
    'z',
    numeric(spec?.teeth ?? measured?.toothCount),
  );
  if (countMismatch)
    add(
      'measured-teeth',
      words('Measured teeth: CHECK MISMATCH', 'Виміряні зубці: ПЕРЕВІРИТИ'),
      'z',
      numeric(measured.toothCount),
    );
  add(
    'pressure-angle',
    words('Normal pressure angle', 'Нормальний кут профілю'),
    'αn',
    numeric(spec?.normalPressureAngle, '°'),
  );
  add(
    'profile-shift',
    words('Profile shift coefficient', 'Коефіцієнт зміщення'),
    'x',
    numeric(spec?.profileShift),
  );
  if (spec?.type === 'external-helical') {
    add(
      'helix-angle',
      words('Reference helix angle', 'Кут нахилу зубців'),
      'β',
      numeric(spec.helixAngle, '°'),
    );
    add(
      'helix-hand',
      words('Helix hand', 'Напрямок зубців'),
      '',
      spec.helixHand
        ? spec.helixHand === 'left'
          ? words('Left', 'Лівий')
          : words('Right', 'Правий')
        : specify,
    );
  }
  add(
    'profile-reference',
    words('Basic rack / tooth profile', 'Вихідний контур / профіль зуба'),
    '',
    text(spec?.profileReference),
  );
  add(
    'accuracy',
    words('Accuracy / backlash and standard', 'Точність / бічний зазор і стандарт'),
    '',
    text(spec?.accuracy),
  );
  add(
    'finish',
    words('Tooth flank finish', 'Шорсткість бокових поверхонь зубців'),
    '',
    text(spec?.toothSurfaceFinish),
  );
  add(
    'tooth-edge',
    words('Tooth edge treatment', 'Обробка кромок зубців'),
    '',
    text(spec?.toothEdge),
  );
  if (spec?.heatTreatment)
    add(
      'heat-treatment',
      words('Heat treatment / hardness', 'Термообробка / твердість'),
      '',
      spec.heatTreatment,
    );
  add('inspection', words('INSPECTION DATA', 'КОНТРОЛЬНІ ДАНІ'), '', '', true);
  add(
    'inspection-dimensions',
    words('Method, dimensions and tolerances', 'Метод, розміри та допуски'),
    '',
    text(spec?.inspection),
  );
  add('reference', words('REFERENCE DATA', 'ДОВІДКОВІ ДАНІ'), '', '', true);
  add(
    'reference-diameter',
    words('Reference diameter, mm', 'Ділильний діаметр, мм'),
    'd',
    numeric(gearReferenceDiameter(spec, measured?.toothCount)),
  );
  if (measured) {
    if (measured.toothDatumDirection)
      add(
        'tooth-datum',
        words('Datum A', 'База A'),
        'A',
        words('Selected tooth-tip center', 'Середина вибраної вершини зуба'),
      );
    add(
      'outside-diameter',
      words('Measured tip diameter, mm', 'Виміряний діаметр вершин, мм'),
      'da',
      numeric(measured.outsideDiameter),
    );
    add(
      'root-diameter',
      words('Measured root diameter, mm', 'Виміряний діаметр западин, мм'),
      'df',
      numeric(measured.rootDiameter),
    );
    add(
      'face-width',
      words('Measured face width, mm', 'Виміряна ширина вінця, мм'),
      'b',
      numeric(measured.faceWidth),
    );
    for (const [index, hole] of (measured.pinHoles ?? []).entries()) {
      const suffix = (measured.pinHoles?.length ?? 0) > 1 ? ` ${index + 1}` : '';
      add(
        `pin-${index}-diameter`,
        words(`Measured radial hole${suffix}, mm`, `Виміряний радіальний отвір${suffix}, мм`),
        '',
        `Ø${numeric(hole.diameter)}`,
      );
      add(
        `pin-${index}-axis`,
        words(`Hole${suffix} axis, model XYZ`, `Вісь отвору${suffix}, XYZ моделі`),
        '',
        hole.axis.direction.map((value) => numeric(value)).join('; '),
      );
      const angle = measuredPinHoleAngle(part, index);
      if (angle !== undefined)
        add(
          `pin-${index}-angle`,
          words(`Measured hole${suffix} angle to A`, `Виміряний кут отвору${suffix} до A`),
          '',
          numeric(angle, '°'),
        );
    }
  }
  if (!supplemental.empty) {
    add(
      'supplemental',
      words('ADDITIONAL MANUFACTURING REQUIREMENTS', 'ДОДАТКОВІ ВИМОГИ ДО ВИГОТОВЛЕННЯ'),
      '',
      '',
      true,
    );
    appendManufacturingRequirements(builder, supplemental);
  }
  const warnings: string[] = [];
  if (countMismatch)
    warnings.push(
      `Gear tooth count conflicts with measured geometry: specified ${spec!.teeth}, measured ${measured.toothCount}. Resolve the mismatch before manufacture.`,
    );
  if (missing.length)
    warnings.push(
      `Gear manufacturing data is incomplete: ${missing.join(', ')}. Specify these values before manufacture.`,
    );
  if (measured?.pinHoles?.some((_, index) => measuredPinHoleAngle(part, index) === undefined))
    warnings.push(
      'Radial pin-hole orientation needs a tooth datum and an inspection requirement before manufacture. The table reports its measured model-axis direction.',
    );
  return builder.finish(
    warnings,
    'Gear parameter table exceeds the drawing area. Shorten the entered data or choose a larger sheet before export.',
  );
}
