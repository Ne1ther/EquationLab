<p align="center"><img src="design/equation-lab-icons/v6/png/e2-lab-cream-optical-1024.png" width="112" height="112" alt="Equation Lab"></p>
<h1 align="center">Equation Lab</h1>

I started this project to keep editing MathType equations in Word on a Mac. It also works on its own, with templates or LaTeX.

[中文](README.md)

**[Download 0.6.9 (build94)](https://github.com/Ne1ther/EquationLab/releases/download/v0.6.9/Equation-Lab-0.6.9.pkg)** · [Releases](https://github.com/Ne1ther/EquationLab/releases) · [Install](docs/install.md)

For Apple Silicon Macs running macOS 14 or later. The installer includes the app, Word plugin, and runtime. No separate Node, Python, or MathType installation is needed. Word features require desktop Word for Mac.

Save your documents, quit Word and Equation Lab, then open the installer. Reopen Word to find the **Equation Lab** ribbon. Double-click an equation to edit it in a separate window, then save it back in place.

## What it does

- Browse and search document equations, edit them, and save back to Word.
- Enter templates or LaTeX, including multiple lines, cases, and matrices; adjust fonts, sizes, and spacing.
- Use equation numbering, cross-references, format presets, and custom previews.
- Export PDF, SVG, or PNG, and copy LaTeX.

You can now insert into Word directly from the app. Choose a document at the top of the sidebar, then use Insert into Word for inline, centered, or left/right numbered placement. While editing an existing equation, the new one goes after its paragraph. A standalone draft uses the selected document’s empty Word cursor and carries its content and formatting into the insertion session. Finish and insert waits for Word’s confirmation; cancelling leaves no empty object.

The menu on the left lists open Word documents and distinguishes documents by identity, even when names match. Switching protects changed drafts, and background metadata updates do not bring the editor to the front. Refreshing the document menu updates document details; refreshing the formula area rereads equations.

The app and Word share numbering state, including editable chapter and section values. Change the format under Document → Word Layout, then choose Update Equation to apply it to the selected equation and use it for later numbered insertions. A new equation adopts the format when you choose Done and Insert. Word’s Update Numbers recalculates existing sequence numbers and cross-references; it does not replace every old number format in the document.

Long documents still open the selected equation first and fill in the list in batches. Earlier checks covered 30 demo equations, 11 complex inputs, and editing, point sizes, save/reopen, deletion, renumbering, and references in a local 120-equation document. This round adds all four app insertion modes, three-document switching, consecutive numbering, and draft retention after the source closes. The sidebar scrolls the selected equation into view when opening from Word. Some unmapped legacy font characters still show a square and a warning, with original data retained. Full compatibility with every MathType equation is still unfinished.

The app checks daily by default and shows an update button when a newer version is available. Use **Equation Lab → Check for updates…** to check manually or set up automatic downloads.

![Equation Lab workbench](docs/preview/workbench-0.6.5.png)

This screenshot is from 0.6.5; see the text above for the updated document selector and insertion entry.

## Try a document

[Download the 30-equation Word demo](docs/examples/equation-lab-30-formulas.docx) · [View the PDF](docs/examples/equation-lab-30-formulas.pdf)

Three sections, ten equations each, with 12 pt SimSun Chinese text. Includes radicals, sums, integrals, matrices, numbering, and cross-references. Open it and try editing.

![30-equation demo](docs/preview/word-30-formulas.png)

[More screenshots](docs/preview/README.md) · [Fonts and spacing](docs/features.md)

## Build it yourself

Install Node.js 24 and Swift 6.2 / Xcode command-line tools.

```sh
npm ci
swift build
./scripts/build_and_run.sh
```

[Development](docs/development.md) · [Directories and files](docs/file-guide.md) · [Packaging](packaging/README.md)

If something goes wrong, [open an issue](https://github.com/Ne1ther/EquationLab/issues) with the version, equation, or steps to reproduce it.

Source is under [MIT](LICENSE). See [third-party notices](THIRD_PARTY_NOTICES.md) for bundled resources.
