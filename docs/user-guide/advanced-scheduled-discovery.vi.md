# Nâng cao: Tìm tài liệu định kỳ

Tìm tài liệu định kỳ giúp Lumina-Wiki thỉnh thoảng tìm thêm bài báo hoặc tài
liệu nghiên cứu cho những chủ đề bạn quan tâm. Mỗi lần chạy, nó chỉ tạo một
danh sách tài liệu gợi ý để bạn xem. Nó chưa đưa tài liệu vào wiki và cũng chưa
tải file bài báo.

Bạn có thể hiểu đơn giản thế này: Lumina-Wiki đi tìm trước, còn bạn vẫn là
người chọn tài liệu nào đáng đọc.

## Quy trình nên dùng

1. Bạn chọn vài chủ đề muốn theo dõi.
2. Lumina-Wiki tìm tài liệu mới cho các chủ đề đó.
3. Bạn xem danh sách mới, hoặc nhờ trợ lý đọc giúp.
4. Bạn chọn tài liệu đáng đọc.
5. Bạn dùng `/lumi-ingest` để đưa tài liệu đã chọn vào wiki.

Bước tìm định kỳ chỉ làm đến bước 2. Việc đọc kỹ, tải file bài báo, tóm tắt,
tạo trang wiki và liên kết tri thức vẫn nằm ở bước `/lumi-ingest`.

## 1. Chọn chủ đề muốn theo dõi

Trong cuộc trò chuyện với trợ lý, chạy:

```text
/lumi-research-watchlist
```

Bạn có thể nói tự nhiên, ví dụ:

```text
Tôi muốn theo dõi chủ đề ảnh hưởng của điện thoại trong lớp học, mỗi tuần tìm một lần, mỗi lần chỉ hiển thị khoảng 5 tài liệu đáng xem.
```

Trợ lý sẽ giúp bạn lưu chủ đề này vào danh sách theo dõi. Bạn không cần tự nhớ
tên file cấu hình.

Gợi ý ban đầu:

- Tìm hằng tuần là đủ cho đa số chủ đề.
- Dùng arXiv trước nếu bạn chưa cấu hình nguồn khác.
- Mỗi lần chỉ nên hiển thị khoảng 5 tài liệu mới để dễ xem.

## 2. Chạy thử một lần

Trước khi chạy thật, hãy chạy thử:

```bash
lumina discover run --dry-run
```

Lệnh này chỉ kiểm tra xem Lumina-Wiki sẽ tìm gì. Nó chưa ghi kết quả mới.

Nếu kết quả nhìn ổn, chạy thật:

```bash
lumina discover run
```

Sau lần chạy thật, Lumina-Wiki sẽ lưu danh sách tài liệu mới trong
`raw/discovered/`.

## 3. Sau khi có danh sách mới thì làm gì?

Đây là phần quan trọng nhất: đừng đưa tất cả kết quả vào wiki ngay.

Bạn có thể tự xem danh sách mới, hoặc nhờ trợ lý xem trước:

```text
Hãy xem các tài liệu mới trong raw/discovered/ và giúp tôi chọn 3 tài liệu đáng
đọc nhất cho chủ đề ảnh hưởng của điện thoại trong lớp học.
```

Trợ lý nên giúp bạn:

- nhóm các tài liệu theo chủ đề nhỏ,
- giải thích vì sao tài liệu đó đáng đọc,
- bỏ qua tài liệu trùng hoặc quá xa chủ đề,
- đề xuất tài liệu nào nên đưa vào wiki trước.

Sau đó bạn chọn một tài liệu và đưa vào wiki:

```text
/lumi-ingest <tài liệu bạn chọn>
```

Chỉ đến bước này Lumina-Wiki mới tải nội dung đầy đủ, tóm tắt, tạo trang wiki
và liên kết với các ghi chú cũ.

## 4. Chạy định kỳ bằng GitHub Actions

Dùng cách này nếu project nằm trên GitHub và bạn muốn việc tìm tài liệu chạy
ngay cả khi máy cá nhân đang tắt.

Tạo file `.github/workflows/lumina-discovery.yml` với nội dung sau:

```yaml
name: Lumina scheduled discovery

on:
  schedule:
    - cron: "0 1 * * 1"
  workflow_dispatch:

permissions:
  contents: write

jobs:
  discover:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm install -g lumina-wiki
      - run: lumina discover run --json
      - run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          if [ -d raw/discovered ]; then git add raw/discovered; fi
          if [ -f _lumina/_state/discovery-runner.json ]; then git add _lumina/_state/discovery-runner.json; fi
          git diff --cached --quiet || git commit -m "chore: add discovered research"
          git push
```

Ví dụ này chạy mỗi thứ Hai. GitHub dùng giờ UTC, nên giờ chạy thực tế có thể
lệch với giờ Việt Nam.

Workflow này có tự commit. Nếu lần chạy không tìm thấy tài liệu mới, bước
`git commit` sẽ tự bỏ qua vì không có gì để lưu.

## 5. Chạy định kỳ trên macOS hoặc Linux bằng cron

Cron là cách đơn giản để bảo máy tính tự chạy một lệnh vào một giờ cố định.

Trước hết, mở terminal trong project Lumina-Wiki của bạn và chạy:

```bash
pwd
```

Lệnh này in ra đường dẫn đầy đủ của project. Hãy giữ lại đường dẫn đó. Ví dụ:

```text
/Users/you/Projects/my-wiki
```

Tiếp theo, mở cron:

```bash
crontab -e
```

Nếu máy hỏi chọn editor, chọn `nano` nếu bạn không chắc nên chọn gì. Trong
`nano`, nhấn `Ctrl+O`, Enter để lưu, rồi `Ctrl+X` để thoát.

Thêm một dòng như sau vào cuối file:

```cron
0 8 * * 1 cd /Users/you/Projects/my-wiki && lumina discover run
```

Nhớ thay `/Users/you/Projects/my-wiki` bằng đường dẫn thật của bạn.

Dòng trên có nghĩa là: mỗi thứ Hai lúc 8:00 sáng, vào đúng thư mục project rồi
chạy lệnh tìm tài liệu.

Bạn có thể đổi lịch như sau:

```cron
# Mỗi ngày lúc 8:00
0 8 * * * cd /Users/you/Projects/my-wiki && lumina discover run

# Mỗi thứ Hai lúc 8:00
0 8 * * 1 cd /Users/you/Projects/my-wiki && lumina discover run

# Ngày đầu mỗi tháng lúc 8:00
0 8 1 * * cd /Users/you/Projects/my-wiki && lumina discover run
```

Nếu muốn dễ kiểm tra khi có lỗi, dùng bản có ghi log:

```cron
0 8 * * 1 cd /Users/you/Projects/my-wiki && lumina discover run >> .lumina-discovery.log 2>&1
```

Sau khi lưu, kiểm tra cron đã nhận lịch chưa:

```bash
crontab -l
```

Máy cần đang bật vào giờ đã đặt. Nếu laptop đang sleep, cron có thể không chạy.

## 6. Chạy định kỳ trên Windows

Windows có **Task Scheduler**. Dùng nó nếu project nằm trên máy Windows.

Tạo một Basic Task:

- Trigger: hằng tuần, vào giờ bạn chọn.
- Action: Start a program.
- Program: `lumina`.
- Arguments: `discover run`.
- Start in: thư mục project của bạn.

Máy cần đang bật vào thời điểm đã đặt lịch.

## 7. Theo dõi nguồn RSS / Atom (v1.4+)

Ngoài chủ đề tìm kiếm, bạn có thể theo dõi cả nguồn RSS / Atom. Mỗi lần
chạy theo lịch, runner sẽ kiểm tra mọi feed trong watchlist một lần, lọc
trùng dựa trên state riêng của từng feed, rồi ghi các ứng viên mới vào
`raw/discovered/` giống như khi tìm kiếm theo chủ đề.

Thêm item `type: feed` qua `/lumi-research-watchlist`, hoặc chỉnh trực
tiếp `_lumina/config/watchlist.yml`:

```yaml
items:
  - id: arxiv-cs-lg
    type: feed
    enabled: true
    url: "https://arxiv.org/rss/cs.LG"
    name: "arXiv cs.LG"
    schedule: daily
    max_new: 20
```

Các item `type: topic` cũ vẫn chạy bình thường. URL của feed phải dùng
`https://` và không được bắt đầu bằng `--`.

State của từng feed nằm trong `_lumina/_state/feeds/<feed-id>.json` (etag,
last-seen guids, đếm số lần poll). Lumina giới hạn `last_seen_guids` ở
5000 mục và xóa các mục cũ hơn 90 ngày, nên file vẫn nhỏ ngay cả sau
nhiều năm dùng.

Nếu bạn muốn chạy một lượt duy nhất ngay trong chat (không qua lịch),
dùng `/lumi-research-watch-run`. Đây là phiên bản trong chat của
`lumina discover run` và sẽ báo cáo lại bằng ngôn ngữ dễ hiểu những gì mới
tìm được.

Để xem chi tiết schema feed v1.4, cơ chế etag, từ chối XXE, và wrapper
`cron-daily.sh` (kết hợp `umask 077` với log rotation), xem
[Research Watch deep-dive](research-watch.md) (tiếng Anh; tài liệu kỹ thuật v1.4).
