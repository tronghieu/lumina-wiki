<p align="left" lang="vi">
  <img src="assets/lumina-logo.png" width="250" alt="Biểu trưng Lumina-Wiki">
</p>

# Lumina-Wiki

> **Where Knowledge Starts to Glow.**

Biến những tài liệu bạn đọc thành một thư viện kiến thức có thể hỏi lại bất cứ lúc nào.

Lumina-Wiki tạo cho trợ lý AI của bạn một không gian làm việc lâu dài để học tập và nghiên cứu. Bạn đưa vào bài báo, sách, báo cáo, tài liệu học hoặc ghi chú cá nhân. Trợ lý sẽ tóm tắt, nối các ý liên quan và lưu kết quả thành những tệp Markdown ngay trên máy của bạn.

<p align="center">
  <img alt="Giấy phép" src="https://img.shields.io/badge/License-MIT-blue.svg">
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-%3E%3D20-blue.svg">
</p>

<p align="center">
  <a href="README.md" lang="en">English</a> · Tiếng Việt · <a href="README.zh.md" lang="zh-Hans">简体中文</a>
</p>

<p align="center">
  <a href="docs/user-guide/vi.md">Bắt đầu với hướng dẫn sử dụng</a>
</p>

<p align="center">
  <a href="https://www.youtube.com/watch?v=XuhhjbwoNeQ">
    <img src="https://img.youtube.com/vi/XuhhjbwoNeQ/maxresdefault.jpg" alt="Video hướng dẫn Lumina-Wiki" width="560">
  </a>
  <br>
  <a href="https://www.youtube.com/watch?v=XuhhjbwoNeQ">▶ Xem video hướng dẫn</a>
</p>

## Bạn có thể làm gì?

Lumina-Wiki phù hợp khi bạn muốn:

- giữ lại những điều đã học từ nhiều tài liệu ở cùng một nơi;
- so sánh ý tưởng hoặc bằng chứng giữa nhiều nguồn;
- chuẩn bị cho kỳ thi, bài luận, tổng quan tài liệu hoặc đề tài dài hạn;
- quay lại một chủ đề cũ mà không phải lục tìm các cuộc trò chuyện trước;
- lưu câu trả lời quan trọng cùng với những nguồn làm căn cứ.

Bạn không phải tự xây wiki bằng tay. Bạn chọn tài liệu và đưa ra những quyết định quan trọng. Trợ lý AI làm phần việc thường ngày như đọc, sắp xếp, tạo liên kết và kiểm tra ghi chú.

## Cách hoạt động

Lumina-Wiki dùng hai thư mục chính:

- `raw/` giữ tài liệu gốc của bạn.
- `wiki/` giữ những ghi chú đã được sắp xếp từ các tài liệu đó.

```text
Tài liệu của bạn trong raw/
        |
        |  lumi-ingest
        v
Ghi chú đã sắp xếp trong wiki/
        |
        |  lumi-ask
        v
Câu trả lời dựa trên những gì bạn đã đọc
```

Tài liệu gốc luôn tách riêng khỏi ghi chú do AI viết. Nhờ vậy, bạn dễ kiểm tra một ý đến từ đâu và sửa lại wiki khi cần.

## Bắt đầu trong vài phút

### Trước khi bắt đầu

Cài bản LTS mới nhất của [Node.js](https://nodejs.org/en/download). Bạn cũng cần một công cụ AI có thể làm việc với thư mục trên máy, chẳng hạn Codex, Claude Code hoặc Gemini CLI.

### 1. Tạo không gian làm việc

Mở cửa sổ dòng lệnh trong thư mục nơi bạn muốn giữ thư viện kiến thức, rồi chạy:

```bash
npx lumina-wiki install
```

Phần thiết lập sẽ hỏi bạn đang dùng công cụ AI nào và có muốn thêm bộ tính năng nào không. Nếu chưa chắc, hãy giữ các lựa chọn được gợi ý. Sau này bạn có thể chạy lại cùng lệnh để thay đổi.

### 2. Thêm một tài liệu

Đặt một tệp PDF, Markdown hoặc văn bản vào:

```text
raw/sources/
```

Ví dụ:

```text
raw/sources/tai-lieu-dau-tien.pdf
```

### 3. Nhờ trợ lý AI đọc tài liệu

Trong Codex, dùng:

```text
$lumi-ingest raw/sources/tai-lieu-dau-tien.pdf
```

Trong công cụ dùng lệnh bắt đầu bằng dấu `/`, chẳng hạn Claude Code hoặc Gemini CLI, dùng:

```text
/lumi-ingest raw/sources/tai-lieu-dau-tien.pdf
```

Trợ lý sẽ cho bạn xem bản nháp trước khi lưu ghi chú mới. Bạn có thể đồng ý, yêu cầu sửa hoặc dừng lại để tiếp tục sau.

### 4. Đặt câu hỏi đầu tiên

Sau khi tài liệu đã được thêm, hãy thử:

```text
/lumi-ask Những ý chính trong tài liệu này là gì?
```

Nếu dùng Codex, hãy đổi dấu `/` đầu tiên thành `$`.

Khi chưa biết nên làm gì tiếp, dùng `/lumi-help` hoặc `$lumi-help`.

Để làm theo từng bước với các điểm kiểm tra và cách xử lý lỗi thường gặp, xem [hướng dẫn sử dụng](docs/user-guide/vi.md).

## Các bộ tính năng tùy chọn

Những tính năng cơ bản luôn có sẵn. Khi thiết lập, bạn có thể thêm:

| Bộ tính năng | Chọn khi bạn muốn |
| --- | --- |
| Nghiên cứu | Tìm bài báo, theo dõi chủ đề, đánh giá nguồn và viết tổng quan tài liệu. |
| Đọc sách | Đọc sách theo từng chương mà không làm lộ phần truyện phía sau. |
| Học tập | Ghi lại hiểu biết của bạn thay đổi như thế nào trong quá trình học. |

Bạn có thể thêm hoặc bỏ một bộ tính năng sau này bằng cách chạy lại `npx lumina-wiki install`. Tài liệu và ghi chú trong wiki vẫn được giữ nguyên.

## Các lệnh dùng hằng ngày

Những lệnh sau là đủ cho phần lớn người dùng:

| Lệnh | Dùng để |
| --- | --- |
| `/lumi-help` | Nhận một gợi ý hữu ích về việc nên làm tiếp. |
| `/lumi-ingest` | Đưa một tài liệu vào wiki. |
| `/lumi-ask` | Đặt câu hỏi dựa trên kiến thức đã có trong wiki. |
| `/lumi-edit` | Sửa hoặc cập nhật một trang wiki. |
| `/lumi-verify` | Kiểm tra ghi chú có khớp với nguồn được dẫn hay không. |
| `/lumi-check` | Kiểm tra liên kết hỏng và các vấn đề khác trong wiki. |

Xem [bảng tra cứu lệnh](docs/user-guide/commands.vi.md) để biết toàn bộ lệnh đang có.

## Các hướng dẫn khác

- [Hướng dẫn cho người mới](docs/user-guide/vi.md)
- [Quy trình nghiên cứu](docs/user-guide/research.vi.md)
- [Bảng tra cứu lệnh](docs/user-guide/commands.vi.md)
- [Tìm tài liệu định kỳ](docs/user-guide/advanced-scheduled-discovery.vi.md) — nâng cao
- [Dùng QMD để tìm kiếm trên máy](docs/user-guide/advanced-qmd.vi.md) — nâng cao
- [Kết nối OpenClaw hoặc Hermes](docs/user-guide/openclaw-hermes-integration.vi.md) — nâng cao

Bạn cũng có thể mở thư mục gốc bằng [Obsidian](https://obsidian.md) để xem các ghi chú Markdown bằng giao diện trực quan.

## Cập nhật hoặc gỡ cài đặt

Để cập nhật Lumina-Wiki hoặc thay đổi thiết lập, chạy:

```bash
npx lumina-wiki install
```

Để gỡ những tệp do Lumina-Wiki quản lý, chạy:

```bash
npx lumina-wiki uninstall
```

Khi gỡ cài đặt, tài liệu gốc trong `raw/` và ghi chú kiến thức trong `wiki/` vẫn được giữ lại.

## Dành cho người đóng góp

Hướng dẫn phát triển nằm trong [CONTRIBUTING.md](CONTRIBUTING.md). Các lệnh dòng lệnh ổn định được ghi tại [docs/cli-contract.md](docs/cli-contract.md), còn kế hoạch sắp tới nằm trong [ROADMAP.md](ROADMAP.md).

Lumina-Wiki được phát hành theo [Giấy phép MIT](LICENSE).

---

## Người đóng góp

Cảm ơn tất cả những người đã đóng góp cho Lumina Wiki!

[![Contributors](https://contrib.rocks/image?repo=tronghieu/lumina-wiki)](https://github.com/tronghieu/lumina-wiki/graphs/contributors)

**Muốn đóng góp?** Đọc [CONTRIBUTING.md](CONTRIBUTING.md) để bắt đầu — báo lỗi, thêm skill mới, tích hợp công cụ, hay dịch thuật đều được chào đón.
