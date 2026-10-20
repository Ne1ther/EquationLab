# Equation Lab

- This project root is the working checkout of `Ne1ther/EquationLab`. Keep `main` tracking `origin/main` and maintain source and documentation here. Do not create another upload checkout under `dist/`.
- Write the README in plain, personal language. Keep the installer link easy to find, retain actual screenshots, and update the Chinese and English versions together. Their export templates live in `packaging/source-README*.md.in`.
- Put app screenshots in `docs/preview/`. Publish installers through GitHub Releases; keep only the current installer locally under `dist/`.
- Local `research/`, `.local/`, `evidence/` and `output/` contain REA material, original inputs and Word validation records. Keep them local. Never force-add ignored research files or machine configuration to Git.
- Preserve existing original materials and host-compiled Word release inputs. Build caches, installed dependencies and superseded app bundles are replaceable.
- Preserve `.local/update-signing/`: it holds the private release-update signing key. Only the public key in `updater/UpdateTrust.swift` belongs in Git. Complete releases must include the signed `EquationLab-update.json` asset.
- The local Git database can also contain active editor checkpoint refs. Do not delete, prune or replace those refs or objects, and never mirror-push the local repository.
- Use `npm ci` and the existing `scripts/` entry points when rebuilding. Run checks that match the change; ordinary README edits do not need an app rebuild.
- During local functional iteration, use a user-writable test app and user-scoped Word components. Do not repeatedly open PKG installers or ask for administrator authentication. Reserve the system installer for a final release installation check. Record the actual running app path/build and helper/template hashes so tests cannot silently use an older installed copy.
- Keep compatibility claims tied to what was actually verified. A working preview does not establish full MathType equivalence or every Word/Windows round trip.
