# Saved DOCX commands

Set `eq` to the absolute path of `scripts/run` inside this Skill. For a Skill installed or exported from the macOS App, it uses the App's bundled Node runtime. If the App moves, install or export the Skill again. From the source checkout the launcher can use the checkout's Node 24 dependencies.

```sh
eq="$HOME/.agents/skills/equation-lab/scripts/run"
sh "$eq" inspect "$input"
sh "$eq" inspect "$input" 12
sh "$eq" cli audit "$input" > "$audit"
sh "$eq" cli references "$input" '2.7'
sh "$eq" cli read-preset "$input"
```

The compact inventory uses zero-based indices. `inspect INPUT INDEX` adds the selected row's character offsets, native typography and ruler tabs. It scans the saved package once in that invocation. `audit` lists equation targets, bookmarks, cached REF/PAGEREF text, and structural findings. `references` searches referenceable numbered targets by cached number, bookmark, or one-based equation display index. Use the audit's `coverage.parts` when reporting which document stories were inspected.

## Generate new editable equations

Create a standalone fragment with real embedded MathType equation objects. The following spec generates an inline formula and a numbered fraction, then adds a Word REF to the numbered formula in the new document.

```json
{
  "numberingFamily": "mathtype",
  "equations": [
    { "latex": "x^{2}+1", "layout": { "mode": "inline" } },
    {
      "latex": "\\frac{x+1}{y}",
      "layout": { "mode": "numbered-right", "numberFormat": "(#C1.#E1)", "chapter": 2 }
    }
  ],
  "references": [{ "target": 1, "prefix": "See equation " }]
}
```

```sh
sh "$eq" create "$spec" "$new_docx"
sh "$eq" cli audit "$new_docx"
```

`layout.mode` accepts `inline`, `display`, `numbered-left`, and `numbered-right`. Each new equation can also carry `typography` and `ruler`. A numbered standalone document initializes its own counter context. For insertion in existing Word prose, find and verify the exact range in the destination, then use the Ribbon flow with the destination's counters. [Live Word operations](live-word.md)

Each `references[].target` is a zero-based index into `equations`. In the example, `1` targets the second equation. The `references` query command also accepts the one-based display ordinal when searching a saved document.

## Modify existing equations in one pass

`edit-batch INPUT EDITS.json NEW_OUTPUT.docx` accepts a JSON object with `sourceSha256` and an `edits` array. Copy the top-level `sourceSha256`, each `index`, and each equation's `nativeSha256` from the same inventory. This binds the entire request to the inspected file version even when equations have identical Native data. Use `latex` for a structural rebuild, `replacements` for native character edits, and add `typography` or `ruler` only where requested. Hold together changes to one equation in the same entry. Entries with separate operations on different equations belong in one invocation.

```json
{
  "sourceSha256": "<package hash from inspect>",
  "edits": [
    {
      "index": 12,
      "expectedNativeSha256": "<hash for index 12>",
      "latex": "\\frac{x+1}{y}",
      "typography": { "fullSize": 12 }
    },
    {
      "index": 30,
      "expectedNativeSha256": "<hash for index 30>",
      "replacements": { "42": "z" }
    }
  ]
}
```

Use the actual character offset returned by `inspect INPUT 30` for the second entry. The displayed character position in LaTeX is independent of the offset in the Native stream. To adjust the native ruler alone, supply `"ruler":[{"position":64,"type":0}]` or `"ruler":[]` to clear it. The position is in 1/32 pt units. Verify the desired ruler by reading the result back.

```sh
sh "$eq" cli edit-batch "$input" "$edits" "$new_docx"
sh "$eq" inspect "$new_docx"
```

When only a specific character needs to change, prefer `replacements` to preserve the equation's structure and local choices. If a structural rebuild reports an unsupported formula, retain the original and try a narrower supported operation or the live Word route. The command also accepts a bare edits array for an already pinned source snapshot. Use the object form for ordinary file workflows.

## Number formats, styles, spacing and layout

```sh
sh "$eq" cli plan-numbering "$input" "$number_options" "$number_plan"
sh "$eq" cli apply-numbering "$input" "$number_plan" "$new_numbered"
sh "$eq" cli plan-typography "$new_numbered" "$style_options" "$style_plan"
sh "$eq" cli apply-typography "$new_numbered" "$style_plan" "$new_styled"
```

Examples of option files:

```json
{"scope":"selected","indices":[0,12],"numberFormat":"(#C1-#E1)","updateFuture":false}
```

```json
{"indices":[0,12],"typography":{"fullSize":12,"sizes":{"1":{"unit":"%","value":65}}}}
```

```json
{"indices":[],"preset":{"name":"Thesis formulas","scope":"new-equations","typography":{"fullSize":12}}}
```

Number scopes are `current` with `index`, `selected` with `indices`, `all` for eligible existing numbers, and `future` for only the default. Counters use `#C` for chapter, `#S` for section and `#E` for equation. A format suffix is `1`, `A`, `a`, `I`, or `i`. Every format requires an equation counter. An existing legacy number without a bounded reference bookmark can be limited to a separator or bracket change; use the actual per-target report.

`sh "$eq" catalog` returns the native spacing and extra-size indices, units and candidate font names. Choose a concrete setting from the catalog and selected equation rather than guessing. Use `typography.spaces` for formula internals, for example `{"spaces":{"16":{"unit":"%","value":100}}}` uses the operator spacing factor. Some native settings preserve intent without exact preview parity across hosts. Word paragraph spacing, indentation, and line spacing belong to Word's paragraph/style controls.

For a left/right/centered position change of selected existing body formulas, plan the indices from an inventory on the same saved version:

```json
{"sourceSha256":"<hash from inspect>","indices":[0],"layout":{"mode":"numbered-left","numberFormat":"(#C1.#E1)"}}
```

```sh
sh "$eq" arrange-copy "$input" "$arrangement" "$new_layout"
```

The helper checks the source package hash, copies to an unused filename, and validates existing bookmarks, reference resolution and Native hashes after rearrangement. Use a simple paragraph with one standalone formula. The core engine can reject mixed prose, protected, tracked, ambiguous or custom layouts. Use the authorized Word flow for those targets. This operation changes positioning and bounded numbering markup. To set the document-wide future format, make a separate `future` numbering plan.

## Check the saved output

Inspect the resulting copy and run one audit to compare reference targets and state. Review changed, unchanged and skipped targets of batch plans. A successful native hash or preview check establishes package-level behavior. Open the result in Word and use Update Numbers when the task involves recalculation or actual display. Check whether Word saved the expected formula and REF results before reporting host validation.
