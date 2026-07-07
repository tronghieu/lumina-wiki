// English (en) locale strings — full installer copy.
// Keys are dot-notation; values may contain {varName} placeholders.
// Banner strings are intentionally absent: banner.js is hardcoded EN by design.

export default {
  // ── Intro / cancellation ───────────────────────────────────────────────────
  'prompt.intro':                              'Lumina Wiki Installer',
  'prompt.cancelled':                          'Installation cancelled.',

  // ── Directory ──────────────────────────────────────────────────────────────
  'prompt.directory.message':                  'Installation directory',

  // ── Research purpose ───────────────────────────────────────────────────────
  'prompt.purpose.message':                    'Research purpose (optional — describe what this wiki is for)',
  'prompt.purpose.placeholder':                'e.g. Track flash-attention variants for a survey',

  // ── IDE targets ────────────────────────────────────────────────────────────
  'prompt.ide.message':                        'IDE targets (space to toggle, enter to confirm)',
  'prompt.ide.option.claude_code.label':       'Claude Code',
  'prompt.ide.option.claude_code.hint':        'CLAUDE.md + .claude/skills/ symlinks',
  'prompt.ide.option.codex.label':             'OpenAI CodexApp (ChatGPT)',
  'prompt.ide.option.codex.hint':              'CodexApp, Amp, Crush, Goose, Auggie, OpenCode, Kimi, Mistral Vibe — writes AGENTS.md',
  'prompt.ide.option.gemini_cli.label':        'Gemini CLI',
  'prompt.ide.option.gemini_cli.hint':         'GEMINI.md stub',
  'prompt.ide.option.qwen.label':              'Qwen Code',
  'prompt.ide.option.qwen.hint':               'QWEN.md stub',
  'prompt.ide.option.iflow.label':             'iFlow CLI',
  'prompt.ide.option.iflow.hint':              'IFLOW.md stub',
  'prompt.ide.option.cursor.label':            'Cursor',
  'prompt.ide.option.cursor.hint':             '.cursor/rules/lumina.mdc stub',
  'prompt.ide.option.generic.label':           'Generic',
  'prompt.ide.option.generic.hint':            'README.md only',

  // ── Packs ──────────────────────────────────────────────────────────────────
  'prompt.packs.message':                      'Packs to install (core is always included)',
  'prompt.packs.option.research.label':        'Research',
  'prompt.packs.option.research.hint':         'discover/survey/prefill/setup skills + source-fetcher tools',
  'prompt.packs.option.reading.label':         'Reading',
  'prompt.packs.option.reading.hint':          'chapter-ingest/character-track/theme-map/plot-recap skills',
  'prompt.packs.option.learning.label':        'Learning',
  'prompt.packs.option.learning.hint':         'self-reflection skills (reflect skill + wiki/reflections/)',

  // ── Language pair ──────────────────────────────────────────────────────────
  'prompt.communication_language.message':     'Communication language (how the LLM talks to you)',
  'prompt.document_output_language.message':   'Document output language (language wiki pages are written in)',

  // ── Uninstall prompts ──────────────────────────────────────────────────────
  'prompt.uninstall.confirm':                  'Uninstall Lumina Wiki? This will remove _lumina/, .agents/, and IDE stub files. wiki/ and raw/ are preserved.',
  'prompt.uninstall.readme.message':           'What to do with README.md?',
  'prompt.uninstall.readme.option.keep.label': 'Keep README.md intact (default)',
  'prompt.uninstall.readme.option.keep.hint':  'Lumina schema region remains as plain markdown',
  'prompt.uninstall.readme.option.strip.label':'Strip schema region',
  'prompt.uninstall.readme.option.strip.hint': 'Remove <!-- lumina:schema --> block; keep your content',

  // ── README merge prompt ────────────────────────────────────────────────────
  'prompt.readme_merge.message':               'README.md already exists. How should Lumina handle the schema region?',
  'prompt.readme_merge.option.merge.label':    'Merge schema content',
  'prompt.readme_merge.option.merge.hint':     'Rewrite only <!-- lumina:schema --> region; preserve everything else',
  'prompt.readme_merge.option.backup.label':   'Back up and replace',
  'prompt.readme_merge.option.backup.hint':    'Save current README.md.bak, write fresh README.md',
  'prompt.readme_merge.option.abort.label':    'Abort install',
  'prompt.readme_merge.option.abort.hint':     'Exit without changes',

  // ── Upgrade mode prompt ────────────────────────────────────────────────────
  'prompt.upgrade_mode.message':               'Existing installation found. How would you like to proceed?',
  'prompt.upgrade_mode.option.quick.label':    'Quick update',
  'prompt.upgrade_mode.option.quick.hint':     'keep current packs, IDE targets, and languages',
  'prompt.upgrade_mode.option.modify.label':   'Modify installation',
  'prompt.upgrade_mode.option.modify.hint':    'add or remove packs and IDE targets, change languages',

  // ── Progress ───────────────────────────────────────────────────────────────
  'progress.installing':                       'Installing Lumina Wiki in: {dir}',
  'progress.upgrading':                        'Upgrading Lumina Wiki in: {dir}',

  // ── Success summary ────────────────────────────────────────────────────────
  'success.installed':                         '[done] Lumina Wiki installed successfully.',
  'success.summary.project':                   '  Project:  {name}',
  'success.summary.packs':                     '  Packs:    {packs}',
  'success.summary.ide':                       '  IDE:      {ide}',
  'success.summary.skills':                    '  Skills:   {count} installed',
  'hint.packs_available':                      '  Tip: more packs are available: {packs}. Run "npx lumina-wiki install" again and choose "Modify installation" to add them.',

  // ── Warnings ───────────────────────────────────────────────────────────────
  'warn.manifest_read':                        '[warn] Could not read existing manifest: {message}. Treating as fresh install.',
  'warn.copied_skills':                        '  [warn] Some skills were copied instead of symlinked. Run "lumina install --re-link" after enabling Windows Developer Mode.',
  'warn.relocated':                            '  [warn] Workspace moved from {from} to {to}; managed links will be refreshed.',
  'warn.preserved_modified_file':               '  [warn] Kept modified file that is no longer selected: {path}',
  'warn.upgrade_header':                       '[warn] Lumina upgraded v{from} -> v{to} — schema gap detected:',
  'warn.upgrade_errors':                       '       {errors} error(s), {warnings} warning(s) across legacy entries.',
  'warn.upgrade_fix_quick':                    '     Quick fix (deterministic):',
  'warn.upgrade_fix_quick_cmd':                '       node _lumina/scripts/wiki.mjs migrate --add-defaults',
  'warn.upgrade_fix_smart':                    '     Smart fix (LLM-driven, recommended):',
  'warn.upgrade_fix_smart_cmd':                '       /lumi-migrate-legacy',
  'warn.upgrade_idempotent':                   '     Both are idempotent. See _lumina/CHANGELOG.md for details.',

  // ── Uninstall output ───────────────────────────────────────────────────────
  'uninstall.cancelled':                       'Uninstall cancelled.',
  'uninstall.removed_lumina':                  '[done] Removed _lumina/',
  'uninstall.removed_agents':                  '[done] Removed .agents/',
  'uninstall.stripped_readme':                 '[done] Stripped schema region from README.md',
  'uninstall.complete':                        '[done] Uninstall complete. wiki/ and raw/ preserved.',

  // ── README merge output ────────────────────────────────────────────────────
  'readme.aborted':                            'Aborted: README.md left unchanged.',

  // ── Symlink error ──────────────────────────────────────────────────────────
  'error.symlink':                             '  [error] Failed to link {skill}: {message}',

};
