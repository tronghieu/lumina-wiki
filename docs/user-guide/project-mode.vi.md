# Dùng project mode cho tài liệu sẵn có của dự án

Project mode xây một đồ thị (graph) có kiểu trên các tài liệu dự án bạn đã có sẵn — quyết định, yêu cầu, quy tắc, quy trình — thay vì xây một wiki mới.
Lumina không viết trang markdown nào và không bao giờ sửa tài liệu của bạn, ngoại trừ hai việc bạn duyệt trong lúc thiết lập: sửa frontmatter, và một tệp glossary.
Không có `raw/` và không có `wiki/`: tài liệu của bạn vẫn ở nguyên chỗ cũ, và đồ thị được dựng lại từ chúng mỗi lần đọc.

Dùng wiki cổ điển khi bạn đang gom tài liệu bên ngoài: bài báo, sách, bài viết, ghi chú nghiên cứu.
Dùng project mode khi dự án của bạn đã có sẵn tài liệu riêng.
Bạn có thể đặt câu hỏi xuyên suốt chúng, hoặc bắt các điểm không nhất quán, mà không phải viết thêm một bản sao nào của bất cứ thứ gì.

## Cài đặt

Từ thư mục gốc của repo dự án:

```bash
npx lumina-wiki install --mode project
```

Trả lời các câu hỏi cài đặt, hoặc chạy không tương tác với `--yes`. Project mode cài vào một hoặc nhiều trong ba đích, chọn bằng `--ide-targets`:

```bash
npx lumina-wiki install --mode project --yes --ide-targets claude_code,codex
```

- `claude_code` — Claude Code
- `codex` — Codex và các CLI khác tương thích `AGENTS.md`
- `antigravity` — Antigravity

Với `--yes` và không có `--ide-targets`, project mode chỉ cài cho `claude_code`. `--mode project` không thể kết hợp với `--packs`, `--agents`, hay một profile — đó là các cờ chỉ dành cho classic mode. Kết hợp chúng sẽ thoát với lỗi.

## Thiết lập

Chạy `lumi-project-setup` tiếp theo. Nó quét các tài liệu trong phạm vi và đề xuất một phạm vi, một ánh xạ loại/quan hệ, và một bộ từ vựng khái niệm. Nó không ghi gì cho đến khi bạn duyệt.

Sau khi duyệt, xác nhận việc thiết lập đã thành công:

```bash
node _lumina/project/project.mjs status
```

Một thiết lập mới, chưa ingest gì, trông như sau (đã rút gọn):

```json
{
  "docs": [
    { "path": "docs/adr/0001-use-postgres.md", "hash": "b00b80fe0172...", "state": "never-ingested" },
    { "path": "docs/adr/0002-cache-layer.md", "hash": "629cdbcc2c71...", "state": "never-ingested" }
  ],
  "summary": { "fresh": 0, "changed": 0, "stale": 0, "neverIngested": 2 }
}
```

Mỗi tài liệu xuất hiện kèm một trạng thái. `never-ingested` cho mọi tài liệu, ngay sau khi thiết lập, là bình thường — chưa có gì được đọc vào đồ thị.

## Ingest và hỏi

Chạy `lumi-project-ingest` để đọc tài liệu của bạn vào đồ thị. Ở lần chạy đầu, khi chưa ingest gì, nó đề xuất mọi tài liệu. Quá 20 tài liệu, nó hiện số lượng và chờ bạn duyệt trước khi tiếp tục.

Sau đó, đặt một câu hỏi:

> "ADR-0001 quyết định gì về datastore?"

`lumi-project-ask` trả lời từ đồ thị và phần văn bản tài liệu nó trích dẫn, trỏ tới `file:line` cho mỗi khẳng định.
Nó kết thúc mỗi câu trả lời bằng một ghi chú độ mới: bao nhiêu tài liệu đang stale, changed, hoặc never ingested trên toàn dự án, kèm tên đường dẫn của các tài liệu stale.

## Giữ mọi thứ luôn mới

Không có hook, và không có gì chạy khi lưu tệp. Sửa một tài liệu đã ingest, nó chuyển sang `changed`; lần chạy `lumi-project-ingest` mặc định tiếp theo sẽ tự động xử lý nó.

Một tài liệu mới thêm vào bắt đầu ở `never-ingested`. Lần chạy mặc định bỏ qua nó — nêu tên tài liệu, hoặc nói "ingest all", để đưa nó vào. Báo cáo luôn nêu rõ còn bao nhiêu tài liệu `never-ingested`.

## Khắc phục các lỗi thường gặp

### Một tệp fact mồ côi

`lumi-project-check` hoặc `lumi-project-verify` báo một tệp fact mà tài liệu nguồn của nó đã bị xóa.

1. Chạy `node _lumina/project/project.mjs facts-prune --dry-run`.
2. Xem lại danh sách `removed` và `kept` nó hiện ra. `out-of-scope` nghĩa là tài liệu vẫn còn nhưng đã rơi ra khỏi phạm vi. `rename-candidate` nghĩa là tài liệu đã đổi tên và chưa được ingest lại ở đường dẫn mới.
3. Duyệt việc xóa.
4. Chạy `node _lumina/project/project.mjs facts-prune` với các đường dẫn đã duyệt.
5. Commit việc xóa.

Với một rename candidate, ingest đường dẫn mới trước — prune tệp cũ chỉ chạy được khi tệp mới đã có fact được commit riêng.

### Một tài liệu stale

Các fact đã commit của nó không còn khớp với văn bản hiện tại. Chạy `lumi-project-ingest` trên tài liệu đó.

### Một lỗi `config-check`

`_lumina/config/project.yaml` không hợp lệ. Chạy `node _lumina/project/project.mjs config-check` để xem đúng vấn đề. Tự sửa tệp, hoặc chạy lại `lumi-project-setup` để nó sửa giúp bạn. Rồi chạy `config-check` lại để xác nhận.

### Một xung đột mode

`Project mode (detected or --mode project) cannot be combined with --packs, --agents, or a profile` nghĩa là bạn đã truyền một cờ chỉ dành cho classic mode cùng với `--mode project`, hoặc trong một repo đã được thiết lập project mode. Bỏ cờ đó, hoặc bỏ `--mode project` nếu bạn muốn dùng wiki cổ điển.

## Gỡ cài đặt

```bash
npx lumina-wiki uninstall
```

Lệnh này gỡ mọi thứ bên trong `_lumina/` ngoại trừ `_lumina/facts/` và `_lumina/config/`, cùng với sáu skill, các symlink trong `.claude/skills`, và các khối mốc khỏi `CLAUDE.md`, `AGENTS.md`, và `.gitignore`. `_lumina/facts/` và `_lumina/config/` được xử lý riêng: `uninstall --yes` luôn giữ chúng lại; không kèm `--yes`, nó hỏi trước và chỉ xóa nếu bạn xác nhận.

## Tham khảo

### Những gì bản cài đặt ghi ra

Project mode không bao giờ tạo `raw/` hay `wiki/`. Nó ghi ra:

- `_lumina/project/` — engine (`project.mjs` và các thư viện của nó). Đã commit.
- `_lumina/config/` — phạm vi bạn đã duyệt và ánh xạ loại/quan hệ (`project.yaml`), được setup ghi sau đó. Đã commit.
- `_lumina/facts/` — một tệp cho mỗi tài liệu nguồn, chứa các fact mà agent trích ra từ đó. Đã commit.
- `_lumina/graph/` — tệp xem đồ thị. Bị gitignore, được dựng lại mỗi lần chạy `lumi-project-view`.
- `_lumina/_state/` — khóa ghi của engine. Bị gitignore.
- `_lumina/manifest.json` — thông tin quản lý cài đặt cục bộ. Bị gitignore.
- `.agents/skills/lumi-project-*` — sáu skill bên dưới, cho mọi đích đã chọn.
- `.claude/skills/lumi-project-*` — symlink tới cùng các skill đó, chỉ khi `claude_code` là một đích đã chọn.
- Một khối ngắn giữa các mốc `<!-- lumina:project -->` trong `CLAUDE.md` (cho `claude_code`) và/hoặc `AGENTS.md` (cho `codex` hoặc `antigravity`), trỏ ứng dụng AI của bạn tới `_lumina/project/PROJECT.md`.
- Một khối ngắn giữa các mốc `# >>> lumina` trong `.gitignore`, bao trùm ba đường dẫn bị gitignore ở trên.

### Skills

Cách gọi một skill tùy vào ứng dụng AI bạn dùng (ví dụ một slash command trong Claude Code, `$name` trong Codex) — kiểm tra quy ước riêng của ứng dụng bạn.

- **lumi-project-setup** — quét các tài liệu trong phạm vi và đề xuất phạm vi, một ánh xạ loại/quan hệ, và một bộ từ vựng khái niệm; không ghi gì cho đến khi bạn duyệt. Ví dụ: "thiết lập project mode cho repo này."
- **lumi-project-ingest** — đọc những gì tài liệu của bạn nói ngoài cấu trúc của chúng — chúng liên hệ với nhau ra sao, và một mục nêu trạng thái gì — rồi commit theo từng tài liệu, mặc định là các tài liệu đã changed hoặc đã stale. Ví dụ: "ingest các tài liệu tôi vừa sửa trong docs/adr/."
- **lumi-project-ask** — trả lời một câu hỏi dự án từ đồ thị và phần văn bản tài liệu nó trích dẫn, có phương án dự phòng tìm kiếm tài liệu khi không có gì khớp. Ví dụ: "ADR-0052 quyết định gì về cost book?"
- **lumi-project-check** — chạy lint của đồ thị và báo các phát hiện theo rule id kèm một cách sửa khả dĩ cho mỗi phát hiện. Ví dụ: "kiểm tra đồ thị tài liệu dự án xem có vấn đề gì không."
- **lumi-project-verify** — kiểm tra bằng chứng của mọi fact đã commit và báo những fact không còn khớp với tài liệu của nó, hoặc tài liệu nguồn đã biến mất. Ví dụ: "kiểm tra xem có fact nào đã commit bị stale hoặc hỏng không."
- **lumi-project-view** — mở một khung xem đồ thị có thể duyệt và lọc được. Ví dụ: "cho tôi xem đồ thị dự án."

### Trạng thái tài liệu

- `fresh` — các fact đã commit vẫn khớp với văn bản hiện tại.
- `changed` — tài liệu đã thay đổi kể từ khi fact của nó được commit.
- `stale` — các fact đã commit không còn đúng nữa: một câu trích dẫn đã biến mất, một tham chiếu không còn giải quyết được, cấu hình hoặc ontology đã thay đổi kể từ khi tài liệu đó được ingest, hoặc tệp fact của nó bị lỗi định dạng.
- `never-ingested` — chưa có fact nào được commit cho tài liệu này.
