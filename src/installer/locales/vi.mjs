// Vietnamese (vi) locale strings.
// Native-speaker authored. Diacritics preserved (UTF-8).

export default {
  // ── Intro / cancellation ───────────────────────────────────────────────────
  'prompt.intro':                              'Trình cài đặt Lumina Wiki',
  'prompt.cancelled':                          'Đã hủy cài đặt.',

  // ── Locale selector ────────────────────────────────────────────────────────
  'prompt.locale.message':                     'Installer language / Ngôn ngữ / 语言',

  // ── Directory ──────────────────────────────────────────────────────────────
  'prompt.directory.message':                  'Thư mục cài đặt',

  // ── Research purpose ───────────────────────────────────────────────────────
  'prompt.purpose.message':                    'Mục đích nghiên cứu (tùy chọn — mô tả wiki này dùng để làm gì)',
  'prompt.purpose.placeholder':                'ví dụ: Theo dõi các biến thể flash-attention cho bài khảo sát',

  // ── IDE targets ────────────────────────────────────────────────────────────
  'prompt.ide.message':                        'IDE đích (space để chọn, enter để xác nhận)',
  'prompt.ide.option.claude_code.label':       'Claude Code',
  'prompt.ide.option.claude_code.hint':        'CLAUDE.md + symlink vào .claude/skills/',
  'prompt.ide.option.codex.label':             'OpenAI CodexApp (ChatGPT)',
  'prompt.ide.option.codex.hint':              'CodexApp, Amp, Crush, Goose, Auggie, OpenCode, Kimi, Mistral Vibe — tạo AGENTS.md',
  'prompt.ide.option.gemini_cli.label':        'Gemini CLI',
  'prompt.ide.option.gemini_cli.hint':         'Tệp stub GEMINI.md',
  'prompt.ide.option.qwen.label':              'Qwen Code',
  'prompt.ide.option.qwen.hint':               'Tệp stub QWEN.md',
  'prompt.ide.option.iflow.label':             'iFlow CLI',
  'prompt.ide.option.iflow.hint':              'Tệp stub IFLOW.md',
  'prompt.ide.option.cursor.label':            'Cursor',
  'prompt.ide.option.cursor.hint':             'Stub .cursor/rules/lumina.mdc',
  'prompt.ide.option.generic.label':           'Chung',
  'prompt.ide.option.generic.hint':            'Chỉ README.md',

  // ── Packs ──────────────────────────────────────────────────────────────────
  'prompt.packs.message':                      'Gói cài đặt (core luôn được bao gồm)',
  'prompt.packs.option.research.label':        'Research',
  'prompt.packs.option.research.hint':         'kỹ năng discover/survey/prefill/setup + công cụ lấy nguồn',
  'prompt.packs.option.reading.label':         'Reading',
  'prompt.packs.option.reading.hint':          'kỹ năng chapter-ingest/character-track/theme-map/plot-recap',

  // ── Language pair ──────────────────────────────────────────────────────────
  'prompt.communication_language.message':     'Ngôn ngữ giao tiếp (LLM trò chuyện với bạn)',
  'prompt.document_output_language.message':   'Ngôn ngữ tài liệu (ngôn ngữ viết các trang wiki)',

  // ── Uninstall prompts ──────────────────────────────────────────────────────
  'prompt.uninstall.confirm':                  'Gỡ cài đặt Lumina Wiki? Sẽ xóa _lumina/, .agents/ và các tệp stub IDE. wiki/ và raw/ được giữ lại.',
  'prompt.uninstall.readme.message':           'Xử lý README.md như thế nào?',
  'prompt.uninstall.readme.option.keep.label': 'Giữ nguyên README.md (mặc định)',
  'prompt.uninstall.readme.option.keep.hint':  'Vùng schema Lumina vẫn nằm dưới dạng markdown',
  'prompt.uninstall.readme.option.strip.label':'Loại bỏ vùng schema',
  'prompt.uninstall.readme.option.strip.hint': 'Xóa khối <!-- lumina:schema -->; giữ nội dung của bạn',

  // ── README merge prompt ────────────────────────────────────────────────────
  'prompt.readme_merge.message':               'README.md đã tồn tại. Lumina nên xử lý vùng schema thế nào?',
  'prompt.readme_merge.option.merge.label':    'Hợp nhất nội dung schema',
  'prompt.readme_merge.option.merge.hint':     'Chỉ ghi đè vùng <!-- lumina:schema -->; giữ phần còn lại',
  'prompt.readme_merge.option.backup.label':   'Sao lưu rồi thay thế',
  'prompt.readme_merge.option.backup.hint':    'Lưu README.md.bak, ghi README.md mới',
  'prompt.readme_merge.option.abort.label':    'Hủy cài đặt',
  'prompt.readme_merge.option.abort.hint':     'Thoát mà không thay đổi gì',

  // ── Progress ───────────────────────────────────────────────────────────────
  'progress.installing':                       'Đang cài đặt Lumina Wiki tại: {dir}',
  'progress.upgrading':                        'Đang nâng cấp Lumina Wiki tại: {dir}',

  // ── Success summary ────────────────────────────────────────────────────────
  'success.installed':                         '[xong] Đã cài đặt Lumina Wiki thành công.',
  'success.summary.project':                   '  Dự án:    {name}',
  'success.summary.packs':                     '  Gói:      {packs}',
  'success.summary.ide':                       '  IDE:      {ide}',
  'success.summary.skills':                    '  Kỹ năng:  {count} đã cài',

  // ── Warnings ───────────────────────────────────────────────────────────────
  'warn.manifest_read':                        '[cảnh báo] Không đọc được manifest hiện tại: {message}. Coi như cài đặt mới.',
  'warn.copied_skills':                        '  [cảnh báo] Một số kỹ năng được sao chép thay vì symlink. Chạy "lumina install --re-link" sau khi bật Windows Developer Mode.',
  'warn.upgrade_header':                       '[cảnh báo] Lumina đã nâng cấp v{from} -> v{to} — phát hiện chênh lệch schema:',
  'warn.upgrade_errors':                       '       {errors} lỗi, {warnings} cảnh báo trên các mục cũ.',
  'warn.upgrade_fix_quick':                    '     Sửa nhanh (xác định):',
  'warn.upgrade_fix_quick_cmd':                '       node _lumina/scripts/wiki.mjs migrate --add-defaults',
  'warn.upgrade_fix_smart':                    '     Sửa thông minh (LLM, khuyến nghị):',
  'warn.upgrade_fix_smart_cmd':                '       /lumi-migrate-legacy',
  'warn.upgrade_idempotent':                   '     Cả hai đều idempotent. Xem _lumina/CHANGELOG.md để biết chi tiết.',

  // ── Uninstall output ───────────────────────────────────────────────────────
  'uninstall.cancelled':                       'Đã hủy gỡ cài đặt.',
  'uninstall.removed_lumina':                  '[xong] Đã xóa _lumina/',
  'uninstall.removed_agents':                  '[xong] Đã xóa .agents/',
  'uninstall.stripped_readme':                 '[xong] Đã loại bỏ vùng schema khỏi README.md',
  'uninstall.complete':                        '[xong] Gỡ cài đặt hoàn tất. wiki/ và raw/ được giữ lại.',

  // ── README merge output ────────────────────────────────────────────────────
  'readme.aborted':                            'Đã hủy: README.md không thay đổi.',

  // ── Symlink error ──────────────────────────────────────────────────────────
  'error.symlink':                             '  [lỗi] Không thể liên kết {skill}: {message}',

};
