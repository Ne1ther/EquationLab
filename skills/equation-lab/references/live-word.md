# Live Word operations

Use a live Word workflow when inserting at a cursor, working with unsaved edits, setting a chapter or section at a position, inserting a REF in existing prose, or recalculating Word fields. The Word integration needs a running Equation Lab installation with the Word add-in enabled. Choose the intended document by its actual title and location. If multiple open documents have the same name, compare their locations and the surrounding paragraph.

| Goal | Word / Equation Lab operation |
| --- | --- |
| Insert at the current Word cursor | Place a collapsed cursor in the intended body text. Choose Equation Lab's inline, centered, right-numbered or left-numbered insertion. Enter LaTeX or insert structure templates, check the preview, then use **Finish and Insert**. |
| Insert after an existing equation | Open the exact equation in Equation Lab, then use the App's **Insert into Word** menu for the intended position mode. This path places the insertion after the selected equation's paragraph. |
| Edit an existing equation | Double-click the MathType object or find it in the active document list by displayed number and LaTeX. Prefer preserving structure for character-only changes. Use **Update Equation** and wait for the Word result. |
| Change current number, chapter or section | With the target equation active, use **Document → Word Layout** for the number format and counters. A chapter/section change establishes a new context at that location and restarts the equation sequence. Check the exact boundary and the following numbered equation. |
| Add or move a number at an existing formula | Select the formula in its own plain body paragraph. Use the Word ribbon's **Left Number** or **Right Number**. Use **Update Numbers** after numbered objects move or their order changes. |
| Add a cross-reference | Place the cursor in the prose, choose **Insert Reference** in the Word ribbon, and select the exact numbered bookmark. Use surrounding text as well as the displayed number when candidates resemble each other. |
| Adjust visual style | Use the App's typography inspector for native fonts, sizes, ruler and formula spacing. For separation from surrounding prose or paragraph indent, use **Word → Paragraph**. |

For an exact insertion inside existing prose, find the anchor in the intended Word document and verify the surrounding text. If Find highlights the anchor, collapse the selection to the requested side or place the cursor between the specified characters. Check that Word shows a caret with no selected text, then use the Equation Lab Ribbon's inline formula command. Verify the formula and adjacent prose in the same paragraph after Word confirms the insertion. The App's menu for inserting after an existing equation works at the paragraph boundary.

Use the localized labels available on the current App and Word host. Work from one verified active equation at a time. On a large document, continue with the current editable equation while the rest of the list loads. Wait for complete matching number metadata before changing numbering or addressing another row, and use sidebar search after the list is ready.

If the App indicates that a save is pending or unconfirmed, inspect the Word result before reissuing the command. A Word object update and saving the whole DOCX to disk are different events. When the user wants a deliverable on disk, save the intended Word document and inspect or reopen that saved file. For changes to several existing equations, use one saved-file `edit-batch` or a numbering or typography plan whenever the user's destination allows a copy. Group related changes, then open the result in Word once for visual checks and field updates. [Saved DOCX commands](saved-docx.md)

The local Word service coordinates Word-owned sessions. Use the Ribbon/editor for live editing and use the saved-file CLI for headless work. A host without Word can still generate editable documents, inspect native formula bytes, and produce verified copies.
