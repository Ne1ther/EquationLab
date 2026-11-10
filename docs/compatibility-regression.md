# Compatibility regression

The published 30-equation demo is a project-generated fixture, not an independent Word or MathType oracle. `scripts/build/build-word-demo.mjs` contains its formulas and constructs it with the project engine. The public regression freezes the checked-in DOCX SHA-256, the 30 numbered bookmarks and the two reference targets. It catches changes in reading that known file; it does not prove Word save/reopen behavior, vendor compatibility, or rendering equivalence. A sample change requires reviewing its origin and expectations before updating the manifest.

Run the public check with `node --test tests/host-compatibility-regression.test.mjs`. The same file reports a skipped host test unless a private corpus is explicitly configured. The existing `native-compatibility-corpus.test.mjs` and `document-compat-corpus.mjs` are also generated regressions, not independent host evidence.

## Private host saves

An independent host corpus is not included in this repository. To run one locally, set `EQUATIONLAB_HOST_CORPUS_MANIFEST` to an absolute path to a JSON manifest kept outside Git, then run the same test command. The test does not launch a host or write the documents. Paths inside the manifest are relative to the manifest file, or absolute. Use a copy of a saved document and its actual receipt; do not include private papers or restricted vendor material in the repository.

One local, ignored corpus has been frozen from the project's historical Word 16.114.4 formula-only QA documents: a single-column save, a two-column save, and the latter's saved-and-reopened copy. The historical geometry receipt enumerates the Native hashes and numbers; the reopened copy matches those values and the saved copy's bookmarks, while its reopen receipt reports preservation without enumerating the hashes. Full DOCX hashes and the individual bookmark values were frozen in 2026-11-10, not recorded at capture time. Running the private corpus verifies those fixed bytes and fields offline; it is not a new Word session, visual comparison, or Windows/MathType acceptance. Details and the manifest remain in the local ignored evidence directory.

```json
{
  "schema": "equationlab.private-host-corpus.v1",
  "cases": [
    {
      "id": "example-word-save",
      "host": "Microsoft Word <version>, macOS <version>",
      "captureDate": "2026-11-10",
      "operation": "describe the actual edit, save and reopen",
      "sourceDescription": "describe the original, its origin and the capture procedure",
      "document": "saved.docx",
      "documentSha256": "<64 lowercase hex digits>",
      "receipt": "receipt.json",
      "receiptSha256": "<64 lowercase hex digits>",
      "objects": [
        {"nativeSha256": "<64 lowercase hex digits>", "bookmarkName": null, "numberText": null}
      ]
    }
  ]
}
```

Replace placeholders and list every equation in saved order. Freeze expected native hashes, bookmark names and cached numbers from the capture evidence, using `null` where absent. The checks bind the document and receipt bytes and compare all declared objects; they do not prove that a receipt is authentic or that expectations were independently established. Manually review that evidence before accepting a corpus, record the host and product versions and component hashes, and retain failed captures as such. A file parsed by Equation Lab cannot by itself establish its own expected host behavior.

The originating workspace also has local-only tests for older MathCapture, historical toolbar, MathPage, EQP reference, integral-runtime and Word/Windows round-trip evidence; those files are excluded from the public checkout. They report an explicit skip unless `EQUATIONLAB_LOCAL_LEGACY_TESTS=1` is set. When enabled, missing files and missing local research helpers fail the tests; the original assertions still run. Public generated-equation, font rendering and offscreen WebKit checks continue to run without that corpus. On the originating machine, `.local/optimization-20261110/legacy-fixtures-needed.json` records the exact inputs, identities and archived DOCX paths. Restore only the needed local copies and keep vendor material and historical documents out of Git. Neither this switch nor the host corpus is configured in public CI.

## CI and manual boundaries

A separate local Word 16.114.4 session on 2026-11-10 used the installed development App with independent copies containing 112 and 300 equations. It verified text input during preflights and fresh displayed previews before the two 300-equation preflights completed. The 112-equation source's unknown legacy font encoding caused all style targets to be safely skipped; it is not a bulk-style compatibility pass. This is new local host evidence, kept in `.local/word-live-20261110/`, distinct from the frozen historical corpus and from the released installer. It does not establish a general latency percentile or a Windows/MathType round trip.

The macOS workflow installs the locked npm dependencies with Node 24.21.0, builds the `EquationFontMetrics` helper, runs the Node suite (including the macOS offscreen WebKit cases), Swift tests and offline installer-logic tests. It needs the bundled STIX font, system fonts and Xcode/WebKit available on the runner. A missing font or offscreen WebKit failure is a failed check to investigate, not a host pass or an automatic skip. Swift tests explicitly skip packaged-engine, packaged-release and live-network checks when their opt-in environment is absent.

CI does not perform a real Word or MathType session, compile Word macros, install a PKG, test a signed release, or download an older release. Save/reopen, insertion, selection, numbered references, Word lifecycle and the actual installed app still require manual host checks with the running app path/build and Word helper/template hashes recorded. Keep those receipts separate from CI results.
