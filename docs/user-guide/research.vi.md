# Cách xây dựng bức tranh nghiên cứu từ nguồn thông thường

Dùng hướng dẫn này khi bạn muốn theo đuổi một câu hỏi theo thời gian, thay vì chỉ gom tệp. Nó phù hợp với bài báo, báo cáo, bài viết, tài liệu học và ghi chú cẩn thận. Bạn sẽ bắt đầu từ một câu hỏi, chọn một nhóm nguồn nhỏ, thêm lần lượt, rồi hỏi xem tài liệu đã gom được cho thấy điều gì.

Hướng dẫn này giả định gói Research đã có sẵn. Nếu chưa chắc, hãy kiểm tra bằng `/lumi-help skills`. Ví dụ dùng `/`; trong Codex, hãy dùng `$` thay thế.

## 1. Viết một câu hỏi nghiên cứu

Hãy làm câu hỏi đủ hẹp để định hướng vài lần đọc đầu tiên. Ví dụ:

```text
Lặp lại ngắt quãng ảnh hưởng thế nào đến việc học từ vựng dài hạn của người lớn?
```

Giữ câu hỏi trong một ghi chú hoặc nói với AI. Câu hỏi có thể thay đổi sau này; hiện tại nó giúp bạn chọn nguồn tiếp theo.

### Điểm kiểm tra

Bạn nên nói được loại bằng chứng nào sẽ giúp trả lời câu hỏi: một thí nghiệm, một bài tổng quan, báo cáo lớp học hoặc loại nguồn khác.

## 2. Chọn những nguồn đầu tiên

Nếu đã có bài báo hoặc bài viết, đặt một hoặc hai tệp vào `raw/sources/`. Nếu cần gợi ý về tài liệu nên đọc, chạy:

```text
/lumi-research-discover
```

Tự bạn xem danh sách ngắn được gợi ý. Chọn nguồn phù hợp với câu hỏi và thời gian bạn có. Lệnh không thêm chúng vào wiki cho đến khi bạn chọn tiếp tục.

Nếu chủ đề có vài thuật ngữ nền tảng mà bạn sẽ dùng lặp lại, bạn cũng có thể chạy `/lumi-research-prefill` trước khi thêm nguồn. Dùng lệnh này cho ý nền tảng ổn định, không dùng cho điều nghiên cứu của bạn vẫn cần kiểm tra.

### Điểm kiểm tra

Hãy có một nhóm khởi đầu nhỏ và có chủ đích. Hai hoặc ba nguồn tốt hữu ích hơn một chồng lớn chưa xem kỹ.

## 3. Thêm từng nguồn một

Với mỗi tệp trên máy, chạy:

```text
/lumi-ingest raw/sources/first-paper.pdf
```

Đọc bản nháp và so với bản gốc trước khi đồng ý. Hãy yêu cầu tóm tắt rõ hơn, nêu thiếu sót còn bỏ qua hoặc giải thích tốt hơn khi cần. Sau đó lặp lại với nguồn tiếp theo.

### Điểm kiểm tra

Sau mỗi nguồn, mở trang trong `wiki/sources/`. Bạn nên tìm được kết quả chính, các giới hạn quan trọng và đường dẫn quay lại tệp gốc.

## 4. So sánh điều các nguồn nói

Khi đã có vài nguồn, hãy hỏi một câu tập trung:

```text
/lumi-ask Các nguồn này giống và khác nhau thế nào về việc học từ vựng?
```

Hãy hỏi cả về phần bằng chứng còn thiếu:

```text
/lumi-ask Tôi cần đọc gì tiếp để trả lời câu hỏi của mình chắc chắn hơn?
```

Dùng các ghi chú được chỉ trong câu trả lời để quyết định nên thêm nguồn nào hoặc nên chỉnh câu hỏi ra sao.

## 5. Tạo tổng quan khi cần

Khi một chủ đề bắt đầu xuất hiện lặp lại, chạy:

```text
/lumi-research-topic
```

Khi muốn có bản tổng quan bằng văn bản từ những gì wiki đã có, chạy:

```text
/lumi-research-survey
```

Hai lệnh này chỉ dùng tài liệu bạn đã thêm. Hãy đọc kết quả trước khi yêu cầu lưu, nhất là khi bạn sẽ chia sẻ nó với người khác.

### Điểm kiểm tra

Bây giờ bạn nên mở được bản tổng quan và lần theo các nhận định quan trọng về những trang nguồn hỗ trợ chúng.

## 6. Giữ việc nghiên cứu đáng tin cậy

Chạy `/lumi-check` sau một nhóm lần thêm tài liệu. Trước khi dựa vào một trang nguồn cho quyết định, bài viết hay bài trình bày quan trọng, chạy `/lumi-verify` cho nguồn đó hoặc cho cả wiki. Đọc kết quả và quyết định điều cần sửa; cả hai lệnh không thay thế phán đoán của bạn.

Nếu cần giúp chọn bài đọc tiếp, dùng `/lumi-research-rank source-name` cho một bài báo đã có trong wiki.

## Bước tiếp theo

- [Tra cứu mọi lệnh](commands.vi.md).
- [Quay lại bài thực hành tài liệu đầu tiên](vi.md).
- [Tìm tài liệu nghiên cứu định kỳ nâng cao](advanced-scheduled-discovery.vi.md).
