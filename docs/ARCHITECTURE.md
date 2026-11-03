# Architecture and extension guide

The application is a static TypeScript/Vite project with a small shared data model. Keep CAD operations, drawing rules, rendering, export, and interaction separate so an individual change can be reviewed and tested in its own module.

## Module map

| Module                      | Responsibility                                                                                     |
| --------------------------- | -------------------------------------------------------------------------------------------------- |
| `src/model.ts`              | Serializable types for parts, projections, dimensions and sheet settings                           |
| `src/measurements.ts`       | Orthographic linear and angular measurement rules and geometry validation                          |
| `src/project.ts`            | Versioned project serialization and validation of imported workspace data                          |
| `src/cad/client.ts`         | Worker lifecycle, request IDs, progress, cancellation and timeout                                  |
| `src/cad/worker.ts`         | Load the bundled WASM kernel and handle import/demo requests                                       |
| `src/cad/engine.ts`         | STEP transfer, unit normalization, solid selection, precise HLR projections and analytic edge data |
| `src/cad/step-metadata.ts`  | Product names and assembly relationships; never geometric parsing                                  |
| `src/drawing/dimensions.ts` | Automatic geometric dimension suggestions, coverage warnings and numeric labels                    |
| `src/drawing/render.ts`     | Paper dimensions, first-angle layout, templates, SVG linework and annotations                      |
| `src/drawing/pdf.ts`        | Convert the same SVG sheet into correctly sized PDF pages                                          |
| `src/state.ts`              | Drawing defaults, workspace shape and per-part dimension undo/redo                                 |
| `src/main.ts`               | Workspace interaction, import queue, selected parts, project files and accessible controls         |
| `src/ui/`                   | Workspace views, accessible control templates, escaping and icons                                  |
| `src/style.css`             | Responsive layout and both colour themes                                                           |
| `test/`                     | Geometry and drawing regression tests                                                              |
| `public/examples/`          | Real, original STEP test fixtures                                                                  |

## Data flow

1. A local file becomes a transferable `ArrayBuffer` sent to the CAD worker.
2. The worker loads Open CASCADE from a bundled WASM asset. STEP transfer normalizes length units to millimetres.
3. Transferred solids retain their world placement. Product definitions are matched to transferred solid geometry when possible; unresolved names and repeated ancestry produce warnings.
4. The precise HLR algorithm produces hard edges and apparent outlines for four cameras. Smooth tangency boundaries are excluded and coincident strokes are removed. Analytic source circles retain centres, unit axes and radii for shaft recognition. Source vertices provide snap coordinates. Curves are adaptively sampled for display only.
5. The worker returns plain `ImportResult` data. Open CASCADE handles are disposed inside the worker and do not enter UI state or saved projects.
6. Automatic dimension rules create editable `Dimension` objects in model units. Balanced suggestions prioritize readability; the full-detail mode includes all recognized baseline coordinates. Dimension lanes arrange nested measurements so shorter dimensions sit closer to the part. Paper offsets and label movement remain independent of drawing scale.
7. The SVG renderer combines a part, dimensions and settings into a sheet. Preview and PDF export call the same renderer.

## Contract invariants

- A `Part` uses millimetres and contains `front`, `top`, `right` and `iso` projections.
- Projection coordinates use a Cartesian Y-up convention. The renderer handles conversion to SVG Y-down coordinates.
- Model measurements never depend on viewport zoom or CSS pixels.
- Isometric views are illustrative; dimension tools operate in orthographic views.
- A source edge's sampled display length must not substitute for an analytic dimension value.
- Sheet dimensions and PDF dimensions use millimetres at the selected paper size.
- Imported names, project text, title fields and notes must be escaped before SVG or HTML output.
- Project loading must validate data before replacing the workspace, including finite bounded coordinates, unique identifiers, selected-part references, supported settings and agreement between dimension values and their measurement geometry.
- Cancellation terminates synchronous WASM work by terminating the worker. The next import creates a new worker.
- Source model data must not be sent over a network by application code.

## Extending the application

For a new dimension type, update `DimensionKind`, the measurement rules in `measurements.ts`, the relevant geometry selection rule, automatic suggestions if appropriate, SVG rendering, project validation and focused tests. Preserve the measurement source and avoid storing a manually typed replacement as if it were a measured value.

For a new template, update `TemplateId`, sheet layout, UI selection and project validation. Template geometry must stay within the chosen paper rectangle. Preserve the shared view layout and PDF export path.

For improved STEP metadata, extend `step-metadata.ts` and the transfer matching logic without replacing the kernel's geometry parser. Add a real STEP fixture for nested or repeated assembly cases. Do not assign product names to solids by ordinal coincidence.

For section views, semantic PMI, datum systems, thread recognition or geometric tolerances, introduce explicit data types and UI workflows. Geometry alone must not silently create manufacturing requirements.

## Verification

Run `npm test` and `npm run build` after a change. Add a regression test when the change affects measurements, source units, projection conventions, assembly placement or paper layout. For low-impact copy or style changes, use a focused browser review.

For interaction or PDF changes, inspect the browser and an exported PDF. Test at least one small and one large sheet and both orientations. Compare actual PDF page dimensions and numeric measurements independently of the preview.

Keep code and comments in English. Keep modules explicit and avoid compatibility branches for formats or APIs that are not supported by the product.
