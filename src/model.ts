export type Point2 = [number, number];
export type Point3 = [number, number, number];
export type ViewId = 'front' | 'top' | 'right' | 'iso';
export interface Bounds2 {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}
export interface ProjectedEdge {
  id: string;
  points: Point2[];
  kind: 'line' | 'circle' | 'curve';
  hidden: boolean;
  role?: 'hard' | 'outline';
  closed?: boolean;
  center?: Point2;
  radius?: number;
  length?: number;
  sourcePoints?: Point3[];
}
export interface Projection {
  id: ViewId;
  name: string;
  edges: ProjectedEdge[];
  bounds: Bounds2;
  anchors?: { id: string; point: Point2; source: Point3 }[];
}
export interface Part {
  id: string;
  name: string;
  sourceName: string;
  sourceKind?: 'step' | 'dxf';
  sourceId?: string;
  sourceNotes?: string[];
  path: string[];
  unit: 'mm';
  bounds: { min: Point3; max: Point3 };
  views: Projection[];
  warnings: string[];
  features?: {
    circles: {
      id: string;
      center: Point3;
      normal: Point3;
      radius: number;
      closed: boolean;
    }[];
  };
}
export interface ImportResult {
  parts: Part[];
  warnings: string[];
  sourceName: string;
}
export type DimensionKind = 'horizontal' | 'vertical' | 'aligned' | 'diameter' | 'radius' | 'angle';
export type DimensionTolerance =
  | { kind: 'symmetric'; magnitude: string }
  | { kind: 'deviation'; upper: string; lower: string }
  | { kind: 'fit'; designation: string };
export interface Dimension {
  id: string;
  viewId: ViewId;
  kind: DimensionKind;
  a: Point2;
  b: Point2;
  vertex?: Point2;
  value: number;
  offset: number;
  textOffset?: Point2;
  automatic: boolean;
  prefix?: string;
  suffix?: string;
  tolerance?: DimensionTolerance;
}
export type PaperFormat = 'A4' | 'A3' | 'A2' | 'A1';
export type TemplateId = 'eskd' | 'eskd-uk' | 'iso' | 'minimal';
export interface DrawingSettings {
  format: PaperFormat;
  orientation: 'landscape' | 'portrait';
  template: TemplateId;
  scale: number | 'auto';
  precision: number;
  hiddenLines: boolean;
  centerLines: boolean;
  title: string;
  number: string;
  material: string;
  author: string;
  revision: string;
  tolerance: string;
  notes: string;
  organization: string;
  mass: string;
  litera: string;
  sheetNumber: string;
  sheetCount: string;
  date: string;
  signature: string;
  checkedBy: string;
  checkedDate: string;
  checkedSignature: string;
  technicalControl: string;
  technicalControlDate: string;
  technicalControlSignature: string;
  standardControl: string;
  standardControlDate: string;
  standardControlSignature: string;
  approvedBy: string;
  approvedDate: string;
  approvedSignature: string;
  changeSheet: string;
  changeDocument: string;
  changeSignature: string;
  changeDate: string;
  inventoryNumber: string;
  inventorySignature: string;
  inventoryDate: string;
  replacedInventoryNumber: string;
  duplicateInventoryNumber: string;
  duplicateSignature: string;
  duplicateDate: string;
  copiedBy: string;
}
export interface DrawingLayout {
  scale: number;
  viewTransforms: Record<ViewId, { x: number; y: number; scale: number }>;
}
export interface DrawingAnnotation {
  id: string;
  kind: 'text' | 'arrow' | 'rectangle' | 'ellipse' | 'freehand';
  points: Point2[];
  text?: string;
  strokeWidth: number;
  fontSize?: number;
}
export interface PartDrawing {
  partId: string;
  dimensions: Dimension[];
}
