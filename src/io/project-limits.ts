export const MAX_PROJECT_BYTES = 100 * 1024 * 1024;

/** Importers and the project reader share one serializable drawing budget. */
export const PROJECT_GEOMETRY_LIMITS = {
  edgesPerProjection: 40000,
  pointsPerEdge: 10000,
  anchorsPerProjection: 50000,
  circlesPerPart: 24000,
  pointsPerProject: 2000000,
} as const;
