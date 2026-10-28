# Native Word Ribbon resources

This directory contains the native Word Ribbon command metadata and the shared icon sources used by `native-word-probe/automatic-loader/build-ribbon-template.mjs`. The runtime does not serve these files over HTTP. The former Office.js taskpane and its localhost HTTPS service have been removed.

Icon licenses and source details are in [`icons/ATTRIBUTION.md`](icons/ATTRIBUTION.md).

Regenerate the font-independent SVG and PNG artwork with `node word-ribbon/build-icons.mjs` after `npm ci`. Large Ribbon buttons embed 80 px images; small buttons use 32 px images. The 16 px exports have a stronger optical stroke for compact uses. Number placement, number formatting and the capabilities panel have distinct symbols.
