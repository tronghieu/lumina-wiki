---
stepsCompleted: [0]
project_name: 'LuminaWiki'
date: '2026-05-06'
type: 'spec'
status: 'draft'
---

# Spec: Multilingual Installer & Workspace Seeding

## Outcome
Provide a localized first-run experience that allows users to select English, Vietnamese, or Chinese as their primary language, automatically configuring the workspace's UI, documentation, and agent communication settings.

## High-Level Intent
- **Language-First Setup**: The very first prompt in `node bin/lumina.js install` will be a language selector (EN, VI, ZH).
- **Localized CLI UX**: All subsequent installer steps, progress bars, and success messages will follow the chosen language.
- **Dynamic Seeding**: Based on the selection, the installer will:
  - Seed the chosen language's README (e.g., `README.vi.md`) as the primary `README.md`.
  - Set the `communication_language` and `document_output_language` in `_lumina/config/lumina.config.yaml`.
- **Lazy-Loaded Locales**: Maintain a < 300ms cold-start budget by lazy-loading translation strings only after the language is detected or selected.

## Acceptance Criteria
1. **Language Prompt**: Integrated into `src/installer/prompts.js` using `@clack/prompts`.
2. **Translation Registry**: A centralized `src/installer/locales/` directory containing JSON/MJS translation maps for `en`, `vi`, and `zh`.
3. **Workspace Configuration**: The `manifest.json` and `lumina.config.yaml` must record the selected locale for future upgrades.
4. **Synchronized Documentation**: The installer must successfully link or copy the localized versions of the user guide (`docs/user-guide/{lang}.md`) to the workspace.
5. **Headless Support**: The `--yes` flag must support a `--lang` override (e.g., `lumina install --yes --lang vi`), defaulting to `en` if omitted.
