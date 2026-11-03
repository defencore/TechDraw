# Architecture and extension guide

The application is a static TypeScript/Vite project with a small shared data model. Keep CAD operations, drawing rules, rendering, export, and interaction separate so an individual change can be reviewed and tested in its own module.

## Module map

| Module                                                     | Responsibility                                                                                     |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `src/model.ts`                                             | Serializable types for parts, projections, dimensions, sheet settings and cached view layouts      |
| `src/measurements.ts`                                      | Orthographic linear and angular measurement rules and geometry validation                          |
| `src/project.ts`                                           | Versioned project serialization and validation of imported workspace data                          |
| `src/cad/client.ts`                                        | Worker lifecycle, request IDs, progress, cancellation and timeout                                  |
| `src/cad/worker.ts`                                        | Load the bundled WASM kernel and handle import/demo requests                                       |
| `src/cad/engine.ts`                                        | STEP transfer, unit normalization, solid selection, precise HLR projections and analytic edge data |
| `src/cad/step-metadata.ts`                                 | Product names and assembly relationships; never geometric parsing                                  |
| `src/drawing/dimensions.ts`                                | Automatic geometric dimension suggestions, coverage warnings and numeric labels                    |
| `src/drawing/layout.ts`                                    | Initialize arranged dimensions and their persistent physical layout together                       |
| `src/drawing/render.ts`                                    | Paper dimensions, first-angle layout, templates, SVG linework and annotations                      |
| `src/drawing/gost-form1.ts`                                | GOST 2.104-68 Form 1 frame geometry and English/Ukrainian sheet labels                             |
| `src/drawing/title-block-data.ts`                          | Shared editable document fields, defaults and field keys                                           |
| `src/drawing/pdf.ts`                                       | Convert the same SVG sheet into correctly sized PDF pages                                          |
| `src/state.ts`                                             | Drawing defaults, workspace shape and per-part dimension/layout snapshot history                   |
| `src/main.ts`                                              | Workspace interaction, import queue, selected parts, project files and accessible controls         |
| `src/ui/drawing-canvas.ts`                                 | Persistent canvas controller for pointer gestures, draft placement, selection and viewport updates |
| `src/ui/viewport.ts`                                       | Pure fit, pan, cursor-anchored zoom and viewport/sheet coordinate conversion                       |
| `src/ui/geometry-picking.ts`                               | Screen-radius picking of edges, endpoints and centres with model-coordinate references             |
| `src/ui/dimension-picking.ts`                              | Screen-space picking of annotation labels and lines                                                |
| `src/ui/dimension-drag.ts`                                 | Pure paper-space annotation dragging and draft positioning                                         |
| `src/ui/title-block-editor.ts`                             | English editor for document data, sign-offs, changes, inventory and technical requirements         |
| `src/ui/title-block-cache.ts`                              | Whitelisted browser persistence of document fields and selected template                           |
| `src/ui/views.ts`, `components.ts`, `utils.ts`, `icons.ts` | Workspace views, accessible controls, escaping and icons                                           |
| `src/style.css`                                            | Responsive layout and both colour themes                                                           |
| `test/`                                                    | Geometry and drawing regression tests                                                              |
| `public/examples/`                                         | Real, original STEP test fixtures                                                                  |

## Data flow

1. A local file becomes a transferable `ArrayBuffer` sent to the CAD worker.
2. The worker loads Open CASCADE from a bundled WASM asset. STEP transfer normalizes length units to millimetres.
3. Transferred solids retain their world placement. Product definitions are matched to transferred solid geometry when possible; unresolved names and repeated ancestry produce warnings.
4. The precise HLR algorithm produces hard edges and apparent outlines for four cameras. Smooth tangency boundaries are excluded and coincident strokes are removed. Analytic source circles retain centres, unit axes and radii for shaft recognition. Source vertices provide snap coordinates. Curves are adaptively sampled for display only.
5. The worker returns plain `ImportResult` data. Open CASCADE handles are disposed inside the worker and do not enter UI state or saved projects.
6. Automatic dimension rules create editable `Dimension` objects in model units. Balanced suggestions prioritize readability; the full-detail mode includes all recognized baseline coordinates. Dimension lanes arrange nested measurements so shorter dimensions sit closer to the part. Paper offsets and label movement remain independent of drawing scale.
7. The SVG renderer combines a part, dimensions and settings into a sheet. Its scale and four view transforms become a cached `DrawingLayout` for that part. Manual annotation changes reuse this layout, so the part does not move or shrink while a dimension is edited. Explicit Auto/Arrange operations or changes to paper format, orientation, template or drawing scale can regenerate it.
8. `DrawingCanvas` keeps the interaction element mounted, owns pointer capture and draws temporary feedback separately from committed dimensions. Geometry selection creates a draft; moving and clicking places it. During an existing annotation's drag, only that annotation's SVG is patched. The completed edit commits one history operation.
9. A `DimensionSnapshot` stores dimensions and the optional cached layout together. History clones snapshots, keeps up to 60 operations and clears redo after a new edit. Undoing Auto/Arrange restores the previous view positions as well as the annotations.
10. Project files persist cached layouts, and PDF export passes the same layout to the shared renderer. Exported sheets therefore preserve the preview's committed geometry and dimension positions. Viewport zoom and pan are display state and do not affect the drawing or exported PDF.
11. Editable title-block fields have a separate browser cache. Their shared field list comes from `title-block-data.ts`; the editor, project parser and cache use the same keys. Entries and the selected template are restored on reload and reused when new parts are imported. **Clear** resets document fields and removes the stored cache. Model files and geometry never enter this cache.

## Sheet templates and document data

`eskd` and `eskd-uk` select English or Ukrainian Form 1 frame labels, while the application controls remain English. `gost-form1.ts` owns the 185 × 55 mm title block and additional frame fields; it does not own part geometry or dimension placement. See [the verified standard reference and scope](ENGINEERING.md#gost-2104-68-frame-templates). A4 GOST sheets use portrait orientation, with the title block along the short edge.

The title-block cache uses `techdraw:title-block` in local storage. It includes document values such as title, designation, material, organization, sign-offs, change records, inventory information and notes, plus the selected template. It excludes STEP bytes, parts, dimensions, view layouts, viewport position, paper format and drawing scale. Project files remain the explicit way to retain the editable drawing workspace. If browser storage is unavailable, current-session editing remains usable.

## Canvas coordinates and controls

The canvas has three coordinate spaces: model coordinates for measurements, paper millimetres for view placement and annotations, and viewport pixels for inspection. `viewport.ts` fits both paper dimensions inside the available canvas, then applies a relative zoom and pixel pan. Wheel zoom keeps the sheet point under the cursor fixed; resizing preserves the sheet point at the viewport centre and the relative fit zoom.

Display zoom is clamped to 25–1600%. Space + drag, middle mouse drag, the hand tool, or dragging empty space in selection mode pans the sheet. `0` fits the sheet; `+` and `-` zoom around the viewport centre. These operations never change the model, drawing scale, annotation values or cached drawing layout.

Geometry and dimension picking use screen-pixel tolerances so their hit areas remain usable at different zoom levels. A new dimension follows a pick → draft preview → click-to-place interaction. Existing labels and dimension lines can be dragged. `Esc` cancels the pending operation; undo/redo acts on committed dimension/layout snapshots.

## Contract invariants

- A `Part` uses millimetres and contains `front`, `top`, `right` and `iso` projections.
- Projection coordinates use a Cartesian Y-up convention. The renderer handles conversion to SVG Y-down coordinates.
- Model measurements never depend on viewport zoom or CSS pixels.
- Viewport transforms and paper-space drawing layouts are separate. Manual dimension edits preserve the layout; display navigation never invalidates it.
- Isometric views are illustrative; dimension tools operate in orthographic views.
- A source edge's sampled display length must not substitute for an analytic dimension value.
- Sheet dimensions and PDF dimensions use millimetres at the selected paper size.
- Imported names, project text, title fields and notes must be escaped before SVG or HTML output.
- Project loading must validate data before replacing the workspace, including finite bounded coordinates, unique identifiers, selected-part references, supported settings and agreement between dimension values and their measurement geometry. Saved layouts require four finite transforms with a common positive scale and a known part ID. Projects without layout metadata receive a layout when first displayed.
- Cancellation terminates synchronous WASM work by terminating the worker. The next import creates a new worker.
- Source model data must not be sent over a network by application code.

## Extending the application

For a new dimension type, update `DimensionKind`, the measurement rules in `measurements.ts`, the relevant geometry picking rule, draft placement and dragging in `dimension-drag.ts`, automatic suggestions if appropriate, SVG rendering, project validation and focused tests. Preserve the measurement source and avoid storing a manually typed replacement as if it were a measured value.

For a new template, update `TemplateId`, sheet layout, UI selection and project validation. Template geometry must stay within the chosen paper rectangle. Preserve the shared view layout and PDF export path.

For a new editable document field, add its default and key to `title-block-data.ts`, expose it in `title-block-editor.ts`, and render it in the appropriate template. Keep values separate from frame language and measured geometry. The cache must continue to save only the shared document field whitelist and the selected template.

For improved STEP metadata, extend `step-metadata.ts` and the transfer matching logic without replacing the kernel's geometry parser. Add a real STEP fixture for nested or repeated assembly cases. Do not assign product names to solids by ordinal coincidence.

For section views, semantic PMI, datum systems, thread recognition or geometric tolerances, introduce explicit data types and UI workflows. Geometry alone must not silently create manufacturing requirements.

## Verification

Run `npm test` and `npm run build` after a change. Add a regression test when the change affects measurements, source units, projection conventions, assembly placement or paper layout. For low-impact copy or style changes, use a focused browser review.

For interaction or PDF changes, inspect the browser and an exported PDF. Test at least one small and one large sheet and both orientations. Compare actual PDF page dimensions and numeric measurements independently of the preview.

Keep code and comments in English. Keep modules explicit and avoid compatibility branches for formats or APIs that are not supported by the product.
