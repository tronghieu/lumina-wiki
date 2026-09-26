# Project mode

Project mode là một cách cài đặt riêng của Lumina-Wiki. Thay vì xây một wiki mới từ tài liệu bạn thêm vào, nó xây một đồ thị (graph) có kiểu trực tiếp trên các tài liệu đã có sẵn của dự án.

## Project mode là gì

Project mode đọc các tài liệu đã có của dự án bạn — quyết định, yêu cầu, quy tắc, quy trình — và biến chúng thành một đồ thị có kiểu: tài liệu (documents), đoạn trích (fragments) và khái niệm (concepts), nối với nhau bằng các quan hệ có kiểu như `supersedes`, `governs`, hay `depends-on`. Lumina không viết trang Markdown nào và không bao giờ sửa tài liệu của bạn, ngoại trừ những chỗ sửa frontmatter bạn tự đồng ý trong lúc thiết lập. Không có `raw/` và không có `wiki/`: tài liệu của bạn vẫn nằm nguyên chỗ cũ, và đồ thị được dựng lại từ chúng mỗi lần đọc.

## Khi nào dùng thay cho wiki cổ điển

Dùng wiki cổ điển (`raw/` + `wiki/`) khi bạn đang gom và tóm tắt tài liệu bên ngoài: bài báo, sách, bài viết, ghi chú nghiên cứu.

Dùng project mode khi dự án của bạn đã có tài liệu riêng — ADR, spec, yêu cầu, trang quy trình — và bạn muốn đặt câu hỏi xuyên suốt chúng, hoặc bắt các điểm không nhất quán (một quyết định đã bị thay thế nhưng vẫn được trích dẫn, một yêu cầu không có gì đáp ứng, một liên kết chéo bị hỏng) mà không phải viết thêm một bản sao nào của bất cứ thứ gì.

## Cài đặt

Từ thư mục gốc của repo dự án:

```bash
npx lumina-wiki install --mode project
```

Trả lời các câu hỏi thiết lập, hoặc chạy không tương tác với `--yes`. Project mode cài vào một hoặc nhiều trong ba đích, chọn bằng `--ide-targets`:

```bash
npx lumina-wiki install --mode project --yes --ide-targets claude_code,codex
```

- `claude_code` — Claude Code
- `codex` — Codex và các CLI khác tương thích `AGENTS.md`
- `antigravity` — Antigravity

Với `--yes` và không có `--ide-targets`, project mode chỉ cài cho `claude_code`. `--mode project` không thể kết hợp với `--packs` hoặc `--agents` — đó là các cờ chỉ dành cho classic mode; kết hợp chúng sẽ thoát với lỗi.

## Những gì bản cài đặt ghi ra

Project mode không bao giờ tạo `raw/` hay `wiki/`. Nó ghi ra:

- `_lumina/project/` — engine (`project.mjs` và các thư viện của nó). Đã commit.
- `_lumina/config/` — phạm vi bạn đã duyệt và ánh xạ loại/quan hệ (`project.yaml`), được setup ghi sau đó. Đã commit.
- `_lumina/facts/` — một tệp JSON cho mỗi tài liệu nguồn, chứa các fact mà agent trích ra từ đó. Đã commit — đây là kết quả mà team bạn đã trả token để có được.
- `_lumina/graph/` — tệp xem đồ thị. Bị gitignore, được dựng lại mỗi lần chạy `lumi-project-view`.
- `_lumina/_state/` — khóa ghi của engine. Bị gitignore.
- `_lumina/manifest.json` — thông tin quản lý cài đặt cục bộ. Bị gitignore.
- `.agents/skills/lumi-project-*` — sáu skill bên dưới, cho mọi đích đã chọn.
- `.claude/skills/lumi-project-*` — symlink tới cùng các skill đó, chỉ khi `claude_code` là một đích đã chọn.
- Một khối ngắn giữa các mốc `<!-- lumina:project -->` trong `CLAUDE.md` (cho `claude_code`) và/hoặc `AGENTS.md` (cho `codex` hoặc `antigravity`), trỏ ứng dụng AI của bạn tới `_lumina/project/PROJECT.md`.
- Một khối ngắn giữa các mốc `# >>> lumina` trong `.gitignore`, bao trùm ba đường dẫn bị gitignore ở trên.

## Sáu skill

Cách gọi một skill tùy vào ứng dụng AI bạn dùng (ví dụ một slash command trong Claude Code, `$name` trong Codex) — kiểm tra quy ước riêng của ứng dụng bạn. Theo thứ tự quy trình làm việc:

- **lumi-project-setup** — quét các tài liệu trong phạm vi và đề xuất phạm vi, ánh xạ loại/quan hệ, và một bộ từ vựng khái niệm; không ghi gì cho đến khi bạn duyệt. Ví dụ: "thiết lập project mode cho repo này."
- **lumi-project-ingest** — ghi nhận các quan hệ và trạng thái đoạn trích (fragment status) cho mỗi tài liệu, trích ra từ phần văn xuôi mà bộ phân tích không đọc được, mặc định chỉ xử lý tài liệu `changed`/`stale`. Ví dụ: "ingest các tài liệu tôi vừa sửa trong docs/adr/."
- **lumi-project-ask** — trả lời một câu hỏi về dự án từ đồ thị, đọc phần văn bản tài liệu mà nó trích dẫn khi câu hỏi cần đến chính nội dung đó, có phương án dự phòng tìm kiếm tài liệu khi không có gì khớp. Ví dụ: "ADR-0052 quyết định gì về cost book?"
- **lumi-project-check** — chạy lint của đồ thị và báo các phát hiện theo rule id kèm một cách sửa khả dĩ cho mỗi phát hiện. Ví dụ: "kiểm tra đồ thị tài liệu dự án xem có vấn đề gì không."
- **lumi-project-verify** — kiểm tra bằng chứng của mọi fact đã commit trên toàn dự án và báo những fact không còn khớp với tài liệu của nó, hoặc tài liệu nguồn đã biến mất. Ví dụ: "kiểm tra xem có fact nào đã commit bị stale hoặc hỏng không."
- **lumi-project-view** — mở một khung xem đồ thị có thể duyệt và lọc được. Ví dụ: "cho tôi xem đồ thị dự án."

## Giữ mọi thứ luôn mới

Không có hook, và không có gì chạy khi lưu tệp. Mỗi lần đọc đều phân tích tài liệu của bạn trực tiếp, nên cấu trúc đồ thị luôn cập nhật; chỉ các fact do agent trích ra trong `_lumina/facts/` mới có thể cũ đi, vì chúng được commit tại một thời điểm cụ thể.

Mỗi tài liệu có một trong bốn trạng thái, được báo bởi `node _lumina/project/project.mjs status`:

- `fresh` — các fact đã commit vẫn khớp với văn bản hiện tại.
- `changed` — tài liệu đã thay đổi kể từ khi fact của nó được commit.
- `stale` — các fact đã commit không còn đúng nữa: một câu trích dẫn đã biến mất, một tham chiếu không còn giải quyết được, cấu hình hoặc ontology đã thay đổi kể từ khi tài liệu đó được ingest, hoặc tệp fact của nó bị lỗi định dạng (malformed).
- `never-ingested` — chưa có fact nào được commit cho tài liệu này.

Sửa một tài liệu đã ingest sẽ chuyển nó sang `changed`, và lần chạy `lumi-project-ingest` mặc định tiếp theo sẽ tự động xử lý nó. Một tài liệu mới thêm vào bắt đầu ở trạng thái `never-ingested`, và lần chạy mặc định sẽ bỏ qua nó — nêu tên tài liệu, hoặc nói "ingest all", để đưa nó vào; báo cáo luôn nêu rõ còn bao nhiêu tài liệu never-ingested.

`lumi-project-ask` cũng kết thúc mỗi câu trả lời bằng một ghi chú độ mới, nhưng ghi chú này ở phạm vi toàn dự án, không theo từng tài liệu: số lượng tài liệu đang stale, changed, và never ingested, cộng với tên đường dẫn của các tài liệu stale — không phải trạng thái fresh/changed/stale/never-ingested mà `status` báo cho từng tài liệu.

## Khắc phục các lỗi thường gặp

- **Một tệp fact mồ côi (orphaned).** `lumi-project-check` hoặc `lumi-project-verify` báo một tệp fact mà tài liệu nguồn của nó đã bị xóa. Cả hai skill đều chạy `node _lumina/project/project.mjs facts-prune --dry-run` trước và cho bạn xem danh sách `removed`/`kept`; chỉ khi bạn đồng ý chúng mới chạy `node _lumina/project/project.mjs facts-prune`, lệnh này xóa đúng danh sách đã được duyệt đó — commit việc xóa này sau đó. `facts-prune` chỉ bao giờ xóa fact của một tài liệu thực sự đã biến mất khỏi ổ đĩa: một tài liệu vẫn còn trên ổ đĩa nhưng bị loại khỏi phạm vi vẫn giữ fact của nó (`kept: out-of-scope`), và một tài liệu vừa đổi tên cũng vậy cho đến khi đường dẫn mới của nó được ingest lại (`kept: rename-candidate` — ingest đường dẫn mới trước, rồi prune mới xóa tệp cũ).
- **Một tài liệu stale.** Các fact đã commit của nó không còn khớp với văn bản hiện tại. Chạy `lumi-project-ingest` trên tài liệu đó.
- **Một lỗi `config-check`.** `_lumina/config/project.yaml` không hợp lệ. Sửa vấn đề được báo rồi chạy lại `lumi-project-setup`, hoặc chạy lại `node _lumina/project/project.mjs config-check` trực tiếp để xác nhận.
- **Một xung đột mode.** `--mode project cannot be combined with --packs, --agents, or a profile` nghĩa là bạn đã truyền một cờ chỉ dành cho classic mode cùng với `--mode project`. Bỏ cờ đó, hoặc bỏ `--mode project` nếu bạn thực sự muốn dùng wiki cổ điển.

## Gỡ cài đặt

```bash
npx lumina-wiki uninstall
```

Lệnh này gỡ engine, sáu skill, và các khối mốc trong `CLAUDE.md`, `AGENTS.md`, và `.gitignore`. `_lumina/facts/` và `_lumina/config/` được xử lý riêng: `uninstall --yes` luôn giữ chúng lại; chạy không kèm `--yes` sẽ hỏi trước, và chỉ xóa nếu bạn xác nhận.
