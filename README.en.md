<p align="center">
  <img src="design/equation-lab-icons/v6/png/e2-lab-cream-optical-1024.png" width="112" height="112" alt="Equation Lab">
</p>

<h1 align="center">Equation Lab</h1>

I'm building this so I can keep editing MathType equations in Word on a Mac. The editor also works on its own, with clickable templates and LaTeX input.

It's still a preview, and there's more to do. If you try it and something breaks, please [open an issue](https://github.com/Ne1ther/EquationLab/issues). A sample formula and steps to reproduce it would help.

[中文](README.md)

## Download

**[Download Equation-Lab-0.5.5.pkg (about 80 MB)](https://github.com/Ne1ther/EquationLab/releases/download/v0.5.5/Equation-Lab-0.5.5.pkg)**

You'll need an **Apple Silicon Mac running macOS 14 or later**. The installer includes the app and installs the Word plugin by default. You don't need Node, Python or developer tools. Word integration needs a desktop copy of Word for Mac.

Save your documents and quit Word before installing. Reopen Word afterwards and use the **Equation Lab** ribbon.

The preview has no Developer ID signing or Apple notarization, so macOS may block it. See the [installation guide](docs/install.md) and [release notes and checksums](https://github.com/Ne1ther/EquationLab/releases/tag/v0.5.5).

## What works so far

- Edit equations visually or change the LaTeX, with a separate preview using Word font settings.
- Insert fractions, roots, integrals, sums, matrices, letters and symbols. Templates are searchable.
- Change fonts, sizes and spacing, and export SVG, PDF and PNG.
- Edit and save MathType equations in Word, with numbering and references.

The interface supports Chinese and English. There's a [longer feature list](docs/features.md).

## Screenshots

The actual workbench, with the typography preview and LaTeX below the editor:

![Equation Lab workbench](docs/preview/workbench.png)

Templates and letters can be browsed by category or searched.

![Template library](docs/preview/template-library.png)

![Letter library](docs/preview/letter-library.png)

The matrix and Word plugin settings:

<table>
  <tr><th>Matrices</th><th>Word plugin</th></tr>
  <tr>
    <td><img src="docs/preview/matrix-builder.png" width="460" alt="Custom matrix settings"></td>
    <td><img src="docs/preview/word-plugin.png" width="460" alt="Word plugin management"></td>
  </tr>
</table>

[All seven screenshots](docs/preview/README.md), including spacing settings and rendering examples.

## Build it yourself

You'll need Apple Silicon, macOS 14+, the Swift 6 command-line tools, Node and npm.

```sh
npm ci
swift build
npm test
./scripts/build_and_run.sh --build-only
```

The app is created at `dist/EquationLab.app`. Development builds use your local Node installation; the downloadable installer includes its own runtime.

See the [development notes](docs/development.md) for source and dependency details. Building a complete installer with Word integration also needs a Word-compiled loader; the [packaging notes](packaging/README.md) explain that part.

## Known limits

Only Word for Mac is connected so far. There is no Excel or PowerPoint integration. MathType features and cross-platform compatibility are still being worked on; not every formula or Word version has been verified. Older documents may need fonts installed separately.

The complete installer hasn't yet been tested from start to finish on a fresh Mac. If you hit a problem, keep the original document so it can be reproduced.

## License

Original code and artwork use [MIT](LICENSE). See the [third-party notices](THIRD_PARTY_NOTICES.md) for software, fonts, product marks and the blank-equation protocol fixture. This is an independent project, unaffiliated with Microsoft or MathType.
