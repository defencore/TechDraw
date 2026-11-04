# TechDraw

A browser application for turning STEP models and planar DXF drawings into editable technical drawing sheets. Designed for `https://techdraw.defencore.com` on GitHub Pages.

The Open CASCADE WebAssembly kernel imports STEP geometry and computes precise hidden-line projections in a dedicated worker. DXF geometry is read locally as a 2D source plane. Source files stay in the browser. The application has no API server, file upload service, analytics, or cloud storage; copying or sharing a drawing image is an explicit user action.

## Features

- Import multiple `.step` and `.stp` files and select individual placed solids for export.
- Import supported ASCII `.dxf` geometry with declared units or a chosen unit override. A DXF has one authoritative source view; the app does not invent thickness or 3D projections.
- Recover product names and assembly ancestry where the STEP representation permits a match.
- Generate front, top, right and isometric views in a first-angle arrangement.
- Suggest overall dimensions, visible full-circle diameters, hole-centre coordinates and verified orthogonal features. Coaxial shaft circles provide exact journal diameters and shoulder or groove stations.
- Recognize a bounded set of straight cylindrical gear profiles, measure repeated teeth and stock features, and keep supplied gear engineering data separate from those measurements.
- Choose a balanced automatic dimension set or all recognized baseline coordinates; reposition the result to suit the part.
- Use six visible dimension icons in a compact floating dock: Horizontal, Vertical, Aligned, Diameter, Radius and Angle. Tooltips identify each tool and its shortcut. Preview before placement, drag labels or dimension lines, remove dimensions, and undo or redo changes.
- Edit a selected dimension in a compact panel with tolerance-mode buttons for None, ±, upper/lower deviations or a manually entered fit designation. Tolerances remain editable in saved projects and appear in PDF exports.
- Arrange smaller dimensions inside larger spans, with separate lanes for overlapping dimensions.
- Select dimension groups, move them together, and place compatible dimensions on a chosen side with shared alignment or cascade spacing.
- Lock selected dimensions or review marks against accidental movement, editing and deletion; lock state is saved and undoable.
- Find dimensions by value, tolerance, note, view or type. Use directional box selection, contextual actions and command search for larger drawing sets.
- Show a paper grid and snap annotation placement to a configurable step; grid preferences are remembered independently of drawing data.
- Set paper size A4, A3, A2 or A1, orientation, scale, decimal precision, hidden edges and centre lines.
- Choose GOST 2.104-68 Form 1 templates with English or Ukrainian frame labels, plus ISO-style or minimal sheets. Switch the interface independently with **EN / UA**.
- Edit title-block data, sign-off names, signatures, dates, change records, inventory fields and technical notes. Entries are saved in this browser and reused for subsequent parts and sessions; **Clear** resets the fields and their cache.
- Inspect the sheet with cursor-anchored zoom from 25% to 1600%, panning and Fit.
- Export a vector PDF with one page per selected part and the same layout as the preview.
- Add colored paper-space review text, arrows, rectangles, ellipses and freehand marks, with undo/redo and inline editing.
- Write manufacturing instructions for each part and print numbered steps beside or above its title block.
- Choose a per-part manufacturing profile for shafts, bushings, nuts, screws, linear-drive nuts, bearings, plates, flanges, gears, frames or a custom type, with reusable requirement sections and additional named parameters.
- Prepare drawings for every imported part, then export one multipage PDF or save one project ZIP with shared originals.
- Save and reopen `.techdraw.zip` archives containing editable drawing data, original STEP/DXF files and a project description. Validated `.techdraw.json` projects can still be opened.
- Copy, save or share a PNG of the visible area, selected items, whole sheet or a captured region, including dimensions and review marks.
- Use light or dark interface themes and Paper or Blueprint drawing appearance. Choose export appearance independently.
- Open a read-only drawing viewer for workshop use, with optional system fullscreen and a screen-awake request where supported.

Automatic dimensions are geometric suggestions. The app does not import semantic STEP PMI or infer tolerances, fits, threads, surface finish, material, datum systems, sections or manufacturing process. Review and complete every drawing before manufacture. The Form 1 templates reproduce the specified frame geometry; they do not certify a complete drawing's compliance with every ESKD manufacturing requirement. See [engineering scope](docs/ENGINEERING.md).

## Use

1. Choose **Import files**, drop STEP/DXF files into the workspace, or try an example. For a DXF with unknown or different units, set **Import settings → DXF units** before importing.
2. In the parts panel, open a part and check the parts to include in the drawing set.
3. Set the sheet format and template. Complete **Title block** and shared technical notes. Saved title-block entries are reused automatically; choose **Clear** in the title-block editor when starting a new specification. GOST A4 sheets use portrait orientation.
4. Review automatic dimensions. Choose a dimension icon in the floating drawing dock; its tooltip shows the tool name and shortcut. Pick a straight edge, circular edge, or snap points as appropriate, then move the draft preview and click to place it. Select an existing dimension to edit it, or drag its label or line to reposition it.
5. Use **Markup** for review text or graphics. Open **Instructions** to write manufacturing steps for the active part, then choose **Apply instructions** to preview them on its drawing. **Project description** in the parts panel holds separate project handover text.
6. For an assembly or several files, choose **Drawings for all parts** to select every part and prepare its sheet. Choose **Export** for a multipage PDF, or **Copy image** for a PNG preview of the active drawing. Use **Save** (`Ctrl/⌘+S`) to download the complete local project archive; **Open project** restores it. SVG export uses the active part.

The inspector tabs are **Dimensions**, **Markup**, **Instructions**, **Part type**, **Sheet** and **Title block**.

## Manufacturing instructions and drawing sets

**Instructions** belongs to the active part. Enter one manufacturing step per line; nonempty lines become numbered steps. Short text fits beside the title block; longer text uses a full-width panel above it. Existing step numbers are retained. **Apply instructions** updates the preview, **Reset draft** restores that part's last committed text, and Undo restores its previous instructions and layout. Switching parts keeps each part's draft independently.

**Save**, PDF/SVG export, **Copy image**, region capture and **Drawings for all parts** also include pending instructions from every part. All pending text is validated before any of those drafts is committed; each changed part receives its own undo entry. Other controls continue to show committed instructions until Apply or one of these actions.

Instruction text changes the space available for views. An unlocked part receives a new layout when needed; locked drawing positions remain fixed. Review the warnings if the notes are too long or overlap the fixed drawing. Shorten the text, unlock and arrange the drawing, or use a larger sheet. PDF export refuses overflowing content. Per-part instructions are independent of the cached shared technical notes and the project description.

**Drawings for all parts** prepares a sheet for every imported element and selects every part for export. It does not start a download. **Export** then creates one PDF page per selected part; **Save** keeps all parts, their dimensions, markup, instructions and layouts in one ZIP. Placed components from the same STEP file share one archived original rather than duplicating it for each drawing.

## Part types and manufacturing parameters

Open **Part type** and choose **Automatic**, **General part** or a preset: **Shaft / axle**, **Bushing / spacer**, **Nut**, **Screw / lead screw**, **Ball-screw / lead-screw nut**, **Bearing**, **Plate / cover**, **Flange**, **Gear**, **Frame / bulkhead** or **Custom type**. Automatic uses existing gear geometry or specifications where available and otherwise selects General part. An explicit choice controls the requirements shown on that part's drawing.

Presets provide convenient starting fields for shafts, bushings, nuts, screws, ball-screw/lead-screw nuts, bearings, plates, flanges, gears and frames. Every type also offers six reusable sections: **Holes and axes**, **Threads**, **Fits and geometric requirements**, **Linear drives**, **Bearings and seats**, and **Material and process**. A frame can therefore include bearing-seat requirements or angled holes without changing its type. Only sections containing entered data are printed; preset fields appear once even when they also belong to a reusable section.

**Additional parameters → Add parameter** adds rows with a name, optional symbol and requirement value. Non-Gear profiles accept an optional profile name, such as **Standoff** or **Extension** for the bushing preset; Custom type accepts a custom type name. Gear's reusable sections are **Additional gear requirements**, printed after its specialized parameter table. These entries describe supplied manufacturing intent; they do not replace measured CAD dimensions, recognize arbitrary features or determine tolerances automatically.

Changing the type takes effect immediately and retains the other profiles' saved values and the separate gear specification. Type changes can refresh unqualified automatic suggestions when the drawing has no manual dimensions, locks or review marks; explicit tolerances and notes are preserved. Entered requirement text remains a draft until **Apply part requirements** or a save/export action while that profile is active. **Reset draft** restores committed values. Inactive unapplied drafts stay in the current session; apply them before saving to retain them in the project. The selected profile, applied inactive profile values and additional rows are saved per part in JSON/ZIP and participate in Undo/Redo. Locked drawing positions remain fixed when requirements change; review layout warnings before export.

Only the active profile is printed. General part has no parameter table until requirements are entered. Other empty profiles show a draft table with a request to specify manufacturing requirements; Gear retains its specialized draft table and adds supplemental requirements only when entered. Long combined tables produce an overflow warning and must fit before PDF export. Shared material/title-block data and the per-part Instructions tab remain independent.

## Gear drawings

Choose **Part type → Gear** to review detected geometry and enter the manufacturing specification for the active part. For supported straight cylindrical profiles, the CAD kernel measures a repeated tooth count, tip/root diameters, face width, overall length and available hub, through-bore and radial-hole features. Gear-specific suggestions describe these features rather than dimensioning individual teeth. A tooth datum uses the midpoint of an actual modeled tip arc; radial-hole orientation still needs an engineering tolerance and inspection requirement.

Gear dimensions retain enough decimal places for the measured nominal value: a bore of **Ø3.175** stays Ø3.175 even when the sheet is set to two decimal places. Display precision does not specify a tolerance.

Measured geometry does not establish the gear's module, pressure angle, profile shift, accuracy or tooth profile standard. Source-name text is shown separately as an unverified hint. Supply the external spur/helical type, normal module, normal pressure angle, profile shift, profile reference, accuracy/backlash, inspection dimensions and limits, flank finish and tooth-edge treatment. Helical specifications also require helix angle and hand. Material remains in **Title block**; heat treatment and hardness have a separate gear field. No 20° pressure angle or zero profile shift is assumed.

Choose **Apply gear data** to update the drawing, or **Reset draft** to discard pending changes. Save/export actions validate and include pending gear data from parts whose active profile is Gear. Applied values, detected evidence and the resulting layout survive Undo/Redo and JSON/ZIP reopening. Generated gear dimensions are arranged again for a changed sheet, gear table or instruction footprint when the drawing has only automatic dimensions and no review marks. Authored dimensions and locked positions are retained; review fit warnings before export.

The printed parameter table groups basic, inspection and reference data using [GOST 2.403-75](https://files.stroyinf.ru/Data/29/2907.pdf). Reference diameter uses supplied normal-system data: `d = mn × z` for spur gears and `d = mn × z / cos β` for helical gears, as described in [KHK's basic gear guide](https://khkgears.us/media/fqrlut1m/abcs-of-gearing-b.pdf). Missing information remains marked **Specify**, and incomplete or conflicting data prints a **DRAFT** heading. The table, detected dimensions and modeled tooth contour do not constitute a complete manufacturing approval or certify compliance with the standard.

Automatic recognition requires 6–400 repeated circular tip/root patches with straight axial boundaries and a consistent common axis. It does not recognize every filleted, simplified, helical, internal, bevel or worm profile. Engineering data can be entered manually when detection is unavailable; additional views, datums and inspection specifications may still be needed. Exact end-view gear dimensions require a face-on orthographic axis; an oblique source orientation needs reorientation in the source CAD application. Choose a larger sheet or shorten entered text if the table does not fit.

## Local projects and source files

**Save** downloads `workspace.techdraw.zip`. It contains `project.json` with committed dimensions, tolerance text, review annotations, per-part manufacturing profiles and instructions, title-block data and fixed view layouts; original imported files under `sources/`; `manifest.json` with source associations, byte sizes and SHA-256 digests; and a readable `README.txt` containing the project description. Original source bytes are preserved without conversion. A multi-part STEP assembly shares its original file across its placed parts.

**Open project** accepts the ZIP archive or the supported validated JSON project format. JSON contains editable projected drawing data, but does not embed original CAD files. If an opened project has unavailable originals, a later archive records them as missing instead of reconstructing a source file from projections. Project descriptions are separate from the printed shared technical notes and per-part manufacturing instructions.

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

Choose **Lock** / **Lock selection** for selected dimensions or a review mark. A lock badge identifies protected items, and their editing fields are disabled. Locked items remain selectable for inspection, focus and unlocking. If a selected group contains any locked item, dragging, deleting and side placement are blocked for the whole group; choose **Unlock** / **Unlock selection** before changing it.

**Auto layout** is blocked when the active part has locked items. **Refresh automatic suggestions** preserves its locked objects and current view layout. Shared paper format, orientation, template and drawing-scale changes are blocked while any part in the workspace has a lock, preventing a reflow from moving protected dimensions. An unlocked part can still use Auto layout independently. Lock/unlock is one undoable action and survives JSON/ZIP saving and reopening, including each mark's color.

Grid spacing uses millimetres on the printed sheet, independently of zoom and drawing scale. Show Grid and Snap to Grid are separate controls; both start off, with a 5 mm default step. The dropdown lists 1×1, 1.25×1.25, 2.54×2.54, 5×5 and 10×10 mm in that order. Choose Custom at the end to enter a precise step from 0.1 to 100 mm. Hold Alt to move freely. The visible grid may simplify at low zoom, while snapping retains the requested step. The grid is a workspace aid and is absent from SVG, PDF and printed output.

To specify a dimensional tolerance, select the dimension and use the **Tolerance** mode buttons in its editing panel. With **±**, enter only the numeric magnitude, such as `0.05`; the ± symbol is supplied automatically. For upper/lower deviations, set each sign with its sign controls and enter the values. For a fit, enter a designation such as `H7`. Review the preview and choose **Apply**. Changing the mode or typing a draft does not change the drawing until applied. **Clear** in the tolerance editor removes the applied tolerance. Linear deviations use millimetres; angular deviations use degrees. Fits apply to linear dimensions and are entered explicitly: the app does not infer a fit from STEP geometry or calculate its limit deviations. The measured nominal value stays tied to the geometry. Applied tolerance edits support undo/redo, project saving and PDF export.

Expand **Position and notes** in the selected-dimension panel to set its paper offset, prefix or note after the value.

Unapplied tolerance entries are retained per dimension while you zoom, pan, change inspector tabs or theme, select parts for export, or edit another dimension and return. Switching tolerance modes preserves values already entered in the other modes. Drafts are kept for the current session; Apply commits them to the drawing and saved project.

Tool, selection, Delete and drawing Undo shortcuts leave native text editing unchanged while an input, text area or editable field has focus. Save project and command search remain available with Ctrl/⌘+S and Ctrl/⌘+K. Use the arrow keys or Home/End to move between tolerance modes, then enter the required values and apply them.

The title-block cache contains document fields and the selected template. Browser storage must be available for automatic reuse across reloads. **Save** retains the complete editable drawing and all available original source files in the ZIP archive.

STEP units are normalized by the CAD kernel; DXF units are converted by its planar importer. Curves are sampled for the displayed linework; dimension values come from model or analytic projected geometry rather than screen pixels. Display precision controls rounding and does not specify a manufacturing tolerance.

Complex assemblies are split into selectable placed solids. Reused products with ambiguous ancestry are labelled and reported. A model with no closed solid is available as a reference surface model. Very large or invalid STEP models may need to be repaired or split in the source CAD application. Current import limits are 500 solids, 12,000 source edges per part, and a five-minute worker timeout.

## Review, images and workshop viewing

Open **Markup** and choose a tool from the visible tool cards. For a note, choose **Text** and click the paper where the note belongs. Enter the text, color and text size in the dialog, then choose **Add note**. Click or tap existing unlocked text to reopen the same dialog and choose **Save changes** after editing. **Cancel** discards the dialog draft. Drag a note to move it; locked notes remain protected.

For Arrow, Rectangle, Ellipse or Freehand, choose a color and line width, then drag on the paper. Release to finish the graphic or stroke. Select an unlocked graphic to move it or edit its paper position, size, line width and color; choose **Apply changes** to commit the editor values. Text dialog drafts do not change the drawing, history or exports until submitted.

Freehand stays active for multiple mouse or pen strokes. Lift between strokes; choose **Finish drawing**, Select or `Esc` when finished. Each completed stroke remains independently editable and undoable. While a pen stroke is active, other pointer contacts such as a resting palm are ignored. Two-finger navigation remains available between strokes; freehand points are not forced onto the paper grid.

Review marks start in red so they stand out from CAD linework. Preset swatches and **Custom color** set each mark independently. The chosen color is retained on both Paper and Blueprint sheets and in project archives, PDF, SVG and PNG output. Review marks use paper millimetres and do not change CAD geometry or measured dimension values.

**Copy image** opens a prepared image preview. Choose Visible area, Selected items or Whole sheet, or use **Select area** / **Capture region** to crop a rectangle. Choose Paper or Blueprint, then **Copy image**, **Save PNG**, or **Share…** where the browser exposes file sharing. Dimensions and review marks are included; workspace controls and the grid are excluded. PNG is a raster preview; PDF retains the selected physical paper dimensions.

Clipboard image writing and native sharing depend on the browser, its permissions and the user gesture. If copying is blocked, the dialog keeps **Save PNG** available. Native Share is shown only when the platform can share the prepared image file.

**View** opens a read-only drawing viewer with part selection, pan/zoom, appearance controls and image sharing. Editing commands stay disabled until **Back to workspace**. The viewer fills the browser without changing the browser surface; use the separate **System fullscreen** button when supported. **Keep screen awake** requests a screen wake lock only while the viewer is active and visible. The browser or operating system can deny or release it; the status reports that condition and offers a retry. Leaving the viewer releases the lock.

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

Tests exercise real STEP geometry, generated gear profiles and source units, DXF entities and units, ZIP source preservation and tamper rejection, paper annotations, localization boundaries, image crops, wake-lock lifecycle, assemblies, exact dimensions, paper layout, viewport navigation and history. Browser review is still required for interaction, PDF rendering and platform clipboard/share/fullscreen behavior.

See [architecture](docs/ARCHITECTURE.md) for module ownership and extension points, and [deployment](docs/DEPLOYMENT.md) for GitHub Pages and the custom domain.

## Dependencies and examples

- [Replicad](https://replicad.xyz/) provides JavaScript wrappers for CAD geometry.
- [replicad-opencascadejs](https://github.com/sgenoud/replicad-opencascadejs) provides the Open CASCADE WebAssembly build.
- [jsPDF](https://github.com/parallax/jsPDF) and [svg2pdf.js](https://github.com/yWorks/svg2pdf.js) generate vector PDF output.
- [fflate](https://github.com/101arrowz/fflate) reads and writes local project ZIP archives.
- Interface fonts are bundled locally through Fontsource. Exported PDFs embed Noto Sans for Latin, Greek and Cyrillic text. See [third-party notices](THIRD_PARTY_NOTICES.md).
- Original STEP and DXF examples and their CC0 designation are described in [the examples directory](public/examples/README.md).

The design follows FreeCAD TechDraw's separation of pages, templates, projected views, and dimensions. It runs independently of FreeCAD. See the linked primary references in [engineering scope](docs/ENGINEERING.md).
