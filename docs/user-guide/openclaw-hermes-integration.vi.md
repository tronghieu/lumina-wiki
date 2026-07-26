# Dùng Lumina-Wiki từ OpenClaw hoặc Hermes

Kết nối một lần agent chat OpenClaw hoặc Hermes bạn đang dùng với Lumina-Wiki,
rồi quản lý nhiều wiki ngay trong cuộc chat quen thuộc. Bạn có thể gửi tài liệu
vào một wiki đã gọi tên, hỏi nội dung wiki, hoặc nhờ agent nhận quản lý hay tạo
wiki mới mà không cần tự mở thư mục đó.

Đây là hướng dẫn nâng cao dành cho người đã có OpenClaw hoặc Hermes hoạt động.
Để cài nền tảng chat hoặc kết nối kênh chat, hãy xem tài liệu chính thức của
[OpenClaw](https://docs.openclaw.ai/) hoặc
[Hermes](https://hermes-agent.nousresearch.com/docs/).

## Chuẩn bị trước khi bắt đầu

- OpenClaw hoặc Hermes đã nhận được tin nhắn và có thể chạy lệnh trong chính
  môi trường của agent.
- Môi trường đó có Node.js 20 trở lên. Kiểm tra bằng:

  ```bash
  node --version
  ```

- Agent có quyền đọc và ghi các thư mục bạn muốn dùng làm wiki.
- Nếu Hermes chạy trong Docker, hãy mount cả thư mục wiki lẫn `~/.lumina` vào
  container trước khi tiếp tục.

Hãy dùng hướng dẫn này khi một agent chat cần chăm sóc nhiều wiki. Nếu bạn chỉ
có một wiki và luôn mở nó trong trình soạn thảo, cách cài Lumina-Wiki thông
thường thường sẽ đơn giản hơn.

## Cài các kỹ năng Lumina cho agent chat

Chạy các lệnh sau trong môi trường chạy agent. Thay `<platform>` bằng
`openclaw` hoặc `hermes`:

```bash
npm install --global lumina-wiki
lumina install --yes --agents <platform>
```

Nếu cả hai nền tảng cùng chạy trong môi trường đó, dùng
`--agents openclaw,hermes` ở lệnh thứ hai.

Việc này cài các kỹ năng Lumina do Lumina quản lý cho nền tảng đã chọn. Nó
không tạo wiki và không thay thế các kỹ năng không liên quan đã có của agent.

### Điểm kiểm tra: xác nhận agent thấy Lumina

Mở cuộc chat mới, hoặc khởi động lại nền tảng nếu nó không tải lại kỹ năng giữa
các cuộc chat. Hãy hỏi:

```text
Bạn có thể giúp tôi làm gì với Lumina-Wiki?
```

Agent cần cho biết có thể quản lý một nhóm wiki và dùng được `/lumi-hub`. Nếu
không thấy, xem phần [Xử lý sự cố](#xử-lý-sự-cố).

## Thêm wiki đầu tiên ngay trong chat

Hãy nói với agent về wiki bạn đã có hoặc một thư mục mới. Nêu tên dễ hiểu, tên
gọi tắt và—khi tạo wiki mới—mục đích cùng các gói tùy chọn bạn muốn.

```text
Tạo wiki ở /Users/me/wikis/ai-engineering, tên là Kỹ Thuật AI.
Gọi tắt là AI wiki. Wiki dùng cho ghi chép và bài báo về kỹ thuật AI.
Thêm gói research.
```

Agent theo một luồng an toàn, ưu tiên chat:

1. Agent kiểm tra đường dẫn nhưng chưa thay đổi gì.
2. Nếu thư mục đã có file của bạn, agent cho biết đã tìm thấy gì và xin bạn
   đồng ý rõ ràng trước khi thêm file Lumina.
3. Agent chỉ hỏi những thông tin còn thiếu, rồi tạo và đăng ký wiki trong một
   thao tác chỉ bổ sung.

Nếu đường dẫn đã là Lumina-Wiki hoàn chỉnh, agent chỉ đăng ký mà không cài lại
hoặc nâng cấp. Wiki được tạo qua chat có chủ đích gọn nhẹ: kỹ năng của agent
chat nằm ở cấp toàn cục, còn wiki giữ ghi chú và tệp làm việc riêng.

### Điểm kiểm tra: wiki sẵn sàng để chat

Hãy hỏi:

```text
Tôi có những wiki nào?
```

Bạn sẽ thấy **Kỹ Thuật AI** và tên gọi tắt của nó. Khi dùng tên gọi tắt trong
một yêu cầu sau, agent sẽ tìm đúng wiki trước khi làm việc.

## Làm việc trong chat

Nêu tên wiki mỗi khi gửi tài liệu hoặc nhờ xử lý việc gì:

```text
Đưa PDF này vào AI wiki của tôi.

Wiki Kỹ Thuật AI nói gì về phát triển dựa trên đánh giá?

Kiểm tra liên kết hỏng trong AI wiki của tôi.
```

Với mỗi yêu cầu, agent tìm wiki bằng tên hoặc tên gọi tắt, đọc `README.md` của
wiki đó, rồi thực hiện luồng Lumina thông thường tại đó. Nếu chỉ có một wiki
phù hợp rõ ràng với chủ đề, agent sẽ nói rõ đã chọn wiki nào; nếu không, agent
sẽ hỏi bạn chọn.

Khi bạn đính kèm tài liệu, agent trước hết xác nhận nền tảng đã cung cấp được
file, rồi đặt một bản sao mới không trùng tên vào wiki đã chọn trước khi nhập
tài liệu. Agent không ghi đè file nguồn đã có. Phản hồi của agent cần nêu tên
wiki đã thay đổi.

### Điểm kiểm tra: thử toàn bộ luồng

Gửi một tài liệu nhỏ và nói: “Đưa tài liệu này vào AI wiki của tôi.” Khi xong,
hỏi một câu mà tài liệu đó có thể trả lời. Kết quả thành công xác nhận việc
nhận file, chọn wiki, nhập tài liệu và trả lời câu hỏi.

## Giữ cả nhóm wiki luôn ổn

Hãy hỏi agent: “Tất cả wiki của tôi có ổn không?” Agent có thể kiểm tra chỉ
đọc trên mọi wiki đã biết. Nếu một wiki thiếu phần Lumina cần có, hãy yêu cầu
agent sửa wiki đó. Việc sửa chỉ tạo phần còn thiếu và áp dụng các sửa liên kết
an toàn; không xóa hay ghi đè nội dung wiki hiện có.

Bạn có thể đặt lịch kiểm tra bằng trình lập lịch của nền tảng. Lệnh cho một tác
vụ tự động là `lumina wikis doctor --json`. Hãy đặt lịch kiểm tra, không phải
nhập tài liệu tự động: bạn vẫn là người quyết định tài liệu nào được thêm.

## Xử lý sự cố

| Tình huống | Cách xử lý |
| --- | --- |
| Không thấy kỹ năng Lumina | Mở chat mới hoặc khởi động lại nền tảng. Xác nhận Node.js và lệnh `lumina` có trong chính môi trường của agent, rồi chạy lại lệnh cài cho nền tảng đó. |
| Agent không tìm thấy wiki | Dùng đúng tên hoặc tên gọi tắt. Nếu thư mục đã chuyển chỗ, hãy cho agent đường dẫn mới để agent kiểm tra và đăng ký lại. |
| Agent hỏi trước khi dùng thư mục đã có file | Điều này là bình thường. Hãy xem các file agent báo và chỉ đồng ý khi bạn muốn thêm Lumina bên cạnh chúng. |
| Không đọc được file đính kèm | Kiểm tra quyền nhận file và giới hạn kích thước hiện tại của nền tảng, rồi thử lại với file nhỏ hơn. Hãy xem tài liệu chính thức của nền tảng vì các giới hạn này có thể thay đổi. |
| Kiểm tra báo có vấn đề | Yêu cầu agent sửa wiki đã nêu tên. Agent chỉ thêm phần còn thiếu và sửa an toàn, không thay thế ghi chú hay tài liệu nguồn của bạn. |

## Giới hạn vận hành và an toàn

- Mỗi thời điểm chỉ nên có một agent chính ghi vào một wiki. Không để hai agent
  cùng nhập tài liệu hoặc sửa một wiki.
- Các wiki luôn tách biệt. Lumina không tạo liên kết giữa chúng hoặc gộp chúng
  thành một câu trả lời.
- Chỉ cấp cho agent quyền truy cập các kênh chat và thư mục bạn sẵn sàng cho
  phép agent sử dụng. Dùng quyền và sandbox của OpenClaw hoặc Hermes khi cần.
- Việc nhập tài liệu qua chat vẫn do bạn khởi xướng. Chỉ dùng tác vụ định kỳ
  cho kiểm tra sức khỏe, trừ khi bạn chủ động chọn quy trình khác.

Để làm việc hằng ngày trong một wiki đã chọn, xem [Hướng dẫn sử dụng](vi.md).
