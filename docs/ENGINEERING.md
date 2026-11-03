# Drawing accuracy and engineering review

## Geometry and design intent

A STEP model can define exact boundary geometry and units. A model without supported semantic product manufacturing information does not state every manufacturing requirement. Fits, datums, surface texture, geometric tolerances, heat treatment, material condition, and inspection strategy require engineering decisions. TechDraw must never invent these values or imply that automatic dimensions certify a part for manufacture.

Automatic dimensions are a reviewable starting point. Overall sizes and supported geometric features can be measured from the CAD model. Their placement and selection still require review for the part's function and manufacturing process. A dimension's displayed precision is formatting; it is not a tolerance or a guarantee of equivalent physical accuracy.

Avoid dimensioning tessellated display meshes. Curve sampling and viewport scale affect visual rendering, while numeric dimensions should remain tied to analytic geometry or exact model coordinates. Projected lengths and true spatial lengths are different for oblique edges. Use an orthogonal view in which a dimension represents its intended measurement.

## Curves and modeled threads

Precise HLR output distinguishes hard edges and apparent outlines from smooth tangency boundaries. TechDraw omits smooth transitions, removes coincident strokes, and leaves hidden edges off by default. Physical thread ridges and silhouettes remain real model geometry; the app does not replace them with an inferred conventional thread symbol. Specify thread form, pitch, starts, handedness, tolerance and extent explicitly when required.

For a coaxial shaft, analytic source circles provide radii and axial stations. This avoids dimensioning incidental helical occlusion points. A circular arc supplies a radius; a complete source circle can supply a diameter. The drawing still needs a review of functional datums, groove widths and tolerances.

## ESKD principles

The ESKD-inspired template provides a drawing frame, a right-hand title block, clear line weights, millimetre values, a stated scale, and a consistent projection arrangement. It is a drafting aid and is not a certification of conformity to every provision of a standard or a jurisdiction's current adoption.

The standards relevant to a complete engineering review include the applicable editions and national adoptions of GOST 2.301 (formats), 2.302 (scales), 2.303 (lines), 2.304 (lettering), 2.305 (views and sections), 2.307 (dimensions and limit deviations), and 2.104 (title blocks). Check the contract and governing national standards before production. An A4 landscape sheet or a freely selected layout may be useful for documentation even where a strict ESKD deliverable requires a different arrangement.

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
