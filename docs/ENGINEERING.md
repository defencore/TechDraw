# Drawing accuracy and engineering review

## Geometry and design intent

A STEP model can define exact boundary geometry and units. A model without supported semantic product manufacturing information does not state every manufacturing requirement. Fits, datums, surface texture, geometric tolerances, heat treatment, material condition, and inspection strategy require engineering decisions. TechDraw must never invent these values or imply that automatic dimensions certify a part for manufacture.

Automatic dimensions are a reviewable starting point. Overall sizes and supported geometric features can be measured from the CAD model. Their placement and selection still require review for the part's function and manufacturing process. A dimension's displayed precision is formatting; it is not a tolerance or a guarantee of equivalent physical accuracy.

Per-dimension tolerance controls support no tolerance, symmetric ± values, upper/lower deviations, and an explicitly entered fit designation. Draft fields start empty; an annotation is committed only with **Apply**, while **Clear** removes it. Linear deviations use millimetres and angular deviations use degrees; fit designations are available only for linear dimensions. These annotations express the engineer's input and do not change the measured nominal geometry. A fit label is not inferred from the STEP model and does not automatically calculate dimensional limits. Confirm its suitability and applicable limits before release. Saved projects, undo/redo and exported PDFs preserve the committed tolerance data.

Avoid dimensioning tessellated display meshes. Curve sampling and viewport scale affect visual rendering, while numeric dimensions should remain tied to analytic geometry or exact model coordinates. Projected lengths and true spatial lengths are different for oblique edges. Use an orthogonal view in which a dimension represents its intended measurement.

## Curves and modeled threads

Precise HLR output distinguishes hard edges and apparent outlines from smooth tangency boundaries. TechDraw omits smooth transitions, removes coincident strokes, and leaves hidden edges off by default. Physical thread ridges and silhouettes remain real model geometry; the app does not replace them with an inferred conventional thread symbol. Specify thread form, pitch, starts, handedness, tolerance and extent explicitly when required.

For a coaxial shaft, analytic source circles provide radii and axial stations. This avoids dimensioning incidental helical occlusion points. A circular arc supplies a radius; a complete source circle can supply a diameter. The drawing still needs a review of functional datums, groove widths and tolerances.

## GOST 2.104-68 frame templates

The English and Ukrainian ESKD templates use the requested GOST 2.104-68 Form 1 geometry. The reference is the standard's June 2002 reissue, including amendments 1–7 and its corrigendum: Form 1 is on PDF page 3 and placement diagrams are on page 7. [GOST 2.104-68, reproduced standard PDF](https://etp-perm.ru/images/images/2/326/gost_2.104_68.pdf).

Verified reference dimensions, in millimetres:

| Element                        | Geometry                                                         |
| ------------------------------ | ---------------------------------------------------------------- |
| Main title block               | 185 × 55; left, central and right sections 65 / 70 / 50          |
| Document designation           | 120 × 15, above title and right-side fields                      |
| Product title / material       | 70 × 25 / 70 × 15                                                |
| Sign-off rows                  | Six 5 mm rows; role/name/signature/date widths 17 / 23 / 15 / 10 |
| Litera / mass / scale          | Widths 15 / 17 / 18; litera has three 5 mm cells                 |
| Inventory strip                | Label/value widths 5 / 7; five lengths 25 / 35 / 25 / 25 / 35    |
| Repeated designation, field 26 | 70 × 14, rotated according to sheet arrangement                  |
| Frame margins                  | 20 at the left; 5 at the other edges                             |

Section 4 requires the A4 title block along the short edge, so GOST A4 templates use portrait orientation. Larger sheets support either orientation. Ukrainian labels are localized translations; the interface remains English. The document's litera denotes its development stage and is separate from its change/revision record. [GOST 2.104-68, sections 4 and 7 and Form 1](https://etp-perm.ru/images/images/2/326/gost_2.104_68.pdf).

Frame geometry alone does not certify a complete manufacturing drawing. A complete review also considers the applicable editions and national adoptions of GOST 2.301 (formats), 2.302 (scales), 2.303 (lines), 2.304 (lettering), 2.305 (views and sections), and 2.307 (dimensions and limit deviations), together with the contract's requirements.

Automatic drawing-scale selection uses the part-drawing series in GOST 2.302-68 clause 2, rather than arbitrary decimal scaling. This includes reductions such as 1:2.5 and 1:4 and enlargements such as 2.5:1 and 4:1. The physical layout accounts for view contours, captions, centre lines and dimension geometry before choosing a scale. A cached project layout retains its saved scale and view transforms until an explicit layout operation or a relevant sheet-setting change. [GOST 2.302-68, reproduced standard PDF](https://eelib.narod.ru/eskd/GOST_2.302-68.pdf), [official standard catalogue](https://protect.gost.ru/gost/details/b8e1f82a-8ad2-4133-8c49-2570711b7e22).

For review:

- Use the minimum sufficient set of dimensions to define the shape and location of each required feature.
- Choose functional datums. Avoid redundant closed dimension chains.
- Show holes and internal features in suitable views or sections.
- Verify diameter and radius annotations, centre positions, thicknesses, and overall sizes against the source model.
- Supply tolerances, fits, datum references, surface finish, thread definitions, material, and technical notes explicitly where required.
- Confirm the title, designation, revision, scale, projection convention, paper format, and approval information.
- Inspect every exported sheet for overlap and clipping, and print at 100% if scale is needed.

## Relation to FreeCAD TechDraw

The architecture follows the useful separation in FreeCAD TechDraw: a page and template contain projected views; dimensions and annotations refer to view geometry. FreeCAD distinguishes precise hidden-line geometry from coarse polygonal approximations and distinguishes projected measurements from true 3D measurements. TechDraw uses the same concepts without bundling or running the desktop application.

Useful primary references:

- [FreeCAD TechDraw workbench](https://github.com/FreeCAD/FreeCAD-documentation-docusaurus/blob/Stable/docs/workbenches/techdraw.md)
- [FreeCAD TechDraw view and precision modes](https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/TechDraw_View.md)
- [FreeCAD dimensions and projected geometry](https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/TechDraw_General_Examples.md)
- [FreeCAD true and projected length dimensions](https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/TechDraw_LengthDimension.md)

No FreeCAD source code or templates are copied merely by following these concepts. Dependencies retain their own licenses.

## Open ESKD reference

[Open ESKD](https://eskd.defencore.com) and its [source repository](https://github.com/defencore/open-eskd) were examined for local engineering workflows and Ukrainian terminology. Its [Ukrainian labels](https://github.com/defencore/open-eskd/blob/main/src/i18n/common-uk.js) informed terminology such as designation, material and revision. Its [report layout](https://github.com/defencore/open-eskd/blob/main/src/files/report/layout.js) produces an HTML engineering report, rather than a Form 1 CAD frame. TechDraw's frame dimensions come from the reproduced standard above. Open ESKD's [conformance specification](https://github.com/defencore/open-eskd/blob/main/docs/CONFORMANCE.md) defines that project's own data format and does not claim standards-body certification.
