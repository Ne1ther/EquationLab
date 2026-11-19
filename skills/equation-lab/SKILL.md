---
name: equation-lab
description: Use Equation Lab to create, inspect, edit, number, cross-reference, or format editable MathType equations in Word DOCX files, including long documents. Applies to Equation Lab or MathType formula work in Word and to saved DOCX copy automation.
---

# Equation Lab for Word formulas

Choose the route from the user's destination.

- **A new file or a saved DOCX copy.** Use the local Node tools for compact inspection, editable formula generation, targeted batch edits, numbering and typography plans, and verification. Read [Saved DOCX commands](references/saved-docx.md).
- **An existing position in open Word, an unsaved document, or live SEQ/REF evaluation.** Use the Word ribbon and Equation Lab editor on the authorized document. Read [Live Word operations](references/live-word.md).

When several existing formulas need changes and the user accepts a saved copy, prefer one file batch even if the document is open in Word. When the user specifies an insertion point inside existing prose, use that exact Word body range and the Ribbon's inline insertion command.

Run `scripts/run` from this Skill with the user's explicit document paths. When installed or exported from the Mac App, the launcher uses the App's bundled runtime and tools. A developer can also run it from the Equation Lab checkout with its Node 24 dependencies installed. Quote document paths and use absolute paths when executing in another directory.

The optional AI coordination switch in the macOS App shows local activity from these commands. The commands also work offline with the App closed and the switch off. [Saved DOCX commands](references/saved-docx.md)

## Work from a stable document version

For a saved file, a single compact inspection gives each formula's zero-based index, package part, editable LaTeX, displayed numbering metadata, exact Native SHA-256, and the source package SHA-256. Select by the user's description, equation location and surrounding context. Equal LaTeX can occur at multiple locations and displayed numbers can repeat after chapter changes. Bind each replacement to its index and Native hash, and bind the batch to the source package hash from the same inventory.

Place multiple edits to existing equations into one `edit-batch` invocation. Give layout, numbering, and typography distinct passes only if their ordering matters. Reuse the first inventory for all operations based on that version, and inspect the current copy after a structural operation changes indexing. Use the detail query only for the chosen equation's characters, ruler or typography. Compact inspection avoids rasterizing the entire formula list.

Each copy operation writes a new filename. Use the plan output to examine `ready`, `unchanged`, and `skipped` targets before applying a number or style change. Regenerate a plan against the new source bytes if its input changes. Use Word to resolve questions involving actual sequence values, layout, locking or a tracked edit.

## Verify and return the result

Read back the resulting file to verify the intended equations, their number bookmarks, and any references in scope. Compare untouched Native hashes when the request requires exact preservation. Displayed field results in packages are cached; use the actual Word workflow to update numbers and inspect the resulting file when live values or pagination matter.

For a live write, wait for Equation Lab's Word confirmation, then verify the target formula or saved copy. If confirmation is uncertain, inspect Word before retrying. Report the resulting path or live document, operations completed, skipped items, and the exact level of verification performed.
