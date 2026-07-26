# Cài đặt và tích hợp Lumina-Wiki với OpenClaw và Hermes

Dùng hướng dẫn này để một agent OpenClaw hoặc Hermes chăm sóc nhiều
Lumina-Wiki. Bạn có thể gửi tài liệu, đặt câu hỏi hoặc nhờ tạo wiki mới ngay
trong chat, không cần mở sẵn thư mục project.

Đây là hướng dẫn tích hợp Lumina-Wiki. Hướng dẫn giả định bạn đã cài OpenClaw
hoặc Hermes, đã kết nối kênh chat và cho phép agent chạy lệnh. Hãy xem tài
liệu chính thức của [OpenClaw](https://docs.openclaw.ai/) hoặc
[Hermes](https://hermes-agent.nousresearch.com/docs/) để cài agent và kênh chat.

## Bạn cần chuẩn bị gì?

- Node.js 20 trở lên trong môi trường chạy agent.
- OpenClaw hoặc Hermes đã hoạt động với kênh chat bạn chọn.
- Một thư mục ổn định cho mỗi wiki.

Kiểm tra Node.js trước:

```bash
node --version
```

## 1. Cài Lumina-Wiki cho agent

Trong môi trường chạy agent, chạy hai lệnh sau. Lệnh đầu cài CLI `lumina`;
lệnh sau cài các skill Lumina cho OpenClaw:

```bash
npm install --global lumina-wiki
lumina install --yes --agents openclaw
```

Nếu dùng Hermes, thay `openclaw` bằng `hermes`. Nếu cả OpenClaw và Hermes cùng
chạy trong một môi trường, dùng:

```bash
lumina install --yes --agents openclaw,hermes
```

Mở một cuộc chat mới với agent sau khi cài. Bạn có thể hỏi:

```text
Bạn có thể giúp tôi làm gì với Lumina-Wiki?
```

Agent sẽ có thể liệt kê, thiết lập, kiểm tra và dùng wiki của bạn qua kỹ năng
`/lumi-hub`.

## 2. Đăng ký wiki có sẵn hoặc tạo wiki mới

Hãy làm bước này trong chat, không tự tạo thư mục Lumina bằng tay. Agent luôn
xem qua đường dẫn trước, rồi chỉ hỏi những thông tin còn thiếu.

Để thêm wiki có sẵn, bạn có thể nói:

```text
Hãy nhớ wiki ở /Users/me/wikis/ai-engineering với tên Kỹ Thuật AI.
Có thể gọi ngắn là AI wiki.
```

Để tạo wiki mới, nêu đường dẫn, mục đích và gói bạn muốn:

```text
Tạo wiki mới ở /Users/me/wikis/cooking, tên là Nấu Ăn.
Wiki này dùng cho công thức và ghi chú bếp núc. Thêm gói research.
```

Agent sẽ kiểm tra thư mục trước khi thay đổi bất cứ thứ gì.

- Nếu đó đã là Lumina-Wiki, agent chỉ thêm nó vào danh sách wiki của bạn.
- Nếu thư mục trống hoặc chưa có, agent hỏi tên, mô tả và gói tùy chọn trước
  khi thiết lập.
- Nếu trong thư mục đã có file của bạn, agent cho biết đã tìm thấy gì và chờ
  bạn đồng ý rõ ràng. Nó chỉ thêm phần Lumina còn thiếu, không ghi đè file có
  sẵn.

Hãy chọn một alias ngắn, tự nhiên khi nhắn tin. `AI wiki` thường tiện hơn một
tên project dài.

## 3. Dùng wiki trong chat hằng ngày

Khi agent đã biết wiki, chỉ cần gọi tên wiki trong yêu cầu:

```text
Đưa file PDF này vào AI wiki của tôi.

Wiki Nấu Ăn nói gì về cách giữ dao sắc?

Kiểm tra liên kết hỏng trong wiki Ghi Chú Đọc Sách.
```

Nếu yêu cầu chỉ rõ một wiki, agent làm việc trong wiki đó. Nếu nhiều wiki đều
có thể phù hợp, agent sẽ hỏi bạn chọn thay vì tự đoán. Mỗi lần có thay đổi,
câu trả lời nên nêu rõ wiki đã được thay đổi.

Khi bạn gửi tài liệu qua chat, agent đặt một bản mới vào wiki đã chọn rồi làm
theo luồng đọc tài liệu thông thường của Lumina. File đã có trong wiki sẽ không
bị ghi đè.

## 4. Kiểm tra toàn bộ wiki

Bạn có thể hỏi agent “Tôi có những wiki nào?” hoặc “Tất cả wiki có ổn không?”.
Bạn cũng có thể tự chạy các lệnh sau trong terminal:

```bash
lumina wikis list
lumina wikis resolve "AI wiki"
lumina wikis doctor
```

Nếu cần kết quả thuận tiện cho lịch chạy hoặc công cụ khác, thêm `--json`:

```bash
lumina wikis doctor --json
```

Nếu kiểm tra phát hiện phần Lumina bị thiếu, chỉ sửa các phần thiếu:

```bash
lumina wikis doctor --fix
```

Lệnh sửa không xóa hoặc viết lại nội dung wiki đã có. Dùng nó sau khi thư mục
bị sao chép dở, khôi phục chưa đủ hoặc bị xóa nhầm một phần.

Bạn có thể dùng tác vụ định kỳ của OpenClaw hoặc Hermes để chạy
`lumina wikis doctor --json`. Không nên đặt tự động đưa tài liệu vào wiki, vì
việc chọn tài liệu vẫn là quyết định của bạn.

## Xử lý lỗi và giới hạn vận hành

| Tình huống | Cách xử lý |
| --- | --- |
| Agent không tìm thấy wiki | Nhờ agent chạy `lumina wikis doctor`. Nếu wiki đã chuyển chỗ, đăng ký lại đường dẫn mới trong chat. |
| Agent chưa rõ bạn nói wiki nào | Trả lời bằng tên hoặc alias wiki. Agent không nên tự chọn thay bạn. |
| Không thấy kỹ năng Lumina sau khi cài | Mở chat mới hoặc khởi động lại nền tảng, rồi chạy lại đúng lệnh `lumina install --yes --agents ...`. |
| Kiểm tra phát hiện phần bị thiếu | Dùng `lumina wikis doctor --fix`; lệnh này chỉ thêm phần còn thiếu. |

Mỗi thời điểm chỉ nên có một agent chính ghi dữ liệu vào một wiki. Không để
hai agent cùng đưa tài liệu vào hoặc sửa cùng một wiki. Lumina cũng giữ các
wiki tách biệt: nó không tạo liên kết giữa wiki và không trả lời một câu hỏi
gộp từ tất cả wiki.

Chỉ cho agent truy cập những thư mục và kênh chat bạn tin tưởng. Dùng các cơ
chế phân quyền và sandbox của từng nền tảng nếu bạn cần giới hạn chặt hơn.

## Bước tiếp theo

Sau khi wiki đầu tiên hoạt động, gửi một tài liệu nhỏ và hỏi một câu đơn giản
về tài liệu đó. Cách này xác nhận toàn bộ luồng: file từ chat, đúng wiki, đọc
tài liệu và câu trả lời hữu ích.

Xem [Hướng dẫn sử dụng](vi.md) để dùng các lệnh Lumina hằng ngày.
