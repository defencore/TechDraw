# TechDraw

A browser application for turning STEP models and planar DXF drawings into editable technical drawing sheets. Designed for `https://techdraw.defencore.com` on GitHub Pages.

The Open CASCADE WebAssembly kernel imports STEP geometry and computes precise hidden-line projections in a dedicated worker. DXF geometry is read locally as a 2D source plane. Source files stay in the browser. The application has no API server, file upload service, analytics, or cloud storage; copying or sharing a drawing image is an explicit user action.

## Features

- Import multiple `.step` and `.stp` files and select individual placed solids for export.
- Import supported ASCII `.dxf` geometry with declared units or a chosen unit override. A DXF has one authoritative source view; the app does not invent thickness or 3D projections.
- Recover product names and assembly ancestry where the STEP representation permits a match.
- Generate front, top, right and isometric views in a first-angle arrangement.
- Suggest overall dimensions, visible full-circle diameters, hole-centre coordinates and verified orthogonal features. Coaxial shaft circles provide exact journal diameters and shoulder or groove stations.
- Choose a balanced automatic dimension set or all recognized baseline coordinates; reposition the result to suit the part.
- Use six visible dimension icons in a compact floating dock: Horizontal, Vertical, Aligned, Diameter, Radius and Angle. Tooltips identify each tool and its shortcut. Preview before placement, drag labels or dimension lines, remove dimensions, and undo or redo changes.
- Edit a selected dimension in a compact panel with tolerance-mode buttons for None, ±, upper/lower deviations or a manually entered fit designation. Tolerances remain editable in saved projects and appear in PDF exports.
- Arrange smaller dimensions inside larger spans, with separate lanes for overlapping dimensions.
- Select dimension groups, move them together, and place compatible dimensions on a chosen side with shared alignment or cascade spacing.
- Find dimensions by value, tolerance, note, view or type. Use directional box selection, contextual actions and command search for larger drawing sets.
- Show a paper grid and snap annotation placement to a configurable step; grid preferences are remembered independently of drawing data.
- Set paper size A4, A3, A2 or A1, orientation, scale, decimal precision, hidden edges and centre lines.
- Choose GOST 2.104-68 Form 1 templates with English or Ukrainian frame labels, plus ISO-style or minimal sheets. Switch the interface independently with **EN / UA**.
- Edit title-block data, sign-off names, signatures, dates, change records, inventory fields and technical notes. Entries are saved in this browser and reused for subsequent parts and sessions; **Clear** resets the fields and their cache.
- Inspect the sheet with cursor-anchored zoom from 25% to 1600%, panning and Fit.
- Export a vector PDF with one page per selected part and the same layout as the preview.
- Add paper-space review text, arrows, rectangles, ellipses and freehand marks, with undo/redo and inline editing.
- Save and reopen `.techdraw.zip` archives containing editable drawing data, original STEP/DXF files and a project description. Validated `.techdraw.json` projects can still be opened.
- Copy, save or share a PNG of the visible area, selected items, whole sheet or a captured region, including dimensions and review marks.
- Use light or dark interface themes and Paper or Blueprint drawing appearance. Choose export appearance independently.
- Open a read-only drawing viewer for workshop use, with optional system fullscreen and a screen-awake request where supported.

Automatic dimensions are geometric suggestions. The app does not import semantic STEP PMI or infer tolerances, fits, threads, surface finish, material, datum systems, sections or manufacturing process. Review and complete every drawing before manufacture. The Form 1 templates reproduce the specified frame geometry; they do not certify a complete drawing's compliance with every ESKD manufacturing requirement. See [engineering scope](docs/ENGINEERING.md).

## Use

1. Choose **Import files**, drop STEP/DXF files into the workspace, or try an example. For a DXF with unknown or different units, set **Import settings → DXF units** before importing.
2. In the parts panel, open a part and check the parts to include in the drawing set.
3. Set the sheet format and template. Complete **Title block** and technical notes. Saved title-block entries are reused automatically; choose **Clear** in the title-block editor when starting a new specification. GOST A4 sheets use portrait orientation.
4. Review automatic dimensions. Choose a dimension icon in the floating drawing dock; its tooltip shows the tool name and shortcut. Pick a straight edge, circular edge, or snap points as appropriate, then move the draft preview and click to place it. Select an existing dimension to edit it, or drag its label or line to reposition it.
5. Use **Markup** for review text or graphics. Add handover instructions under **Project description** in the parts panel.
6. Choose **Export** for PDF/SVG and Paper/Blueprint appearance, or **Copy image** for a PNG preview. Use **Save** (`Ctrl/⌘+S`) to download the complete local project archive; **Open project** restores it.

## Local projects and source files

**Save** downloads `workspace.techdraw.zip`. It contains `project.json` with committed dimensions, tolerance text, review annotations, title-block data and fixed view layouts; original imported files under `sources/`; `manifest.json` with source associations, byte sizes and SHA-256 digests; and a readable `README.txt` containing the project description. Original source bytes are preserved without conversion. A multi-part STEP assembly shares its original file across its placed parts.

**Open project** accepts the ZIP archive or the supported validated JSON project format. JSON contains editable projected drawing data, but does not embed original CAD files. If an opened project has unavailable originals, a later archive records them as missing instead of reconstructing a source file from projections. Project descriptions are separate from the title block's printed technical notes.

Projects and original source bytes are held in the current browser session until saved. The title-block, theme, interface-language and grid preferences have separate browser storage; that storage is not a saved drawing project. Archive input is limited to 128 MB, with at most 256 MB of expanded content, 100 MB of drawing JSON and 64 MB per original source. Paths, source associations and digests are checked before the workspace is replaced.

## DXF scope

DXF import supports visible, planar model-space `LINE`, `CIRCLE`, `ARC`, `LWPOLYLINE` and classic 2D `POLYLINE` entities, including signed bulge arcs. Radius and length metadata remain analytic; sampled curves are only display linework. `TEXT` and `MTEXT` content is retained under **Title block → DXF source notes**. Original text placement, formatting, layer colors and line styles remain available in the archived source file.

`$INSUNITS` values for millimetres, centimetres, metres, inches and feet are converted to millimetres. **DXF units** can override the file. An unspecified unit defaults to millimetres with an import notice; other declared units require an explicit supported override. See Autodesk's [unit definitions](https://help.autodesk.com/cloudhelp/2023/ENU/AutoCAD-Core/files/GUID-A58A87BB-482B-4042-A00A-EEF55A2B4FD8.htm) and [polyline/bulge reference](https://help.autodesk.com/cloudhelp/2024/ENU/AutoCAD-DXF/files/GUID-0741E831-599E-4CBF-91E1-8ADBCFD6556D.htm).

Binary DXF, nonplanar geometry, nonstandard extrusion directions, wide/fitted/3D polylines and unsupported visible entities such as blocks (`INSERT`), splines, hatches, ellipses and existing `DIMENSION` entities are rejected with an explanation. Export or explode them into the supported planar entities in the source CAD application. Paper-space, invisible and hidden/frozen-layer entities are omitted with a notice. SVG is an output format, not a model import format.

## Drawing controls

| Control                                                | Action                                                         |
| ------------------------------------------------------ | -------------------------------------------------------------- |
| Horizontal, Vertical, Aligned, Diameter, Radius, Angle | Start a dimension with the chosen measurement tool             |
| `H` / `V` / `L` / `D` / `R` / `A`                      | Horizontal / Vertical / Aligned / Diameter / Radius / Angle    |
| Mouse wheel                                            | Zoom around the cursor, from 25% to 1600% of the fitted sheet  |
| Space + drag, middle mouse drag, or hand tool          | Pan the sheet                                                  |
| Drag empty space with the selection tool               | Pan the sheet                                                  |
| Shift / Ctrl-click dimensions, or dimension checkboxes | Add or remove dimensions from a selection group                |
| `B`, then drag left to right / right to left           | Select fully enclosed / intersected dimensions                 |
| `F`                                                    | Fit the selected dimensions in the viewport                    |
| `Shift` + `F`                                          | Show or hide the side panels                                   |
| `P`                                                    | Activate the hand tool                                         |
| `G` / `S`                                              | Toggle the paper grid / grid snapping                          |
| Alt while placing or dragging                          | Temporarily bypass grid snapping                               |
| `0` or **Fit sheet**                                   | Show the whole sheet and reset panning                         |
| `+` / `-` or the zoom controls                         | Zoom around the viewport centre                                |
| `Esc`                                                  | Cancel the current action, clear selection or leave focus mode |
| `Delete` / `Backspace`                                 | Remove selected dimensions in one undoable edit                |
| `Ctrl` / `⌘` + `A`                                     | Select all dimensions in the active part                       |
| `Ctrl` / `⌘` + `K`                                     | Search available commands and shortcuts                        |
| `Ctrl` / `⌘` + `S`                                     | Save the editable drawing project                              |
| `Ctrl` / `⌘` + `Z`, with `Shift` to redo               | Undo or redo dimension and layout changes                      |

Zoom changes the on-screen view only. **Drawing scale** controls the printed size. Adding, dragging, deleting or editing a dimension or review mark keeps the part views fixed; **Refresh automatic suggestions**, **Auto layout**, or a change to paper format, orientation, template or drawing scale can lay out the sheet again. Undo restores the previous dimensions, review annotations and view layout.

The drawing dock keeps selection, panning and dimension tools together over the workspace. Separate compact docks contain the grid and zoom controls.

The Dimensions panel follows the selection: one dimension opens its editing controls, a group exposes arrangement tools, and no selection shows the dimension browser. Search by nominal value, tolerance or note, and combine view/type filters. Filters change the list only; selected dimensions stay selected, including any hidden by filters. The panel reports their count, and **Show all** restores the full list.

In **Box select** (`B`), drag left to right to enclose complete annotations, including their extension lines. Drag right to left to select intersected annotations. Hold Shift, Ctrl or ⌘ to add the box results to the current group. After selection, the normal Select tool resumes so the group can be dragged immediately. Right-click a dimension or empty sheet space for contextual commands; the floating selection bar provides Edit, Focus and Delete. **Focus** (`F`) changes only viewport zoom. The canvas background is transparent; the drawing can extend behind the floating controls while Fit keeps it clear of them. **Focus drawing** (`Shift+F`) hides the side panels; opening a properties panel shows them again.

**Commands** (`Ctrl/⌘+K`) searches tools and actions, shows their shortcuts, and explains why an unavailable action is disabled. Arrow keys navigate, Enter runs the chosen available command, and Esc closes the search. These CAD interaction patterns are informed by [Autodesk selection filters](https://help.autodesk.com/cloudhelp/ENU/Fusion-Model/files/SLD-SELECTION-FILTERS.htm) and [selection-dependent properties](https://help.autodesk.com/cloudhelp/2025/ENG/AutoCAD-Core/files/GUID-DC3674C5-A4C7-4CF6-9148-9B124DF29B78.htm).

**Refresh automatic suggestions** updates geometric suggestions while retaining manual dimensions and explicit specifications. **Auto layout** repositions the existing views and annotation labels. Auto drawing scale selects a fitting scale from the GOST 2.302-68 part-drawing series, including 1:2.5, 1:4, 2.5:1 and 4:1. The isometric view can use a separate column when that improves the fit. Warnings above the workspace remain available while editing; use their layout or page-setup actions to address space problems and review the result.

For a selected group, choose **Cascade** for separate dimension lines or **Align** for a shared baseline, then choose a side in **Arrange dimensions**. Horizontal dimensions support Top/Bottom, vertical dimensions support Left/Right, and radius/diameter labels support all four sides. Aligned dimensions use geometrically compatible sides; angles stay unchanged. Nested or colliding spans keep separate lines even in Align mode. **Select view** selects the dimensions in the chosen orthographic view. Dragging a selected dimension moves its group in one undoable operation; measurements and source points stay fixed.

Grid spacing uses millimetres on the printed sheet, independently of zoom and drawing scale. Show Grid and Snap to Grid are separate controls; both start off, with a 5 mm default step. Enter a custom step from 0.1 to 100 mm, or use a suggested value such as 1, 5 or 10 mm. Hold Alt to move freely. The visible grid may simplify at low zoom, while snapping retains the requested step. The grid is a workspace aid and is absent from SVG, PDF and printed output.

To specify a dimensional tolerance, select the dimension and use the **Tolerance** mode buttons in its editing panel. With **±**, enter only the numeric magnitude, such as `0.05`; the ± symbol is supplied automatically. For upper/lower deviations, set each sign with its sign controls and enter the values. For a fit, enter a designation such as `H7`. Review the preview and choose **Apply**. Changing the mode or typing a draft does not change the drawing until applied. **Clear** in the tolerance editor removes the applied tolerance. Linear deviations use millimetres; angular deviations use degrees. Fits apply to linear dimensions and are entered explicitly: the app does not infer a fit from STEP geometry or calculate its limit deviations. The measured nominal value stays tied to the geometry. Applied tolerance edits support undo/redo, project saving and PDF export.

Expand **Position and notes** in the selected-dimension panel to set its paper offset, prefix or note after the value.

Unapplied tolerance entries are retained per dimension while you zoom, pan, change inspector tabs or theme, select parts for export, or edit another dimension and return. Switching tolerance modes preserves values already entered in the other modes. Drafts are kept for the current session; Apply commits them to the drawing and saved project.

Tool, selection, Delete and drawing Undo shortcuts leave native text editing unchanged while an input, text area or editable field has focus. Save project and command search remain available with Ctrl/⌘+S and Ctrl/⌘+K. Use the arrow keys or Home/End to move between tolerance modes, then enter the required values and apply them.

The title-block cache contains document fields and the selected template. Browser storage must be available for automatic reuse across reloads. **Save** retains the complete editable drawing and all available original source files in the ZIP archive.

STEP units are normalized by the CAD kernel; DXF units are converted by its planar importer. Curves are sampled for the displayed linework; dimension values come from model or analytic projected geometry rather than screen pixels. Display precision controls rounding and does not specify a manufacturing tolerance.

Complex assemblies are split into selectable placed solids. Reused products with ambiguous ancestry are labelled and reported. A model with no closed solid is available as a reference surface model. Very large or invalid STEP models may need to be repaired or split in the source CAD application. Current import limits are 500 solids, 12,000 source edges per part, and a five-minute worker timeout.

## Review, images and workshop viewing

Open **Markup** and choose Text, Arrow, Rectangle, Ellipse or Freehand. Enter text before clicking the sheet to place it, or drag to create a graphic. Select a review annotation to move it or edit its paper position, size, text and line width. Review marks use paper millimetres and do not change CAD geometry or measured dimension values. They are included in saved projects and PDF, SVG and PNG output.

**Copy image** opens a prepared image preview. Choose Visible area, Selected items or Whole sheet, or use **Select area** / **Capture region** to crop a rectangle. Choose Paper or Blueprint, then **Copy image**, **Save PNG**, or **Share…** where the browser exposes file sharing. Dimensions and review marks are included; workspace controls and the grid are excluded. PNG is a raster preview; PDF retains the selected physical paper dimensions.

Clipboard image writing and native sharing depend on the browser, its permissions and the user gesture. If copying is blocked, the dialog keeps **Save PNG** available. Native Share is shown only when the platform can share the prepared image file.

**View** opens a read-only drawing viewer with part selection, pan/zoom, appearance controls and image sharing. Editing commands stay disabled until **Exit viewer**. Native fullscreen is requested when available; otherwise the viewer fills the browser. **Keep screen awake** requests a screen wake lock only while the viewer is active and visible. The browser or operating system can deny or release it; the status reports that condition and offers a retry. Leaving the viewer releases the lock.

The interface's **EN / UA** switch does not translate imported names, user-entered notes, dimensions or document text. Frame language remains controlled by the selected sheet template. Dark interface mode uses the Blueprint drawing palette by default; the viewer and export dialogs can choose Paper or Blueprint independently.

## Develop

Use Node.js 24 or later with npm.

```sh
npm ci
npm run dev
```

```sh
npm test
npm run build
npm run preview
```

The production output is `dist/`. Serve it over HTTP or HTTPS; opening `index.html` directly from the filesystem is not supported. The CAD kernel is loaded from the same static deployment, including its WebAssembly asset. No external CAD service is needed.

Tests exercise real STEP geometry, DXF entities and units, ZIP source preservation and tamper rejection, paper annotations, localization boundaries, image crops, wake-lock lifecycle, assemblies, exact dimensions, paper layout, viewport navigation and history. Browser review is still required for interaction, PDF rendering and platform clipboard/share/fullscreen behavior.

See [architecture](docs/ARCHITECTURE.md) for module ownership and extension points, and [deployment](docs/DEPLOYMENT.md) for GitHub Pages and the custom domain.

## Dependencies and examples

- [Replicad](https://replicad.xyz/) provides JavaScript wrappers for CAD geometry.
- [replicad-opencascadejs](https://github.com/sgenoud/replicad-opencascadejs) provides the Open CASCADE WebAssembly build.
- [jsPDF](https://github.com/parallax/jsPDF) and [svg2pdf.js](https://github.com/yWorks/svg2pdf.js) generate vector PDF output.
- [fflate](https://github.com/101arrowz/fflate) reads and writes local project ZIP archives.
- Interface fonts are bundled locally through Fontsource. Exported PDFs embed Noto Sans for Latin, Greek and Cyrillic text. See [third-party notices](THIRD_PARTY_NOTICES.md).
- Original STEP and DXF examples and their CC0 designation are described in [the examples directory](public/examples/README.md).

The design follows FreeCAD TechDraw's separation of pages, templates, projected views, and dimensions. It runs independently of FreeCAD. See the linked primary references in [engineering scope](docs/ENGINEERING.md).
