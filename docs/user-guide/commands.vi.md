# Tra cứu lệnh Lumina-Wiki

Dùng trang này để tra lệnh khi bạn đã biết mình muốn làm gì. Các lệnh bên dưới được nhóm theo bộ tính năng cung cấp chúng. Wiki của bạn luôn có nhóm Core; các nhóm khác chỉ xuất hiện khi bạn đã chọn bộ tính năng đó lúc cài đặt. Để xem chính xác các lệnh đang có trong wiki của mình, chạy `/lumi-help skills` hoặc `$lumi-help skills`.

Ví dụ bên dưới dùng `/`. Trong Codex, thay dấu `/` đầu tiên bằng `$`.

## Lệnh Core

| Lệnh | Dùng khi bạn muốn | Ví dụ | Bạn nhận được |
| --- | --- | --- | --- |
| `/lumi-init` | chuẩn bị một wiki mới hoặc trống | `/lumi-init` | Nơi sẵn sàng cho nguồn đầu tiên. Có thể chạy lại an toàn. |
| `/lumi-ingest` | thêm tài liệu, liên kết hoặc bài báo vào wiki | `/lumi-ingest raw/sources/article.pdf` | Ghi chú nguồn, các ghi chú ý quan trọng đã nối với nhau và mục lục được cập nhật. |
| `/lumi-ask` | hỏi wiki nói gì về một câu hỏi | `/lumi-ask Các nguồn này đồng ý ở điểm nào?` | Câu trả lời chỉ về ghi chú và nguồn đã dùng. |
| `/lumi-edit` | sửa một trang wiki đã có | `/lumi-edit wiki/sources/article.md` | Thay đổi bạn yêu cầu, đồng thời giữ các ghi chú liên quan được kết nối. |
| `/lumi-check` | xem wiki có điều gì cần chú ý không | `/lumi-check` | Danh sách rõ ràng các vấn đề và hỗ trợ sửa những việc an toàn. |
| `/lumi-reset` | làm lại với phần nội dung bạn chọn | `/lumi-reset` | Kế hoạch được đưa ra trước; chỉ thay đổi sau khi bạn xác nhận. |
| `/lumi-verify` | đối chiếu ghi chú với nguồn mà chúng nhắc tới | `/lumi-verify article` | Các điểm cần bạn xem lại; lệnh không tự đổi ghi chú. |
| `/lumi-migrate-legacy` | cập nhật ghi chú cũ sau khi nâng cấp Lumina-Wiki | `/lumi-migrate-legacy --backfill-ids` | Hỗ trợ bổ sung thông tin cần có cho các trang cũ. |
| `/lumi-help` | tìm bước tiếp theo hoặc hỏi cách một tính năng hoạt động | `/lumi-help` | Một bước tiếp theo được gợi ý. Dùng `skills` để xem lệnh đã cài, hoặc `explain <câu hỏi>` để hỏi về Lumina-Wiki. |

`/lumi-ingest` cũng nhận tiêu đề bài báo, mã arXiv hoặc liên kết web khi bạn chưa có tệp trên máy. `/lumi-ask` chỉ lưu câu trả lời khi bạn yêu cầu rõ ràng.

## Lệnh Research

Các lệnh này cần gói Research.

| Lệnh | Dùng khi bạn muốn | Ví dụ | Bạn nhận được |
| --- | --- | --- | --- |
| `/lumi-research-setup` | chuẩn bị các công cụ nghiên cứu tùy chọn | `/lumi-research-setup` | Kiểm tra phần đã sẵn sàng và hướng dẫn thiết lập những dịch vụ bạn chọn dùng. |
| `/lumi-research-prefill` | thêm ý nền tảng ổn định trước khi gom nguồn | `/lumi-research-prefill` | Ghi chú nền có thể dùng lại, giúp tránh giải thích trùng lặp. |
| `/lumi-research-discover` | tìm nguồn phù hợp cho một chủ đề | `/lumi-research-discover` | Danh sách ngắn để bạn chọn; lệnh không tự thêm nguồn khi bạn chưa chọn. |
| `/lumi-research-watchlist` | chọn chủ đề bạn muốn theo dõi | `/lumi-research-watchlist` | Danh sách chủ đề và nguồn tin cần kiểm tra về sau đã cập nhật. |
| `/lumi-research-watch-run` | kiểm tra ngay các chủ đề đang theo dõi | `/lumi-research-watch-run` | Báo cáo dễ đọc về những nguồn mới có thể phù hợp. |
| `/lumi-research-survey` | biến ghi chú hiện có thành bản tổng quan tài liệu | `/lumi-research-survey` | Bản tổng quan có liên kết, chỉ được lưu khi bạn yêu cầu. |
| `/lumi-research-topic` | nhóm các ghi chú hiện có theo một chủ đề | `/lumi-research-topic` | Trang chủ đề giúp tìm nguồn và ý liên quan dễ hơn. |
| `/lumi-research-rank` | quyết định bài báo đã thêm nào đáng đọc tiếp | `/lumi-research-rank source-name` | Đánh giá mức độ ưu tiên đọc, được ghi trên trang nguồn đó. |

## Lệnh Reading

Các lệnh này cần gói Reading.

| Lệnh | Dùng khi bạn muốn | Ví dụ | Bạn nhận được |
| --- | --- | --- | --- |
| `/lumi-reading-chapter-ingest` | thêm một chương sách | `/lumi-reading-chapter-ingest chapter-3` | Ghi chú chương cùng nhân vật, chủ đề và sự kiện được nhắc tới. |
| `/lumi-reading-character-track` | cập nhật điều wiki biết về nhân vật | `/lumi-reading-character-track` | Trang nhân vật và quan hệ được cập nhật. |
| `/lumi-reading-theme-map` | xem chủ đề xuyên qua nhiều chương | `/lumi-reading-theme-map` | Trang chủ đề nối với các chương và nhân vật liên quan. |
| `/lumi-reading-plot-recap` | xem lại nội dung mà không đọc trước chỗ mình đang đọc | `/lumi-reading-plot-recap book-name:chapter-4` | Bản nhắc lại dừng trước chương bạn nêu. |

## Lệnh Learning

Lệnh này cần gói Learning.

| Lệnh | Dùng khi bạn muốn | Ví dụ | Bạn nhận được |
| --- | --- | --- | --- |
| `/lumi-learning-reflect` | ghi lại và xem lại cách hiểu của chính bạn | `/lumi-learning-reflect spaced-repetition` | Một buổi suy ngẫm bằng lời của bạn và nơi để xem cách hiểu thay đổi theo thời gian. |

## Liên quan

- [Bắt đầu bằng tài liệu đầu tiên](vi.md).
- [Theo một quy trình nghiên cứu thực tế](research.vi.md).
