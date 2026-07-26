# Cách tìm tài liệu nghiên cứu định kỳ mà không tự đưa vào wiki

Dùng hướng dẫn này khi bạn đã biết chủ đề hoặc nguồn tin muốn theo dõi. Quy trình gồm: mô tả danh sách theo dõi trong chat, chạy thử an toàn, xem lại đề xuất mới và chỉ đưa vào wiki nguồn bạn chọn.

## Điều kiện cần có

- Không gian làm việc Lumina-Wiki đã cài gói Research.
- Danh sách theo dõi được tạo qua `/lumi-research-watchlist`.
- Nếu tự động hóa: máy tính hoặc kho GitHub có thể chạy `lumina` và truy cập không gian làm việc.

Bước tìm chỉ tạo bản ghi đề xuất trong `raw/discovered/`. Nó không đưa tài liệu vào wiki, không tải toàn văn và không quyết định bạn nên đọc gì.

## 1. Tạo danh sách theo dõi trong chat

Bắt đầu bằng:

```text
/lumi-research-watchlist
```

Mô tả chủ đề, tần suất, nguồn ưu tiên và số tài liệu mới muốn xem. Ví dụ:

```text
Theo dõi nghiên cứu về việc dùng điện thoại trong lớp học mỗi tuần. Mỗi lần chỉ hiển thị tối đa 5 tài liệu mới và ưu tiên arXiv.
```

Dùng chính lệnh này để thêm nguồn RSS hoặc Atom của một nhà xuất bản cụ thể. Nên bắt đầu với danh sách ngắn mỗi tuần để dễ xem lại.

## 2. Chạy thử an toàn

Tại thư mục gốc của không gian làm việc, xem trước một lượt trước khi lưu đề xuất:

```bash
lumina discover run --dry-run
```

Nếu chủ đề và nguồn đã đúng, chạy thật:

```bash
lumina discover run
```

Đề xuất mới xuất hiện trong `raw/discovered/`. Bạn cũng có thể yêu cầu chạy một lượt trong chat bằng `/lumi-research-watch-run`.

## 3. Xem lại trước khi thêm bất cứ thứ gì

Yêu cầu trợ lý so sánh các đề xuất mới với mục tiêu của bạn. Ví dụ:

```text
Hãy xem các tài liệu nghiên cứu mới và đề xuất 3 nguồn hữu ích nhất cho chủ đề điện thoại trong lớp học. Giải thích lý do nên đọc từng nguồn và đánh dấu nguồn trùng lặp hoặc ít liên quan.
```

Hãy xem kết quả như danh sách đọc ngắn, không phải nhập tự động. Mở nguồn gốc và chọn tài liệu nào xứng đáng có ghi chú lâu dài.

## 4. Đưa các nguồn bạn chọn vào wiki

Với mỗi nguồn đã chọn, dùng:

```text
/lumi-ingest <nguồn đã chọn>
```

Chỉ bước này mới đọc kỹ nguồn đã chọn và thêm ghi chú vào wiki.

## 5. Tự động chạy lượt tìm

Tự động hóa là tùy chọn. Chỉ thiết lập sau khi chạy thủ công thành công, và vẫn giữ quyền xem lại cùng quyết định đưa tài liệu vào wiki.

### GitHub Actions

Dùng GitHub Actions khi không gian làm việc nằm trong kho GitHub và bạn muốn việc tìm vẫn chạy khi máy tính tắt. Thêm `.github/workflows/lumina-discovery.yml`:

```yaml
name: Lumina discovery

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
      - run: lumina discover run
      - run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          if [ -d raw/discovered ]; then git add raw/discovered; fi
          git diff --cached --quiet || git commit -m "chore: add discovered research"
          git push
```

Lịch của GitHub dùng giờ UTC. Hãy chạy tác vụ thủ công một lần và kiểm tra nó chỉ lưu đề xuất. Nếu kho chặn đẩy trực tiếp, hãy đổi bước cuối theo quy trình xem lại của bạn.

### macOS và Linux

Dùng cron khi máy thường thức vào giờ đã chọn. Tìm đường dẫn của không gian làm việc bằng `pwd`, rồi mở crontab:

```bash
crontab -e
```

Thêm một dòng, thay đường dẫn ví dụ bằng đường dẫn thật của bạn:

```cron
0 8 * * 1 cd /Users/you/Projects/my-wiki && lumina discover run
```

Xác nhận lịch bằng `crontab -l`. Cron không chạy ổn định khi laptop đang ngủ. Nếu điều đó quan trọng, dùng GitHub Actions hoặc máy luôn bật.

### Windows

Dùng Windows Task Scheduler:

1. Tạo **Basic Task** với lịch hằng tuần.
2. Chọn **Start a program**.
3. Đặt **Program/script** là `lumina` và **Add arguments** là `discover run`.
4. Đặt **Start in** là thư mục Lumina-Wiki.
5. Chạy thử task và kiểm tra đề xuất xuất hiện trong `raw/discovered/`.

Máy phải bật, hoặc task phải được cấu hình để chạy khi máy mở lại.

## Xác minh và khắc phục sự cố

Sau mỗi lượt tự động, hãy xem `raw/discovered/` trước khi đưa tài liệu vào wiki. Nếu không có đề xuất, hãy chạy `lumina discover run --dry-run` thủ công từ thư mục gốc rồi sửa danh sách theo dõi trong chat. Nếu lịch không tìm thấy `lumina`, dùng đường dẫn đầy đủ đến lệnh hoặc sửa thư mục làm việc, rồi chạy thử lại.

Xem quy tắc kỹ thuật cho feed và chi tiết lệnh tại [tài liệu tham khảo Research Watch](../reference/research-watch.md).
