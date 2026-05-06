# 📚 Hướng dẫn Nâng cao: Tăng tốc truy vấn AI với QMD

**QMD (Query Markup Documents)** là một công cụ tìm kiếm cục bộ, giúp AI tăng tốc độ truy vấn thông tin trong Wiki của bạn. Thay vì đọc tuần tự qua các file, AI sẽ sử dụng chỉ mục (index) do QMD tạo ra để nhanh chóng xác định các đoạn văn bản liên quan nhất.

Công cụ này kết hợp **tìm kiếm từ khóa** (keyword search) và **tìm kiếm ngữ nghĩa** (semantic search) để đưa ra kết quả chính xác, giúp các lệnh như `/lumi-ask` hoạt động hiệu quả hơn trên các kho tri thức lớn.

---

## 1. Tại sao bạn cần QMD?

*   **Hiệu suất**: Tiết kiệm thời gian bằng cách sử dụng chỉ mục có sẵn, thay vì để AI phải quét qua toàn bộ nội dung file theo cách thủ công.
*   **Tìm kiếm thông minh**: Hỗ trợ tìm kiếm theo ngữ nghĩa, giúp tìm ra nội dung liên quan ngay cả khi không chứa chính xác từ khóa bạn cung cấp.
*   **Bảo mật**: Toàn bộ quá trình tạo chỉ mục và tìm kiếm đều chạy 100% trên máy tính của bạn.

---

## 2. Các bước cài đặt

### Bước 1: Cài đặt công cụ QMD

Tùy vào hệ điều hành, bạn thực hiện như sau:

#### **Trên macOS**
Máy Mac có sẵn SQLite, nhưng phiên bản đó không hỗ trợ các tính năng tìm kiếm Vector mà QMD cần. Do đó, bạn cần cài bản đầy đủ hơn qua Homebrew:
1.  Mở **Terminal**.
2.  Cài đặt SQLite & QMD:
    ```bash
    brew install sqlite
    npm install -g @tobilu/qmd
    ```

#### **Trên Windows**
1.  Mở **PowerShell** hoặc **Command Prompt** (với quyền Admin).
2.  Cài đặt QMD:
    ```bash
    npm install -g @tobilu/qmd
    ```
    *Lưu ý: Đảm bảo bạn đã bật **Developer Mode** trong cài đặt Windows để hỗ trợ tạo liên kết file.*

---

### Bước 2: Cài đặt Skill cho AI

Để AI của bạn biết cách sử dụng QMD, bạn cần cài đặt skill tương ứng qua lệnh sau trong giao diện chat (Gemini CLI, Claude Code, v.v.):

```bash
npx skills add https://github.com/tobi/qmd --skill qmd
```

---

## 3. Cấu hình lần đầu cho Wiki

Sau khi cài đặt, bạn cần cho QMD tạo chỉ mục cho kho tri thức của mình.

**Mẹo: Bạn có thể yêu cầu chính AI thực hiện việc này bằng cách dán câu lệnh sau vào ô chat:**
> "Hãy giúp tôi thiết lập QMD: thêm thư mục wiki vào collection 'my-wiki' và chạy lệnh embed."

Nếu bạn muốn tự làm thủ công:
1.  Mở Terminal tại thư mục gốc của dự án Lumina-Wiki.
2.  Thêm thư mục `wiki/` vào danh sách quản lý của QMD:
    ```bash
    qmd collection add wiki --name my-wiki
    ```
3.  Bắt đầu quá trình tạo chỉ mục (Embedding):
    ```bash
    qmd embed
    ```
    *   **Lưu ý:** Lần đầu tiên chạy, QMD sẽ tải về các mô hình AI cần thiết (khoảng 2GB). Sau đó, nó sẽ đọc toàn bộ nội dung trong `wiki/` để xây dựng chỉ mục. Quá trình này có thể mất vài phút.

---

## 4. Cách sử dụng

### Sử dụng qua AI (Tự động)
Sau khi đã cài Skill, mỗi khi bạn dùng lệnh `/lumi-ask` hoặc các lệnh truy vấn khác, AI sẽ tự động ưu tiên sử dụng QMD để có kết quả nhanh và chính xác hơn.

### Sử dụng thủ công (Dòng lệnh)
Nếu muốn tự tìm kiếm nhanh, bạn có thể dùng các lệnh:
*   `qmd search "từ khóa"`: Tìm chính xác từ khóa.
*   `qmd vsearch "nội dung cần tìm"`: Tìm theo ý nghĩa.

---

## 5. Lưu ý cho máy không có Card đồ họa (CPU-only)

QMD được tối ưu để chạy tốt trên CPU:
*   **Tự động nhận diện**: QMD sẽ tự phát hiện cấu hình máy và sử dụng CPU nếu không có GPU phù hợp.
*   **Cập nhật chỉ mục**: Mỗi khi wiki có nội dung mới (sau khi chạy `/lumi-ingest`), bạn nên chạy lệnh sau để QMD cập nhật lại chỉ mục:
    ```bash
    qmd update && qmd embed
    ```

---
*Hy vọng hướng dẫn này giúp bạn tối ưu hóa trải nghiệm sử dụng Lumina-Wiki. Nếu gặp khó khăn, đừng ngần ngại yêu cầu AI hỗ trợ hoặc kiểm tra thêm tại [tài liệu chính của QMD](https://github.com/tobi/qmd).*
