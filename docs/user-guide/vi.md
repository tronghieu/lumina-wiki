# Học cách dùng Lumina-Wiki bằng tài liệu đầu tiên

Trong bài thực hành ngắn này, bạn sẽ tạo một không gian học tập cá nhân, thêm một tài liệu, biến nó thành ghi chú hữu ích và đặt câu hỏi về tài liệu đó. Khi hoàn thành, bạn sẽ biết nơi đặt tài liệu gốc, cách nhờ Lumina-Wiki đọc tài liệu và cách kiểm tra kết quả.

<p align="center">
  <a href="https://www.youtube.com/watch?v=XuhhjbwoNeQ">
    <img src="https://img.youtube.com/vi/XuhhjbwoNeQ/maxresdefault.jpg" alt="Video hướng dẫn sử dụng Lumina-Wiki" width="560">
  </a>
  <br>
  <a href="https://www.youtube.com/watch?v=XuhhjbwoNeQ">▶ Xem video hướng dẫn Lumina-Wiki</a>
</p>

## Chuẩn bị trước khi bắt đầu

Bạn cần:

- Máy tính đã cài bản LTS mới nhất của [Node.js](https://nodejs.org/).
- Một thư mục trống cho wiki, ví dụ `Documents/my-study-wiki`.
- Một ứng dụng AI có thể làm việc với tệp trên máy. Khi cài đặt, hãy chọn ứng dụng bạn định dùng.
- Một tài liệu nhỏ để thử: PDF, tệp văn bản hoặc ghi chú Markdown.

## 1. Cài Lumina-Wiki

Mở Terminal trên macOS hoặc Linux, hay PowerShell trên Windows. Đi vào thư mục trống vừa tạo, rồi chạy:

```bash
npx lumina-wiki install
```

Trả lời các câu hỏi cài đặt bằng những mô tả gần gũi: chọn ngôn ngữ, nói bạn muốn học hay nghiên cứu điều gì, chọn ứng dụng AI và chọn các gói bổ sung nếu cần. Các công cụ cơ bản luôn có sẵn. Chỉ chọn gói Research nếu sau này bạn muốn được hỗ trợ tìm và sắp xếp tài liệu nghiên cứu.

Khi cài xong, mở thư mục đó trong ứng dụng AI bạn đã chọn.

### Điểm kiểm tra

Bạn sẽ thấy thư mục `raw/` để chứa tài liệu gốc và `wiki/` để chứa ghi chú do Lumina-Wiki tạo. Hãy để AI chăm sóc các tệp trong `wiki/`; việc đầu tiên của bạn chỉ là thêm một nguồn.

## 2. Hỏi Lumina-Wiki nên làm gì tiếp theo

Trong khung trò chuyện với AI, hãy bắt đầu bằng `lumi-help`. Lệnh này xem trạng thái hiện tại của không gian làm việc và gợi ý một việc hữu ích nên làm tiếp theo. Bất cứ khi nào chưa biết nên làm gì, bạn có thể dùng lại lệnh này.

Trong Codex, dùng:

```text
$lumi-help
```

Trong hầu hết ứng dụng AI được hỗ trợ khác, dùng:

```text
/lumi-help
```

Với một không gian làm việc mới, Lumina-Wiki thường sẽ hướng dẫn bạn khởi tạo wiki. Hãy làm theo gợi ý đó bằng lệnh khởi động:

```text
$lumi-init
```

```text
/lumi-init
```

Lệnh này chuẩn bị wiki trống cho nguồn đầu tiên. Bạn có thể chạy lại an toàn nếu không chắc mình đã làm hay chưa.

### Điểm kiểm tra

AI sẽ báo wiki đã sẵn sàng. Hãy chạy lại `lumi-help` và kiểm tra rằng gợi ý mới đã phản ánh trạng thái hiện tại của không gian làm việc.

## 3. Thêm một tài liệu

Sao chép tài liệu thử vào `raw/sources/`. Ví dụ:

```text
raw/sources/learning-notes.pdf
```

Nên chọn tài liệu có chủ đề rõ ràng. Một bài viết ngắn hoặc vài trang ghi chú là vừa đủ cho bài thực hành đầu tiên. Hãy giữ tệp gốc ở đây cả sau khi Lumina-Wiki đã đọc nó.

### Điểm kiểm tra

Hãy chắc rằng tệp xuất hiện trong `raw/sources/` và tên tệp đủ dễ nhận ra.

## 4. Nhờ Lumina-Wiki đọc tài liệu

Nói cho AI biết tệp cần thêm. Trong Codex:

```text
$lumi-ingest raw/sources/learning-notes.pdf
```

Trong các ứng dụng AI được hỗ trợ khác:

```text
/lumi-ingest raw/sources/learning-notes.pdf
```

Lumina-Wiki đọc nguồn, đề xuất bản tóm tắt và những ý liên quan, rồi cho bạn xem kết quả trong quá trình làm. Hãy đọc bản nháp ngắn được đưa ra. Đồng ý nếu nó phản ánh đúng tài liệu, hoặc nói phần bạn muốn đổi. Bạn không cần hiểu cách ghi chú được sắp xếp để góp ý tốt; những câu bình thường như “làm rõ kết luận chính” là đủ.

### Điểm kiểm tra

Khi hoàn tất, bạn sẽ có:

- Một trang về tài liệu trong `wiki/sources/`.
- Ghi chú về ý quan trọng hoặc người được nhắc tới, nếu có.
- Danh sách tài liệu đã cập nhật trong `wiki/index.md`.

Mở trang nguồn mới và kiểm tra hai việc: phần tóm tắt có đúng với tài liệu bạn đưa vào không, và bạn có còn tìm được tệp gốc được nhắc đến trên trang không.

## 5. Đặt một câu hỏi hữu ích

Bây giờ hãy hỏi về điều Lumina-Wiki đã đọc:

```text
$lumi-ask Ba ý hữu ích nhất cho người mới trong tài liệu này là gì?
```

Hoặc:

```text
/lumi-ask Ba ý hữu ích nhất cho người mới trong tài liệu này là gì?
```

Câu trả lời sẽ chỉ bạn trở lại ghi chú và nguồn liên quan. Nếu wiki chưa có đủ tài liệu, AI sẽ nói rõ và gợi ý điều nên thêm tiếp theo.

### Kiểm tra cuối cùng

Bạn đã hoàn thành vòng đầu tiên khi cả bốn điều sau đều đúng:

- Tệp gốc vẫn nằm trong `raw/sources/`.
- Có trang tương ứng trong `wiki/sources/`.
- `wiki/index.md` có tên nguồn mới.
- `/lumi-ask` hoặc `$lumi-ask` trả lời từ nguồn đó và chỉ cho bạn nơi xem lại.

## Bạn đã học được gì

Bạn đã biết nhịp sử dụng hằng ngày của Lumina-Wiki: giữ tài liệu gốc, thêm bằng `lumi-ingest`, xem ghi chú, rồi hỏi bằng `lumi-ask`. Lặp lại vòng một-tài-liệu này mỗi khi bạn đọc được thứ đáng lưu.

## Bước tiếp theo

- [Tra cứu mọi lệnh có sẵn](commands.vi.md).
- [Theo một quy trình nghiên cứu thực tế](research.vi.md).
- [Tìm tài liệu nghiên cứu định kỳ nâng cao](advanced-scheduled-discovery.vi.md).
- [Tìm kiếm nâng cao](advanced-qmd.vi.md).
- [Dùng nhiều wiki từ một dịch vụ trò chuyện](openclaw-hermes-integration.vi.md).
