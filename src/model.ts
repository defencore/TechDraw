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
}
export type PaperFormat = 'A4' | 'A3' | 'A2' | 'A1';
export type TemplateId = 'eskd' | 'iso' | 'minimal';
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
}
export interface PartDrawing {
  partId: string;
  dimensions: Dimension[];
}
