# Native Word Ribbon resources

This directory contains the native Word Ribbon command metadata and the shared icon sources used by `native-word-probe/automatic-loader/build-ribbon-template.mjs`. The runtime does not serve these files over HTTP; the legacy Office.js taskpane and its local HTTPS server have been completely removed.

Icon licenses and source attributions are documented in [`icons/ATTRIBUTION.md`](icons/ATTRIBUTION.md).

To rebuild the font-independent SVG and PNG assets, run `npm ci` and then `node word-ribbon/build-icons.mjs`. Large Ribbon buttons embed 80 px images, while small buttons use 32 px images. The 16 px exports use a heavier optical stroke for compact sizes. Number placement, number formatting, and the capabilities panel each have a distinct symbol.
