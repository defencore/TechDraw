# Architecture and extension guide

The application is a static TypeScript/Vite project with a small shared data model. Keep CAD operations, drawing rules, rendering, export, and interaction separate so an individual change can be reviewed and tested in its own module.

## Module map

| Module                                                     | Responsibility                                                                                      |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `src/model.ts`                                             | Serializable parts, projections, dimensions, paper annotations, sheet settings and view layouts     |
| `src/measurements.ts`                                      | Orthographic linear and angular measurement rules and geometry validation                           |
| `src/project.ts`                                           | Versioned project serialization and validation of imported workspace data                           |
| `src/io/source-repository.ts`                              | Copied original STEP/DXF bytes and stable source IDs, separate from transferred worker inputs       |
| `src/io/project-archive.ts`                                | Local ZIP creation/opening, source manifests, SHA-256 checks, limits and missing-source records     |
| `src/io/dxf-import.ts`                                     | Explicit planar ASCII DXF subset, source units, exact circle/bulge metadata and source notes        |
| `src/cad/client.ts`                                        | Worker lifecycle, request IDs, progress, cancellation and timeout                                   |
| `src/cad/worker.ts`                                        | Load the bundled WASM kernel and handle the single STEP import request path                         |
| `src/cad/engine.ts`                                        | STEP transfer, unit normalization, solid selection, precise HLR projections and analytic edge data  |
| `src/cad/step-metadata.ts`                                 | Product names and assembly relationships; never geometric parsing                                   |
| `src/drawing/dimensions.ts`                                | Automatic geometric dimension suggestions, coverage warnings and numeric labels                     |
| `src/drawing/suggestions.ts`                               | Refresh automatic suggestions while retaining manual measurements and explicit specifications       |
| `src/drawing/tolerances.ts`                                | Validation of explicit numeric deviations and manually entered fit designations                     |
| `src/drawing/dimension-label.ts`                           | Shared nominal/tolerance text runs and bounds for rendering, picking and layout                     |
| `src/drawing/dimension-geometry.ts`                        | Shared physical annotation primitives and bounds for SVG rendering and placement                    |
| `src/drawing/grid-coordinates.ts`                          | Sheet grid validation and numeric quantization, independent of the interface                        |
| `src/drawing/dimension-placement.ts`                       | Pure side placement, shared alignment and cascade spacing for selected annotation groups            |
| `src/drawing/page-layout.ts`                               | Pure paper areas, standard scales, projection bounds, aligned view packing and fit checks           |
| `src/drawing/layout.ts`                                    | Arrange annotations at each candidate scale and initialize their persistent physical layout         |
| `src/drawing/render.ts`                                    | Serialize the physical layout, templates, geometry and annotations into an SVG sheet                |
| `src/drawing/annotations.ts`                               | Paper-space review bounds, vector markup, escaping and appearance-aware rendering                   |
| `src/drawing/appearance.ts`                                | Paper/Blueprint palettes applied without changing document text or geometric coordinates            |
| `src/drawing/gost-form1.ts`                                | GOST 2.104-68 Form 1 frame geometry and English/Ukrainian sheet labels                              |
| `src/drawing/title-block-data.ts`                          | Shared editable document fields, defaults and field keys                                            |
| `src/drawing/pdf.ts`                                       | Convert the same SVG sheet into correctly sized PDF pages                                           |
| `src/state.ts`                                             | Drawing defaults, workspace shape and per-part dimension/layout snapshot history                    |
| `src/workspace-document.ts`                                | Document edits, per-part history, physical layout lifecycle, part removal and project replacement   |
| `src/main.ts`                                              | Application orchestration, shared command dispatch, import/export and controller integration        |
| `src/ui/command-registry.ts`                               | Canonical commands, availability reasons, active state, shortcuts and typing-safe shortcut matching |
| `src/ui/command-palette.ts`                                | Persistent searchable command dialog with keyboard navigation and live availability checks          |
| `src/ui/context-menu.ts`                                   | Contextual command menu with shared availability, keyboard navigation and focus return              |
| `src/ui/drawing-canvas.ts`                                 | Persistent canvas controller for pointer gestures, draft placement, selection and viewport updates  |
| `src/ui/drawing-toolbar.ts`                                | Compact floating icon dock with tooltips and separate viewport-control dock                         |
| `src/ui/drawing-feedback.ts`                               | Persistent sheet warnings with layout and page-setup actions                                        |
| `src/ui/annotation-tools.ts`, `annotation-editor.ts`       | Review-tool creation, paper-space picking/dragging and inline text/graphic editing                  |
| `src/ui/capture-region.ts`                                 | Exclusive crop gesture and viewport-to-paper rectangle conversion                                   |
| `src/ui/drawing-image.ts`                                  | Sheet-clipped crop bounds, bounded SVG-to-PNG rasterization and clipboard image writing             |
| `src/ui/drawing-share.ts`                                  | Prepared image preview with copy, download and capability-checked native sharing                    |
| `src/ui/screen-awake.ts`                                   | Viewer-only screen wake-lock lifecycle, visibility handling, release and retry states               |
| `src/ui/i18n.ts`, `i18n-uk.ts`                             | EN/UA presentation, language preference and protected user/SVG text boundaries                      |
| `src/ui/dimension-editor.ts`                               | Compact selected-dimension panel with tolerance controls and optional position/text settings        |
| `src/ui/dimension-browser.ts`                              | Pure dimension filtering plus searchable list rendering with visible and hidden-selection counts    |
| `src/ui/dimension-placement-editor.ts`                     | Group selection, view selection, side actions, alignment mode and paper-spacing controls            |
| `src/ui/viewport.ts`                                       | Pure fit, pan, cursor-anchored zoom and viewport/sheet coordinate conversion                        |
| `src/ui/geometry-picking.ts`                               | Screen-radius picking of edges, endpoints and centres with model-coordinate references              |
| `src/ui/dimension-picking.ts`                              | Screen-space picking of annotation labels and lines                                                 |
| `src/ui/dimension-selection.ts`                            | Annotation group membership and focus with explicit checkbox state and stale-ID pruning             |
| `src/ui/marquee-selection.ts`                              | Directional containment/crossing selection against annotation lines, arcs and rotated labels        |
| `src/ui/dimension-drag.ts`                                 | Pure paper-space annotation dragging and draft positioning                                          |
| `src/ui/drawing-grid.ts`                                   | Workspace-only paper grid rendering and paper-coordinate snapping                                   |
| `src/ui/workspace-preferences.ts`                          | Strict browser persistence of independent grid visibility, snapping and spacing preferences         |
| `src/ui/tolerance-editor.ts`                               | Tolerance-mode buttons, numeric/sign controls, draft preview and explicit Apply/Clear actions       |
| `src/ui/tolerance-controller.ts`                           | Per-annotation raw drafts, editor lifecycle, validation, keyboard handling and explicit commits     |
| `src/ui/title-block-editor.ts`                             | Localized editor for document data, sign-offs, changes, inventory and technical requirements        |
| `src/ui/title-block-cache.ts`                              | Whitelisted browser persistence of document fields and selected template                            |
| `src/ui/views.ts`, `components.ts`, `utils.ts`, `icons.ts` | Workspace views, accessible controls, escaping and icons                                            |
| `src/style.css`                                            | Responsive layout and both colour themes                                                            |
| `src/ui/workspace-cad.css`                                 | Contextual browser, selection actions, focus mode, command dialog and menu presentation             |
| `test/`                                                    | Geometry and drawing regression tests                                                               |
| `public/examples/`                                         | Original CC0 STEP assemblies and a millimetre DXF inspection plate                                  |

## Data flow

1. Original local STEP/DXF bytes are copied into `SourceRepository` before processing. Each resulting part receives the source ID; multiple placed STEP solids can reference one original assembly file. STEP input becomes a transferable `ArrayBuffer` sent to the CAD worker. DXF follows the separate planar parser.
2. The worker loads Open CASCADE from a bundled WASM asset. STEP transfer normalizes length units to millimetres.
3. Transferred solids retain their world placement. Product definitions are matched to transferred solid geometry when possible; unresolved names and repeated ancestry produce warnings.
4. The precise HLR algorithm produces hard edges and apparent outlines for four cameras. Smooth tangency boundaries are excluded and coincident strokes are removed. Analytic source circles retain centres, unit axes and radii for shaft recognition. Source vertices provide snap coordinates. Curves are adaptively sampled for display only.
5. The worker returns plain `ImportResult` data. Open CASCADE handles are disposed inside the worker and do not enter UI state or saved projects. DXF returns the same serializable result shape with `sourceKind: 'dxf'` and one front source view, without invoking the 3D kernel or fabricating projections.
6. Automatic dimension rules create editable `Dimension` objects in model units. Balanced suggestions prioritize readability; the full-detail mode includes all recognized baseline coordinates. Refreshing suggestions retains manual measurements and explicit specifications on matched automatic measurements. Dimension lanes arrange nested measurements so shorter dimensions sit closer to the part. Paper offsets and label movement remain independent of drawing scale.
7. `dimension-geometry.ts` describes physical dimension primitives and bounds. `page-layout.ts` packs STEP views with aligned front/top X datums and front/right Y datums, or a single DXF source view, using their contours, captions, centre lines and annotations. `layout.ts` evaluates annotation packing at each candidate standard scale before SVG serialization. The chosen scale and transforms become a cached `DrawingLayout`; the renderer serializes only actual part views. Manual annotation changes reuse it, so the part does not move or shrink while an annotation is edited. Explicit Auto/Auto layout operations or changes to paper format, orientation, template or drawing scale can regenerate it.
8. `DrawingCanvas` keeps the interaction element mounted, owns pointer capture and draws temporary feedback separately from committed dimensions. Geometry selection creates a draft; moving and clicking places it. During an existing annotation's drag, only that annotation's SVG is patched. The completed edit commits one history operation.
9. `WorkspaceDocument` owns dimension and review-annotation commits, per-part histories, layout invalidation, part removal and project replacement. A `DimensionSnapshot` stores dimensions, review annotations and the optional cached layout together. History clones snapshots, keeps up to 60 operations and clears redo after a new edit. No-op annotation edits do not add snapshots. Undoing Auto/Arrange restores the previous view positions as well as the annotations. UI selection is pruned against the resulting document, independently of snapshot data.
10. Local project archives persist the validated drawing JSON, cached layouts, description and available original source files. PDF/SVG/image export calls the shared renderer with committed review annotations and an explicit appearance. Viewport zoom and pan are display state and do not affect physical drawing geometry or PDF paper size.
11. Editable title-block fields have a separate browser cache. Their shared field list comes from `title-block-data.ts`; the editor, project parser and cache use the same keys. Entries and the selected template are restored on reload and reused when new parts are imported. **Clear** resets document fields and removes the stored cache. Model files and geometry never enter this cache.

## Sheet templates and document data

`eskd` and `eskd-uk` select English or Ukrainian Form 1 frame labels independently of the EN/UA interface language. `gost-form1.ts` owns the 185 × 55 mm title block and additional frame fields; it does not own part geometry or dimension placement. See [the verified standard reference and scope](ENGINEERING.md#gost-2104-68-frame-templates). A4 GOST sheets use portrait orientation, with the title block along the short edge.

The title-block cache uses `techdraw:title-block` in local storage. It includes document values such as title, designation, material, organization, sign-offs, change records, inventory information and notes, plus the selected template. It excludes STEP bytes, parts, dimensions, view layouts, viewport position, paper format and drawing scale. Project files remain the explicit way to retain the editable drawing workspace. If browser storage is unavailable, current-session editing remains usable.

## Source files and local project archives

`Part.sourceId` associates geometry with one original file. `SourceRepository.add` copies the bytes, so transferring the CAD input buffer cannot detach the stored original. Reads return independent copies. This repository is session data; it is not written to the title-block cache or uploaded.

The default `.techdraw.zip` contains validated `project.json`, a versioned `manifest.json`, `README.txt` and referenced originals under `sources/<source-id>/`. The project JSON stores parts, dimensions, structured tolerances, review annotations, layouts, selected export parts, settings and `description`. The description is document data separate from printed technical notes. The manifest records original filenames, kinds, SHA-256 digests, sizes and part associations. Originals are included byte-for-byte; unreferenced repository entries are excluded. Parts without available source bytes are listed explicitly in `missingSources`.

Opening preflights every ZIP entry before decompression, rejects unsafe/duplicate paths and unsupported compression, and enforces resource limits. Expanded project JSON and sources are then checked against the manifest and passed through the same project whitelist before replacing the workspace. Limits are 128 MB compressed, 256 MB expanded, 100 MB project JSON and 64 MB per source. `.techdraw.json` remains an explicitly supported validated drawing-data format; it contains no embedded originals. Saving a JSON-origin workspace to ZIP preserves its drawing data and reports unavailable originals instead of synthesizing CAD files.

The DXF parser accepts ASCII `LINE`, `CIRCLE`, `ARC`, `LWPOLYLINE` and classic 2D `POLYLINE` with analytic bulge arcs. `$INSUNITS` or an explicit mm/cm/m/in/ft override determines conversion to millimetres. Unitless files assume mm with a notice; unsupported declared units require an override. Source circles, arc lengths and straight-edge endpoints remain analytic, while display tessellation has a 0.005 mm chord-error budget. The sole front projection represents the source XY drawing in the model's XZ convention; the zero second extent is not an inferred thickness.

Visible unsupported essential entities, nonplanar coordinates, nonstandard extrusion, entity thickness, wide polylines and fitted/3D/mesh polylines fail explicitly. Hidden/frozen-layer, invisible and paper-space entities are omitted with a notice. TEXT/MTEXT becomes source-note text; original placement, style and all original bytes remain in the source. Never interpret an unsupported entity as a line or silently infer a 3D solid. SVG output does not imply SVG model import support.

## Review markup and presentation

`DrawingAnnotation` is a paper-millimetre object with kind `text`, `arrow`, `rectangle`, `ellipse` or `freehand`, an ID, finite points, stroke width and optional text/font size. Annotation arrays are keyed by part ID. They are independent of model anchors and nominal dimension values. The shared renderer and picking helpers use their complete physical bounds; edits participate in the same per-part history as dimensions. Serialization validates kinds, point counts, text, sizes and references before rendering.

`renderDrawing` accepts `{annotations, appearance}` as explicit options. Paper and Blueprint alter paint only; the layout, dimensions and document text remain identical. Screen appearance can follow the interface theme, while export and image dialogs choose their own appearance. Review marks are included in SVG, vector PDF and PNG output. Workspace grids, selection overlays and controls are excluded.

`CaptureRegionController` owns a separate capture-phase gesture so cropping cannot also pan the sheet or drag an annotation. It converts the crop from viewport pixels through the SVG transform into paper coordinates. `drawing-image.ts` intersects crop/visible/selection bounds with the actual sheet and rasterizes the rendered SVG at bounded resolution. `DrawingShareController` prepares the image before enabling actions, retains a preview URL only while needed, and calls clipboard/native-share APIs from the user's click. Clipboard writing can be unavailable or denied; PNG download remains available. Native file sharing is offered only when `navigator.canShare` accepts the image file.

The workshop viewer disables document editing, hides editing controls and retains part selection, navigation, appearance and image sharing. Native fullscreen is requested when the browser permits it; browser-filling viewing remains usable otherwise. `ScreenAwakeController` requests a screen wake lock only while that viewer is active, enabled and visible. Visibility changes, exit, asynchronous request races and platform release are handled explicitly. A denied or unsupported lock is a reported capability state, never a promise that the operating system cannot sleep.

`i18n.ts` owns English source messages and Ukrainian presentation through the `uk` locale; the visible switch is EN/UA and its independent preference key is `techdraw:language`. Localized command labels keep stable command IDs. HTML localization skips SVG, inputs, editable fields and marked user content, including imported names, description text and notes. Drawing frame language is a template choice, not an effect of the interface locale.

## Canvas coordinates and controls

The canvas has three coordinate spaces: model coordinates for measurements, paper millimetres for view placement and annotations, and viewport pixels for inspection. `viewport.ts` fits both paper dimensions inside the available canvas, then applies a relative zoom and pixel pan. Wheel zoom keeps the sheet point under the cursor fixed; resizing preserves the sheet point at the viewport centre and the relative fit zoom.

Display zoom is clamped to 25–1600%. Space + drag, middle mouse drag, the hand tool, or dragging empty space in selection mode pans the sheet. `0` fits the sheet; `+` and `-` zoom around the viewport centre. These operations never change the model, drawing scale, annotation values or cached drawing layout.

Grid preferences use the separate `techdraw:grid` browser-storage key. Visibility and snapping are independent booleans; spacing is a finite number from 0.1 to 100 paper millimetres, with a 5 mm default. Both visibility and snapping are off initially. Reading or saving whitelists those three values. Unavailable storage does not prevent editing, and invalid cached data receives fresh defaults. No grid preferences enter the project geometry, SVG or PDF output.

`drawing-grid.ts` renders the grid into a workspace-only overlay clipped to the drawing area. It snaps annotation positions in global paper coordinates; geometry references and measured values remain unchanged. Display coarsening keeps low-zoom grids readable without changing the requested snapping step. Alt bypasses snapping while placing or dragging. Group dragging snaps the focused member, then applies the same paper displacement to every selected annotation to preserve relative spacing.

`DimensionSelection` owns group membership and the focused annotation together. Shift/Ctrl-click toggles membership, plain selection of an existing member preserves its group, and checkbox changes explicitly set membership. Removing or regenerating dimensions prunes stale IDs and repairs focus. Group placement works separately for each view and compatible parallel orientation: horizontal dimensions move Top/Bottom, vertical dimensions Left/Right, radial labels to any side, and aligned dimensions to compatible sides. Angles are left unchanged. Cascade assigns separate lanes, while Align shares a baseline only for disjoint complete spans with enough label clearance. Nested or colliding spans retain separate lanes. Placement changes annotation positions while retaining the cached view layout and all measured geometry and specifications.

Geometry and dimension picking use screen-pixel tolerances so their hit areas remain usable at different zoom levels. A compact floating dock exposes six visible dimension icons: Horizontal (`H`), Vertical (`V`), Aligned (`L`), Diameter (`D`), Radius (`R`) and Angle (`A`). Each icon has an accessible name, a tool/shortcut tooltip and an active state. A separate zoom dock contains viewport controls. Shortcuts are inactive while text fields are being edited. A new dimension follows a pick → draft preview → click-to-place interaction. Selecting a dimension opens its compact editing panel; existing labels and dimension lines can be dragged. `Esc` cancels the pending operation; undo/redo acts on committed dimension/layout snapshots.

The explicit Box Select tool (`B`) keeps empty-space drag in ordinary Select mode available for panning. Left-to-right boxes contain entire annotation geometry; right-to-left boxes cross exact line/arc geometry or rotated label rectangles. Shift/Ctrl/Meta adds the box result to the current group. Small clicks, cancellation and tool changes leave the selection unchanged. The application returns to Select after a completed box, so the group is immediately draggable. Fit Selection (`F`) uses the selected annotation bounds without changing the physical drawing layout. The full canvas remains visible beneath floating controls. Optional safe-area insets affect fit, cursor-anchored zoom, resize and selection focus without clipping the paper into separate top/bottom strips. Focus mode (`Shift+F`) hides side panels; opening an inspector command reveals them again.

`dimension-browser.ts` filters the annotation list by view, type and normalized query text, including nominal values, structured tolerances and notes. It does not modify group membership or the geometry. Updating the result region leaves the search caret and tolerance editor mounted. The inspector prioritizes a single annotation editor, expands group arrangement for multiple selections, and keeps unused controls in disclosures. Selected annotations hidden by filters are counted explicitly because group actions still include them.

`command-registry.ts` is the shared source for command identity, availability explanations, active states and shortcut metadata. Dock, palette, context-menu and keyboard actions reach the same dispatcher, which checks current availability again before execution. Native editing retains letter keys, selection, deletion and text undo; project saving and command search remain global while editing. The command palette (`Ctrl/⌘+K`) lives outside workspace rerenders and keeps its search field, keyboard focus and current availability. Context menus use the same command metadata; clicking a selected annotation preserves the group, clicking another focuses that annotation, and right-clicking empty sheet space preserves the current group.

## Dimension tolerances

`Dimension.tolerance` is optional. An absent property means no structured tolerance; the supported variants are symmetric magnitude, upper/lower deviations, and a fit designation. Decimal values are stored as validated strings so entered precision can be preserved. Linear deviations use millimetres; angular deviations use degrees. Fits are manually entered linear-dimension labels, with no inferred fit class or numeric limit lookup.

The tolerance editor uses visible mode buttons. Symmetric magnitude has a fixed ± adornment and accepts numeric text only; upper/lower fields have explicit sign controls. The editor holds uncommitted mode and text separately from the drawing, allowing incomplete decimal entries while typing. Mode/sign changes and typing do not create history entries or export draft values. A valid **Apply** commits one dimension/layout snapshot; **Clear** removes the applied tolerance. Saved projects and PDF output use only committed data. The free-text note after a dimension remains separate from its structured tolerance.

`ToleranceEditorController` retains raw mode and field values per part and dimension, including incomplete signs or decimals and fields in inactive modes. Before an inspector or workspace render, it captures the mounted editor's identity; restoring uses the newly selected annotation. This preserves drafts across tabs, themes, export-selection checkboxes and changes of selected annotation. Select/Pan and dragging also preserve the draft. Apply/Clear reset that annotation's draft, opening a project resets all drafts, and removing a dimension or part clears its entries. Undoing a committed tolerance refreshes the editor from the restored value. Drafts remain session-only and are excluded from saved projects and exports.

`drawing-feedback.ts` displays the renderer's actual warnings above the canvas independently of the selected inspector tab. Overflow takes priority; additional messages use a compact disclosure. Layout warnings expose **Auto layout** and **Page setup** actions. The controls do not imply that an automatic layout is a complete manufacturing specification.

`dimension-label.ts` supplies shared text runs and bounds. Symmetric ± and fit labels are inline; upper/lower deviations are stacked. Rendering, annotation picking and layout use the same label geometry so tolerance text remains selectable and its full extent is considered during placement and overflow checks.

## Contract invariants

- A STEP `Part` uses millimetres and contains `front`, `top`, `right` and `iso` projections. A DXF `Part` has `sourceKind: 'dxf'` and exactly one authoritative `front` source projection.
- Projection coordinates use a Cartesian Y-up convention. The renderer handles conversion to SVG Y-down coordinates.
- Model measurements never depend on viewport zoom or CSS pixels.
- Tolerance annotations never replace the measured nominal value. Validate committed deviations and fit designations before rendering or saving them; preserve draft text only in the editor.
- Viewport transforms and paper-space drawing layouts are separate. Manual dimension edits preserve the layout; display navigation never invalidates it.
- Isometric views are illustrative; dimension tools operate in orthographic views.
- A source edge's sampled display length must not substitute for an analytic dimension value.
- Sheet dimensions and PDF dimensions use millimetres at the selected paper size.
- Imported names, project text, title fields and notes must be escaped before SVG or HTML output. Invalid XML controls and lone Unicode surrogates cannot enter validated project text. Interface translation must not rewrite user content or drawing text.
- Project loading must validate data before replacing the workspace, including finite bounded coordinates, unique identifiers, selected-part references, supported settings and agreement between dimension values and their measurement geometry. Saved layouts require four finite transforms with a common positive scale and a known part ID. Projects without layout metadata receive a layout when first displayed.
- Cancellation terminates synchronous WASM work by terminating the worker. The next import creates a new worker.
- Source model data must not be sent over a network by application code. User-requested image sharing delegates only the prepared drawing image to the platform share UI.

## Extending the application

For a new dimension type, update `DimensionKind`, the measurement rules in `measurements.ts`, the relevant geometry picking rule, draft placement and dragging in `dimension-drag.ts`, automatic suggestions if appropriate, SVG rendering, project validation and focused tests. Preserve the measurement source and avoid storing a manually typed replacement as if it were a measured value.

For a new template, update `TemplateId`, sheet layout, UI selection and project validation. Template geometry must stay within the chosen paper rectangle. Preserve the shared view layout and PDF export path.

For a new editable document field, add its default and key to `title-block-data.ts`, expose it in `title-block-editor.ts`, and render it in the appropriate template. Keep values separate from frame language and measured geometry. The cache must continue to save only the shared document field whitelist and the selected template.

For improved STEP metadata, extend `step-metadata.ts` and the transfer matching logic without replacing the kernel's geometry parser. Add a real STEP fixture for nested or repeated assembly cases. Do not assign product names to solids by ordinal coincidence.

For another source format, introduce an explicit parser and source kind with documented units and dimensionality. Retain its original bytes through `SourceRepository`, extend validated project/archive contracts, and add exact geometry and unsupported-entity tests. Do not make an imported 2D drawing satisfy a four-view contract by duplicating or inventing geometry.

For section views, semantic PMI, datum systems, thread recognition or geometric tolerances, introduce explicit data types and UI workflows. Geometry alone must not silently create manufacturing requirements.

## Verification

Run `npm test` and `npm run build` after a change. Add a regression test when the change affects measurements, source units, projection conventions, assembly placement or paper layout. For low-impact copy or style changes, use a focused browser review.

For interaction or PDF changes, inspect the browser and an exported PDF. Test at least one small and one large sheet and both orientations. Compare actual PDF page dimensions and numeric measurements independently of the preview. For archive changes, reopen a file and compare original source bytes, annotations, description and measured values. Clipboard, native sharing, fullscreen and screen wake lock require browser/device capability review as well as pure lifecycle tests.

Keep code and comments in English. Keep modules explicit and avoid compatibility branches for formats or APIs that are not supported by the product.
