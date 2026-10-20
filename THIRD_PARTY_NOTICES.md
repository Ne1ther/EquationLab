# Third-party materials

The root MIT license applies to original Equation Lab code and original artwork. It does not relicense third-party software, fonts, product marks or locally retained research artifacts.

- STIX Two Math: SIL Open Font License 1.1; retain assets/fonts/OFL-STIX.txt and source.json.
- Lucide icon assets: retain word-ribbon/icons/lucide/LICENSE.
- Microsoft product icons: Microsoft marks, separately governed; retain design/office-product-icons/README.md and sources.json. These are not covered by the Equation Lab MIT license. Their use in a public distribution still needs review against the applicable terms.
- Node, npm dependencies, MathLive and MathJax retain their own licenses. npm ci installs their notices; the application builder retains dependency license files. See package-lock.json for exact versions.
- MathType, Word and Microsoft are marks of their respective owners. This project is independent and does not redistribute their applications or Office frameworks in its source export.

## Rendering resources

`src/native-template-pieces.json` now contains three operator outlines derived from the bundled STIX Two Math font (OFL-1.1), and Equation Lab's original parametric bracket, ellipse and arrow constructions (MIT). Retain `assets/fonts/OFL-STIX.txt` and `assets/fonts/source.json` with the font-derived outlines. The JSON records the source font and SHA-256. It no longer contains MT Extra outlines.

`src/native-spacing-tables.json` is derived from MathJax 3.2.2's TeX class spacing matrix in `ts/core/MmlTree/MmlNode.ts` (installed JavaScript: `js/core/MmlTree/MmlNode.js`). Copyright (c) 2017-2022 The MathJax Consortium. Licensed under Apache-2.0; retain `assets/licenses/MathJax-LICENSE.txt`. Equation Lab maps the eight TeX classes to its ten token classes and encodes normal/script spacing in its own format. These transformations replace the vendor-extracted tables.

`src/radical-contour.mjs` adapts the U221A outlines from [KaTeX 0.16.22 svgGeometry.js](https://github.com/KaTeX/KaTeX/blob/v0.16.22/src/svgGeometry.js) (MIT; retain `assets/licenses/KaTeX-LICENSE.txt`) and the tall U23B7 hook from MathJax 3.2.2's `tex-size4.js` (Apache-2.0). The native renderer draws each radical and its overbar as one closed outline, without KaTeX's extra overlapping brush rectangle. `packaging/mathlive-editor.mjs` builds the editor from the digest-checked MathLive 0.111.1 bundle and installs a local paint adapter. The editor retains MathLive's adaptive overbar width and joins the SVG stem to that rule at the same thickness and baseline. MathLive's layout boxes and editable atoms remain upstream.

Rebuild both resources with `node scripts/build/build-rendering-resources.mjs` after `npm ci` and `swift build`. The builder reads the shipped STIX font, locked MathJax source and project geometry only. The previous vendor-derived resources remain in the local, excluded research archive.

## Local research and remaining provenance review

Raw REA, original vendor binaries/fonts/templates, real Word documents, TLS keys, host receipts and frozen Word binaries are also excluded.

The empty serialized protocol fixture in src/resources/ole-template.json retains streams derived from the original blank-equation sample. Moving it and removing the sample hash does not establish redistribution permission; its provenance is also part of the pending publication review.
