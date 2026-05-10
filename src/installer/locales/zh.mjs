// Simplified Chinese (zh-Hans) locale strings — AI-drafted.
// Community review pending. See _meta below.

export const _meta = Object.freeze({
  translation_status: 'ai-draft',
  ai_model: 'claude-opus-4-7',
  drafted: '2026-05-07',
});

export default {
  // ── Intro / cancellation ───────────────────────────────────────────────────
  'prompt.intro':                              'Lumina Wiki 安装程序',
  'prompt.cancelled':                          '已取消安装。',

  // ── Directory ──────────────────────────────────────────────────────────────
  'prompt.directory.message':                  '安装目录',

  // ── Research purpose ───────────────────────────────────────────────────────
  'prompt.purpose.message':                    '研究用途(可选 — 描述此 wiki 的用途)',
  'prompt.purpose.placeholder':                '例如:跟踪 flash-attention 各种变体用于综述',

  // ── IDE targets ────────────────────────────────────────────────────────────
  'prompt.ide.message':                        'IDE 目标(空格切换,回车确认)',
  'prompt.ide.option.claude_code.label':       'Claude Code',
  'prompt.ide.option.claude_code.hint':        'CLAUDE.md + .claude/skills/ 软链接',
  'prompt.ide.option.codex.label':             'OpenAI CodexApp (ChatGPT)',
  'prompt.ide.option.codex.hint':              'CodexApp、Amp、Crush、Goose、Auggie、OpenCode、Kimi、Mistral Vibe — 写入 AGENTS.md',
  'prompt.ide.option.gemini_cli.label':        'Gemini CLI',
  'prompt.ide.option.gemini_cli.hint':         'GEMINI.md 桩文件',
  'prompt.ide.option.qwen.label':              'Qwen Code',
  'prompt.ide.option.qwen.hint':               'QWEN.md 桩文件',
  'prompt.ide.option.iflow.label':             'iFlow CLI',
  'prompt.ide.option.iflow.hint':              'IFLOW.md 桩文件',
  'prompt.ide.option.cursor.label':            'Cursor',
  'prompt.ide.option.cursor.hint':             '.cursor/rules/lumina.mdc 桩文件',
  'prompt.ide.option.generic.label':           '通用',
  'prompt.ide.option.generic.hint':            '仅 README.md',

  // ── Packs ──────────────────────────────────────────────────────────────────
  'prompt.packs.message':                      '要安装的包(core 始终包含)',
  'prompt.packs.option.research.label':        'Research',
  'prompt.packs.option.research.hint':         'discover/survey/prefill/setup 技能 + 来源抓取工具',
  'prompt.packs.option.reading.label':         'Reading',
  'prompt.packs.option.reading.hint':          'chapter-ingest/character-track/theme-map/plot-recap 技能',
  'prompt.packs.option.learning.label':        'Learning',
  'prompt.packs.option.learning.hint':         '自我反思技能 (reflect 技能 + wiki/reflections/)',

  // ── Language pair ──────────────────────────────────────────────────────────
  'prompt.communication_language.message':     '交流语言(LLM 与你对话使用的语言)',
  'prompt.document_output_language.message':   '文档输出语言(wiki 页面所用语言)',

  // ── Uninstall prompts ──────────────────────────────────────────────────────
  'prompt.uninstall.confirm':                  '卸载 Lumina Wiki?将移除 _lumina/、.agents/ 及 IDE 桩文件。wiki/ 与 raw/ 保留。',
  'prompt.uninstall.readme.message':           '如何处理 README.md?',
  'prompt.uninstall.readme.option.keep.label': '保留 README.md 不变(默认)',
  'prompt.uninstall.readme.option.keep.hint':  'Lumina schema 区域作为普通 markdown 保留',
  'prompt.uninstall.readme.option.strip.label':'移除 schema 区域',
  'prompt.uninstall.readme.option.strip.hint': '删除 <!-- lumina:schema --> 块;保留你的内容',

  // ── README merge prompt ────────────────────────────────────────────────────
  'prompt.readme_merge.message':               'README.md 已存在。Lumina 应如何处理 schema 区域?',
  'prompt.readme_merge.option.merge.label':    '合并 schema 内容',
  'prompt.readme_merge.option.merge.hint':     '仅重写 <!-- lumina:schema --> 区域;其余保留',
  'prompt.readme_merge.option.backup.label':   '备份并替换',
  'prompt.readme_merge.option.backup.hint':    '保存当前为 README.md.bak,写入新 README.md',
  'prompt.readme_merge.option.abort.label':    '中止安装',
  'prompt.readme_merge.option.abort.hint':     '退出且不做更改',

  // ── Progress ───────────────────────────────────────────────────────────────
  'progress.installing':                       '正在安装 Lumina Wiki 至: {dir}',
  'progress.upgrading':                        '正在升级 Lumina Wiki 至: {dir}',

  // ── Success summary ────────────────────────────────────────────────────────
  'success.installed':                         '[完成] Lumina Wiki 安装成功。',
  'success.summary.project':                   '  项目:    {name}',
  'success.summary.packs':                     '  包:      {packs}',
  'success.summary.ide':                       '  IDE:      {ide}',
  'success.summary.skills':                    '  技能:    已安装 {count} 个',

  // ── Warnings ───────────────────────────────────────────────────────────────
  'warn.manifest_read':                        '[警告] 无法读取现有 manifest: {message}。视为全新安装。',
  'warn.copied_skills':                        '  [警告] 部分技能采用复制而非软链接。启用 Windows 开发者模式后请运行 "lumina install --re-link"。',
  'warn.upgrade_header':                       '[警告] Lumina 已从 v{from} 升级到 v{to} — 检测到 schema 差异:',
  'warn.upgrade_errors':                       '       旧条目共有 {errors} 个错误、{warnings} 个警告。',
  'warn.upgrade_fix_quick':                    '     快速修复(确定性):',
  'warn.upgrade_fix_quick_cmd':                '       node _lumina/scripts/wiki.mjs migrate --add-defaults',
  'warn.upgrade_fix_smart':                    '     智能修复(LLM 驱动,推荐):',
  'warn.upgrade_fix_smart_cmd':                '       /lumi-migrate-legacy',
  'warn.upgrade_idempotent':                   '     两者都是幂等的。详见 _lumina/CHANGELOG.md。',

  // ── Uninstall output ───────────────────────────────────────────────────────
  'uninstall.cancelled':                       '已取消卸载。',
  'uninstall.removed_lumina':                  '[完成] 已移除 _lumina/',
  'uninstall.removed_agents':                  '[完成] 已移除 .agents/',
  'uninstall.stripped_readme':                 '[完成] 已从 README.md 移除 schema 区域',
  'uninstall.complete':                        '[完成] 卸载完成。wiki/ 与 raw/ 保留。',

  // ── README merge output ────────────────────────────────────────────────────
  'readme.aborted':                            '已中止: README.md 未更改。',

  // ── Symlink error ──────────────────────────────────────────────────────────
  'error.symlink':                             '  [错误] 无法链接 {skill}: {message}',

};
