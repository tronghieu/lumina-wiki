# Cách tìm kiếm cục bộ trong wiki lớn bằng QMD

Dùng hướng dẫn này khi wiki có nhiều ghi chú Markdown và bạn muốn tìm nhanh trong máy. QMD là công cụ tùy chọn: Lumina-Wiki không tự cài QMD và không tự dùng QMD cho `/lumi-ask`.

## Điều kiện cần có

- Node.js 22 trở lên; kiểm tra bằng `node --version`.
- Terminal và quyền cài gói npm toàn cục.
- Trên macOS: Homebrew và gói SQLite của Homebrew. QMD cần SQLite này cho phần mở rộng.
- Không gian làm việc Lumina-Wiki có thư mục `wiki/`.

## Cài và kiểm tra QMD

Trên macOS, cài SQLite trước:

```bash
brew install sqlite
```

Sau đó cài QMD:

```bash
npm install -g @tobilu/qmd
qmd --version
qmd doctor
```

`qmd doctor` cho biết điều kiện nào còn thiếu. Nếu macOS báo vấn đề SQLite, hãy kiểm tra SQLite của Homebrew rồi làm theo gợi ý của lệnh.

## Thêm wiki và tạo chỉ mục tìm kiếm

Trong thư mục gốc của không gian làm việc, thêm wiki thành một bộ sưu tập. Chọn tên ngắn không trùng với bộ sưu tập khác trên máy.

```bash
qmd collection add wiki --name my-wiki
qmd update
qmd embed
```

Lần tạo chỉ mục ngữ nghĩa đầu tiên sẽ tải mô hình cục bộ, có thể tốn thời gian và dung lượng đĩa. Giữ Terminal mở đến khi xong.

## Xác minh kết quả

Kiểm tra bộ sưu tập, rồi tìm một cụm từ có trong ghi chú:

```bash
qmd status
qmd collection show my-wiki
qmd search "một cụm từ trong ghi chú" -c my-wiki
qmd query "một câu hỏi về ghi chú" -c my-wiki
```

Dùng `qmd search` để tìm từ khóa nhanh. Dùng `qmd query` để tìm theo ý nghĩa và có xếp hạng. Đường dẫn cùng đoạn trích từ wiki xác nhận QMD đang đọc được bộ sưu tập.

## Làm mới sau khi thay đổi ghi chú

Sau khi thêm hoặc sửa ghi chú, chạy:

```bash
qmd update
qmd embed
```

Hai lệnh này làm mới kết quả QMD; chúng không sửa ghi chú trong wiki.

## Dùng QMD với trợ lý AI nếu bạn muốn

Nói rõ với trợ lý lệnh cần chạy, ví dụ:

```text
Hãy dùng `qmd query` trong bộ sưu tập `my-wiki` để tìm các ghi chú liên quan đến câu hỏi này, rồi nêu các ghi chú đã dùng.
```

Việc trợ lý có chạy được QMD hay không tùy vào quyền và cách thiết lập. Nếu cần, hãy tự cấu hình kết nối; đừng cho rằng cài QMD sẽ tự thay đổi lệnh Lumina-Wiki.

## Cập nhật QMD

Cập nhật công cụ, kiểm tra lại rồi làm mới bộ sưu tập:

```bash
npm update -g @tobilu/qmd
qmd doctor
qmd status
qmd update
qmd embed
```

## Khắc phục sự cố

| Vấn đề | Cách xử lý |
| --- | --- |
| `qmd: command not found` | Đóng rồi mở lại Terminal. Nếu vẫn không có, thêm thư mục bin toàn cục của npm vào `PATH`, rồi cài lại QMD. |
| `qmd doctor` báo Node không được hỗ trợ | Cài Node.js 22 trở lên, mở lại Terminal và chạy `node --version`. |
| macOS báo lỗi SQLite hoặc phần mở rộng | Chạy `brew install sqlite`, mở lại Terminal rồi chạy `qmd doctor`. |
| Bộ sưu tập thiếu ghi chú mong đợi | Chạy lệnh từ thư mục gốc của không gian làm việc, kiểm tra `qmd collection show my-wiki`, rồi chạy `qmd update` và `qmd embed`. |
| Ghi chú mới chưa xuất hiện khi tìm theo ý nghĩa | Chạy `qmd update` rồi `qmd embed`; tìm từ khóa có thể thấy ghi chú trước. |

Xem chi tiết lệnh và cách kết nối tại [tài liệu chính thức của QMD](https://github.com/tobi/qmd).
