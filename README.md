# TechDraw

A browser application for turning STEP models into editable technical drawing sheets. Designed for `https://techdraw.defencore.com` on GitHub Pages.

The Open CASCADE WebAssembly kernel imports STEP geometry and computes precise hidden-line projections in a dedicated worker. Model files stay in the browser. The application has no API server, file upload service, analytics, or cloud storage.

## Features

- Import multiple `.step` and `.stp` files and select individual placed solids for export.
- Recover product names and assembly ancestry where the STEP representation permits a match.
- Generate front, top, right and isometric views in a first-angle arrangement.
- Suggest overall dimensions, visible full-circle diameters, hole-centre coordinates and verified orthogonal features. Coaxial shaft circles provide exact journal diameters and shoulder or groove stations.
- Choose a balanced automatic dimension set or all recognized baseline coordinates; reposition the result to suit the part.
- Use six visible dimension icons in a compact floating dock: Horizontal, Vertical, Aligned, Diameter, Radius and Angle. Tooltips identify each tool and its shortcut. Preview before placement, drag labels or dimension lines, remove dimensions, and undo or redo changes.
- Edit a selected dimension in a compact panel with tolerance-mode buttons for None, ±, upper/lower deviations or a manually entered fit designation. Tolerances remain editable in saved projects and appear in PDF exports.
- Arrange smaller dimensions inside larger spans, with separate lanes for overlapping dimensions.
- Select dimension groups, move them together, and place compatible dimensions on a chosen side with shared alignment or cascade spacing.
- Show a paper grid and snap annotation placement to a configurable step; grid preferences are remembered independently of drawing data.
- Set paper size A4, A3, A2 or A1, orientation, scale, decimal precision, hidden edges and centre lines.
- Choose GOST 2.104-68 Form 1 templates with English or Ukrainian frame labels, plus ISO-style or minimal sheets. The interface stays in English.
- Edit title-block data, sign-off names, signatures, dates, change records, inventory fields and technical notes. Entries are saved in this browser and reused for subsequent parts and sessions; **Clear** resets the fields and their cache.
- Inspect the sheet with cursor-anchored zoom from 25% to 1600%, panning and Fit.
- Export a vector PDF with one page per selected part and the same layout as the preview.
- Save and reopen an editable `.techdraw.json` project, including dimension positions and view layout.
- Use light or dark interface themes. Drawing sheets remain white for printing.

Automatic dimensions are geometric suggestions. The app does not import semantic STEP PMI or infer tolerances, fits, threads, surface finish, material, datum systems, sections or manufacturing process. Review and complete every drawing before manufacture. The Form 1 templates reproduce the specified frame geometry; they do not certify a complete drawing's compliance with every ESKD manufacturing requirement. See [engineering scope](docs/ENGINEERING.md).

## Use

1. Choose **Import STEP** or **Try an example**.
2. In the parts panel, open a part and check the parts to include in the drawing set.
3. Set the sheet format and template. Complete **Title block** and technical notes. Saved title-block entries are reused automatically; choose **Clear** in the title-block editor when starting a new specification. GOST A4 sheets use portrait orientation.
4. Review automatic dimensions. Choose a dimension icon in the floating drawing dock; its tooltip shows the tool name and shortcut. Pick a straight edge, circular edge, or snap points as appropriate, then move the draft preview and click to place it. Select an existing dimension to edit it, or drag its label or line to reposition it.
5. Export PDF. Use **Save project** to retain editable dimensions, sheet settings and view layout.

| Control                                                | Action                                                        |
| ------------------------------------------------------ | ------------------------------------------------------------- |
| Horizontal, Vertical, Aligned, Diameter, Radius, Angle | Start a dimension with the chosen measurement tool            |
| `H` / `V` / `L` / `D` / `R` / `A`                      | Horizontal / Vertical / Aligned / Diameter / Radius / Angle   |
| Mouse wheel                                            | Zoom around the cursor, from 25% to 1600% of the fitted sheet |
| Space + drag, middle mouse drag, or hand tool          | Pan the sheet                                                 |
| Drag empty space with the selection tool               | Pan the sheet                                                 |
| Shift / Ctrl-click dimensions, or dimension checkboxes | Add or remove dimensions from a selection group               |
| `G` / `S`                                              | Toggle the paper grid / grid snapping                         |
| Alt while placing or dragging                          | Temporarily bypass grid snapping                              |
| `0` or **Fit sheet**                                   | Show the whole sheet and reset panning                        |
| `+` / `-` or the zoom controls                         | Zoom around the viewport centre                               |
| `Esc`                                                  | Cancel a draft or gesture and return to selection             |
| `Delete` / `Backspace`                                 | Remove the selected dimension                                 |
| `Ctrl` / `⌘` + `Z`, with `Shift` to redo               | Undo or redo dimension and layout changes                     |

Zoom changes the on-screen view only. **Drawing scale** controls the printed size. Adding, dragging, deleting or editing a dimension keeps the part views fixed; **Auto dimensions**, **Arrange**, or a change to paper format, orientation, template or drawing scale can lay out the sheet again. Undo restores both the previous dimensions and their view layout.

The drawing dock keeps selection, panning and dimension tools together over the workspace. Separate compact docks contain the grid and zoom controls.

**Refresh automatic suggestions** updates geometric suggestions while retaining manual dimensions and explicit specifications. **Auto layout** repositions the existing views and annotation labels. Auto drawing scale selects a fitting scale from the GOST 2.302-68 part-drawing series, including 1:2.5, 1:4, 2.5:1 and 4:1. The isometric view can use a separate column when that improves the fit. Warnings above the workspace remain available while editing; use their layout or page-setup actions to address space problems and review the result.

For a selected group, choose **Cascade** for separate dimension lines or **Align** for a shared baseline, then choose a side in **Arrange dimensions**. Horizontal dimensions support Top/Bottom, vertical dimensions support Left/Right, and radius/diameter labels support all four sides. Aligned dimensions use geometrically compatible sides; angles stay unchanged. Nested or colliding spans keep separate lines even in Align mode. **Select view** selects the dimensions in the chosen orthographic view. Dragging a selected dimension moves its group in one undoable operation; measurements and source points stay fixed.

Grid spacing uses millimetres on the printed sheet, independently of zoom and drawing scale. Show Grid and Snap to Grid are separate controls; both start off, with a 5 mm default step. Enter a custom step from 0.1 to 100 mm, or use a suggested value such as 1, 5 or 10 mm. Hold Alt to move freely. The visible grid may simplify at low zoom, while snapping retains the requested step. The grid is a workspace aid and is absent from SVG, PDF and printed output.

To specify a dimensional tolerance, select the dimension and use the **Tolerance** mode buttons in its editing panel. With **±**, enter only the numeric magnitude, such as `0.05`; the ± symbol is supplied automatically. For upper/lower deviations, set each sign with its sign controls and enter the values. For a fit, enter a designation such as `H7`. Review the preview and choose **Apply**. Changing the mode or typing a draft does not change the drawing until applied. **Clear** in the tolerance editor removes the applied tolerance. Linear deviations use millimetres; angular deviations use degrees. Fits apply to linear dimensions and are entered explicitly: the app does not infer a fit from STEP geometry or calculate its limit deviations. The measured nominal value stays tied to the geometry. Applied tolerance edits support undo/redo, project saving and PDF export.

Expand **Position and notes** in the selected-dimension panel to set its paper offset, prefix or note after the value.

Unapplied tolerance entries are retained per dimension while you zoom, pan, change inspector tabs or theme, select parts for export, or edit another dimension and return. Switching tolerance modes preserves values already entered in the other modes. Drafts are kept for the current session; Apply commits them to the drawing and saved project.

Tool shortcuts work when focus is outside text fields. Use the arrow keys or Home/End to move between tolerance modes, then enter the required values and apply them.

The title-block cache contains document fields and the selected template. **Save project** retains part geometry, dimensions and drawing layouts; keep the original STEP files separately. Browser storage must be available for automatic reuse across reloads.

All source units are normalized to millimetres by the CAD kernel. Curves are sampled for the displayed linework; dimension values come from model or analytic projected geometry rather than screen pixels. Display precision controls rounding and does not specify a manufacturing tolerance.

Complex assemblies are split into selectable placed solids. Reused products with ambiguous ancestry are labelled and reported. A model with no closed solid is available as a reference surface model. Very large or invalid STEP models may need to be repaired or split in the source CAD application. Current import limits are 500 solids, 12,000 source edges per part, and a five-minute worker timeout.

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

Tests exercise real STEP geometry, inch-to-millimetre conversion, named nested assemblies, tangent-edge suppression, coincident-edge cleanup, source circle measurements, shafts, paper sizes, projection alignment, nested dimension lanes, sheet overflow, cursor-anchored zoom, geometry picking, annotation dragging and layout history. Browser review is still required for interaction and PDF rendering.

See [architecture](docs/ARCHITECTURE.md) for module ownership and extension points, and [deployment](docs/DEPLOYMENT.md) for GitHub Pages and the custom domain.

## Dependencies and examples

- [Replicad](https://replicad.xyz/) provides JavaScript wrappers for CAD geometry.
- [replicad-opencascadejs](https://github.com/sgenoud/replicad-opencascadejs) provides the Open CASCADE WebAssembly build.
- [jsPDF](https://github.com/parallax/jsPDF) and [svg2pdf.js](https://github.com/yWorks/svg2pdf.js) generate vector PDF output.
- Interface fonts are bundled locally through Fontsource. Exported PDFs embed Noto Sans for Latin, Greek and Cyrillic text. See [third-party notices](THIRD_PARTY_NOTICES.md).
- Original STEP examples and their CC0 designation are described in [the examples directory](public/examples/README.md).

The design follows FreeCAD TechDraw's separation of pages, templates, projected views, and dimensions. It runs independently of FreeCAD. See the linked primary references in [engineering scope](docs/ENGINEERING.md).
