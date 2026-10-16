# Equation Lab

A native macOS editor for MathType equations in Word, with visual editing, a Word typography preview and editable LaTeX side by side.

**Compatibility preview · Apple Silicon · macOS 14+**

[Download the full installer](https://github.com/Ne1ther/EquationLab/releases/download/v0.5.5/Equation-Lab-0.5.5.pkg) · [Releases](https://github.com/Ne1ther/EquationLab/releases) · [安装说明](docs/install.md)

## Preview

![Equation Lab workbench](docs/preview/workbench.png)

An actual workbench window using a demonstration formula. See [more screenshots](docs/preview/README.md), including the rendering resources used in build38.

## Features

- Visual formula editing and LaTeX input, with native font and typography settings.
- Searchable templates, integrals, matrices, symbols and letters; SVG, PDF and PNG export.
- Native Word equation editing and save-back, numbering and references.
- Chinese and English interface. [Current feature scope](docs/features.md).

## Install

Download **Equation-Lab-0.5.5.pkg** from [v0.5.5 build38](https://github.com/Ne1ther/EquationLab/releases/tag/v0.5.5). Save your documents and quit Word before installation, then reopen Word and use the **Equation Lab** ribbon.

The complete PKG includes the App, Node runtime, engine dependencies, font helper, STIX Two Math font and native Word integration. The Word plugin is installed by default. Ordinary users do not need a source checkout, Node, npm, Swift, Xcode or Python.

Word integration requires desktop Microsoft Word for Mac. Imported documents can require additional fonts. This preview uses ad-hoc app signing and an unsigned, unnotarized installer; first installation on a fresh Mac remains unverified. See [installation](docs/install.md) and [release notes](docs/releases.md).

## Build from source

Development requires Apple Silicon, macOS 14+, Xcode Command Line Tools with Swift 6, Node and npm.

```sh
npm ci
swift build
npm test
./scripts/build_and_run.sh --build-only
```

The development App is created at `dist/EquationLab.app`. It uses the developer's Node installation. Distributable installers include their own runtime.

Both renderer resources are included. They use the shipped STIX Two Math font, project geometry and MathJax TeX spacing; the generator and licenses are included. To regenerate them, run `node scripts/build/build-rendering-resources.mjs`. Some preview contours and spacing differ from the previous vendor-derived resources.

The export's 129 public tests pass. Ten tests requiring local original-format and Word research fixtures are omitted. Full Word installer builds additionally require a Word-compiled loader and matching host-validated artifacts; bridge and VBA source are included. See [development](docs/development.md) and [packaging](packaging/README.md).

## Repository layout

| Path | Contents |
| --- | --- |
| `macos/` | SwiftUI/AppKit interface |
| `desktop/` | Embedded formula editor |
| `src/` | Formula, document and rendering engine |
| `native-word-probe/` | Word bridge and loader source |
| `scripts/`, `packaging/` | Builds, resource generation and installers |
| `tests/` | Public tests |
| `docs/preview/` | Selected actual screenshots |

Installers are distributed through Releases. REA archives, original vendor materials, private Word samples, machine configuration, automatic checkpoints, installed dependencies and build caches stay outside the source repository.

## License and compatibility

Original project code and artwork use [MIT](LICENSE). Third-party software, fonts and product marks retain their own terms; see [third-party materials and provenance](THIRD_PARTY_NOTICES.md), including the retained blank-equation protocol fixture. Equation Lab is an independent project.

Full MathType feature equivalence, every formula's Windows/Mac round trip and all Word versions have not been established. Excel and PowerPoint integration are not available.
