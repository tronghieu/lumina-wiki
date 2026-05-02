<p align="center" lang="vi">
  <img src="assets/lumina-logo.png" width="250" alt="Lumina-Wiki Logo">
</p>

# Lumina-Wiki

> **Where Knowledge Starts to Glow.**
>
> Khối Tri thức được duy trì bởi LLM dành cho nghiên cứu kỹ thuật.

<p align="center">
  <img alt="License" src="https://img.shields.io/badge/License-MIT-blue.svg"/>
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-%3E%3D20-blue.svg"/>
  <img alt="Python" src="https://img.shields.io/badge/Python-3.9+-yellow.svg"/>
  <img alt="Skills" src="https://img.shields.io/badge/Skills-14-purple.svg"/>
  <br>
  <img alt="Powered by" src="https://img.shields.io/badge/Powered%20by-grey?style=flat"/>
  <img alt="Claude" src="https://img.shields.io/badge/-Claude%20Code-orange?style=flat"/>
  <img alt="Codex" src="https://img.shields.io/badge/-Codex-blueviolet?style=flat"/>
  <img alt="Gemini" src="https://img.shields.io/badge/-Gemini-4285F4?style=flat"/>
</p>

<p align="center">
  <a href="README.md" lang="en">English</a> • Tiếng Việt • <a href="README.zh.md" lang="zh">简体中文</a>
</p>

---

## 1. Luồng làm việc cốt lõi

Lumina-Wiki hoạt động dựa trên một nguyên tắc đơn giản: tách biệt tài liệu thô của bạn khỏi khối kiến thức có cấu trúc của AI.

```text
+-------------------------+      /lumi-ingest      +---------------------------+
|      ĐẦU VÀO CỦA BẠN    | ---------------------> |      BỘ NÃO CỦA AGENT     |
|    (Thư mục raw/)       |                        |     (Thư mục wiki/)       |
|                         | <--------------------- |                           |
|  - bai-bao.pdf          |       /lumi-ask        |  - bai-bao.md (tóm tắt)   |
|  - ghi-chu.txt          |                        |  - khai-niem-a.md         |
+-------------------------+                        +---------------------------+
```

1.  **Bạn Cung cấp:** Đặt các tài liệu (PDF, ghi chú) của bạn vào thư mục `raw/`.
2.  **Agent Xây dựng:** Sử dụng các lệnh trong cuộc hội thoại với AI (như `/lumi-ingest`) để yêu cầu agent đọc từ `raw/` và xây dựng một wiki có cấu trúc, liên kết chặt chẽ trong thư mục `wiki/`.
3.  **Bạn Khai thác:** Đặt câu hỏi (sử dụng `/lumi-ask`) trực tiếp vào "bộ não" của agent trong `wiki/` để nhận được câu trả lời nhanh và phù hợp với ngữ cảnh hơn.

## 2. Bắt đầu

### **Bước 1: Cài đặt**
Cài đặt không gian làm việc wiki vào dự án hiện tại của bạn bằng một lệnh duy nhất:

```bash
npx lumina-wiki install
```
> **Lưu ý cho người dùng Windows:** Để có trải nghiệm tốt nhất, bạn nên [bật Chế độ nhà phát triển (Developer Mode)](https://learn.microsoft.com/vi-vn/windows/apps/get-started/enable-your-device-for-development) để trình cài đặt có thể sử dụng symlink một cách chính xác. Nếu Developer Mode bị tắt, trình cài đặt sẽ chuyển sang sao chép các file skill; chức năng vẫn hoạt động nhưng sẽ không lý tưởng bằng cho việc cập nhật.

Trình cài đặt sẽ hướng dẫn bạn qua một vài bước thiết lập nhanh, bao gồm cả việc lựa chọn các **Gói (Packs)** tùy chọn như `research` (nghiên cứu) và `reading` (đọc hiểu).

### **Bước 2 (Tùy chọn): Cấu hình Gói Research**
Nếu bạn đã cài đặt gói `research`, một số kỹ năng sẽ cần API key để tìm kiếm trực tuyến. Hãy chạy kỹ năng setup để cấu hình chúng. Trong cuộc trò chuyện với AI:

> **Bạn:**
> `/lumi-research-setup`

Agent sẽ hướng dẫn bạn qua một quy trình cài đặt tương tác để lưu các key của bạn vào file `.env` cục bộ.

## 3. Các lệnh đầu tiên của bạn (Kỹ năng cốt lõi)

Tương tác với wiki của bạn bằng cách sử dụng các lệnh này trong giao diện trò chuyện với AI Agent (ví dụ: Gemini CLI, Claude, v.v.).

**Giai đoạn 1: Nạp và Xây dựng kiến thức**
-   `/lumi-init`: Quét thư mục `raw/` và thực hiện xây dựng wiki lần đầu.
-   `/lumi-ingest [đường/dẫn/tới/file]`: Xử lý một tài liệu mới và tích hợp nó vào cơ sở kiến thức.

**Giai đoạn 2: Khai thác và Bảo trì**
-   `/lumi-ask [câu hỏi của bạn]`: Đặt câu hỏi dựa trên toàn bộ cơ sở kiến thức trong `wiki/`.
-   `/lumi-edit [đường/dẫn/tới/trang/wiki]`: Yêu cầu thay đổi hoặc sửa lỗi cho một trang wiki cụ thể.
-   `/lumi-check`: Kiểm tra toàn bộ wiki để tìm lỗi (liên kết hỏng, trang mồ côi, v.v.).

*Các kỹ năng bổ sung có thể có sẵn nếu bạn đã cài đặt các gói tùy chọn như `research` hoặc `reading`.*

---

## 4. Hướng dẫn cấu trúc thư mục

Lumina tạo ra một không gian làm việc với mục đích rõ ràng cho từng thư mục.

### **Thư mục chính (Không gian làm việc hàng ngày của bạn)**

| Đường dẫn | Mục đích | Quản lý bởi |
| :--- | :--- | :--- |
| **`raw/`** | **Thư viện đầu vào bất biến của bạn.** Agent **chỉ đọc** từ đây. | **Bạn** |
| `raw/sources/` | Đặt các tài liệu chính của bạn (PDF, bài báo) tại đây. | Bạn |
| `raw/notes/` | Các ghi chú, ý tưởng cá nhân chưa có cấu trúc của bạn. | Bạn |
| `raw/assets/` | Hình ảnh hoặc các tài sản khác cho ghi chú của bạn. | Bạn |
| `raw/discovered/`| *(Gói Research)* Các bài báo do `/lumi-research-discover` tìm thấy sẽ được lưu ở đây. | Agent |
| **`wiki/`** | **Bộ não của Agent.** Agent **ghi** kiến thức có cấu trúc vào đây. | **Agent** |
| `wiki/sources/` | Các bản tóm tắt do AI tạo cho mỗi tài liệu trong `raw/sources`. | Agent |
| `wiki/concepts/` | Các ý tưởng, định nghĩa cốt lõi được trích xuất thành các trang riêng lẻ. | Agent |
| `wiki/people/` | Hồ sơ của các tác giả, nhà nghiên cứu, v.v. | Agent |
| `wiki/outputs/` | Các câu trả lời chi tiết từ `/lumi-ask` được lưu lại để tham khảo. | Agent |
| `wiki/index.md` | Bảng mục lục chính cho toàn bộ wiki của bạn. | Agent |
| `...` | *(Các thư mục thực thể khác như `foundations/`, `characters/` xuất hiện cùng các gói)* | Agent |


### **Thư mục hệ thống (Do Lumina quản lý)**

| Đường dẫn | Mục đích | Quản lý bởi |
| :--- | :--- | :--- |
| **`_lumina/`** | Engine cốt lõi, script và cấu hình cho wiki. | **Hệ thống** |
| **`.agents/`** | Chứa tất cả các `skills` (kỹ năng) mà agent có thể sử dụng. | **Hệ thống** |
| `...` | *(Các file ẩn khác như `.claude/`, `.gitignore`)* | **Hệ thống** |

**Lưu ý:** Bạn thường không cần phải sửa đổi các Thư mục hệ thống.

---

## 5. Các Kỹ năng và Công cụ có sẵn (v0.1)

### Skills (Lệnh người dùng)

Đây là những lệnh bạn có thể sử dụng khi trò chuyện với AI.

| Gói | Skill | Mục đích |
| :--- | :--- | :--- |
| **Core** | `/lumi-init` | Khởi tạo wiki từ tất cả các file trong `raw/`. |
| | `/lumi-ingest` | Xử lý một tài liệu mới và đưa vào wiki. |
| | `/lumi-ask` | Đặt câu hỏi dựa trên toàn bộ cơ sở kiến thức. |
| | `/lumi-edit` | Yêu cầu chỉnh sửa thủ công một trang wiki. |
| | `/lumi-check` | Kiểm tra lỗi trong wiki (liên kết hỏng, v.v.). |
| | `/lumi-reset` | Xóa các phần của wiki một cách an toàn. |
| **Research**| `/lumi-research-discover` | Khám phá và xếp hạng các bài báo nghiên cứu liên quan. |
| | `/lumi-research-survey` | Tạo một bài tổng quan/khảo sát từ kiến thức hiện có. |
| | `/lumi-research-prefill` | Tạo trước các khái niệm nền tảng để tránh trùng lặp. |
| | `/lumi-research-setup` | Giúp cấu hình API key cho các công cụ nghiên cứu. |
| **Reading** | `/lumi-reading-chapter-ingest`| Nạp kiến thức sách theo từng chương. |
| | `/lumi-reading-character-track`| Theo dõi các nhân vật và mối quan hệ của họ trong truyện. |
| | `/lumi-reading-theme-map` | Xác định và lập bản đồ các chủ đề trong một câu chuyện. |
| | `/lumi-reading-plot-recap` | Cung cấp một bản tóm tắt tuần tự của cốt truyện. |

### Tools (Engine chạy nền)

Đây là các script mà kỹ năng của agent sử dụng để thực hiện hành động.

| Vị trí | Tool | Vai trò |
| :--- | :--- | :--- |
| **`_lumina/scripts/`** | `wiki.mjs` | **Engine cốt lõi.** Xử lý tất cả các hoạt động ghi/sửa/liên kết trong `wiki/`. |
| | `lint.mjs` | Trình kiểm tra lỗi được `/lumi-check` sử dụng. |
| | `reset.mjs` | Script để xóa nội dung một cách an toàn. |
| | `schemas.mjs` | Nguồn chân lý duy nhất cho tất cả các cấu trúc và quy tắc của wiki. |
| **`_lumina/tools/`** | `discover.py` | *(Gói Research)* Cung cấp sức mạnh cho kỹ năng `/lumi-research-discover`. |
| | `fetch_*.py` | *(Gói Research)* Một bộ công cụ để lấy dữ liệu từ các API như ArXiv, Wikipedia, v.v. |

---

## 6. Lộ trình sắp tới

Phiên bản hiện tại là **v0.2** (preview). Kế hoạch đầy đủ ở [`ROADMAP.md`](./ROADMAP.md). Những hạng mục chính:

**v1.0.0 — Bản ổn định đầu tiên**
- **Daily search & fetch** — watchlist (`_lumina/config/watchlist.yml`) chạy theo lịch; paper mới từ arXiv / Semantic Scholar tự động đáp xuống `raw/discovered/<ngày>/`.
- Skill mới `/lumi-daily` để triage những gì vừa thu thập kể từ lần chạy trước.
- Khoá ổn định bề mặt v0.1 (CLI flags, exit codes, tên trường schema).
- CI matrix đa nền tảng (macOS + Linux + Windows, Node 20 + 22).

**v2.0.0 — Mở rộng nguồn paper cho Research Pack**
- **Nguồn paper mới:** OpenAlex, Unpaywall, CORE (Ưu tiên 1) → OpenReview, Hugging Face Papers, Papers With Code (Ưu tiên 2) → Crossref, DOAJ, RSS từ các blog research lab (Ưu tiên 3).
- **Đánh giá paper:** skill mới `/lumi-rank` đưa các chỉ số influential-citation count, xếp hạng theo lĩnh vực, Scite support/contrast, và Altmetric vào block `ranking:` trong frontmatter.

**Muốn đóng góp?** Chọn bất kỳ hạng mục chưa tick trong `ROADMAP.md`, mở issue để nhận, rồi gửi PR. Các fetcher nguồn paper đều tuân theo cùng pattern trong `src/tools/` (CLI + JSON, no async, exit codes `0/2/3`) nên rất phù hợp cho lần contribute đầu tiên. Xem hướng dẫn dev cục bộ bên dưới.

---

## 7. Đóng góp & Giấy phép

### 🛠️ Phát triển cục bộ (dành cho người đóng góp)

Nếu bạn muốn đóng góp cho trình cài đặt `lumina-wiki`:
```bash
# 1. Clone & Cài đặt Dependencies
git clone https://github.com/tronghieu/lumina-wiki.git
cd lumina-wiki
npm ci

# 2. Chạy Tests
npm run test:all
```

## 8. Ngôn ngữ khác

- [English (Tiếng Anh)](README.md)
- [简体中文 (Tiếng Trung)](README.zh.md)

**Giấy phép:** [MIT](LICENSE) © Lưu Trọng Hiếu.
