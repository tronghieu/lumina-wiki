# 高级：定期查找研究资料

定期查找研究资料可以让 Lumina-Wiki 偶尔为你关心的主题查找更多论文或研究资料。每次
运行只会生成一份建议阅读的资料列表，供你查看。它不会把资料加入 wiki，也不会下载
论文文件。

你可以这样理解：Lumina-Wiki 先帮你找资料，但仍然由你决定哪些资料值得读。

## 推荐流程

1. 选择几个想跟踪的主题。
2. Lumina-Wiki 为这些主题查找新资料。
3. 你查看新列表，或者请助手帮你先读一遍。
4. 你选择值得阅读的资料。
5. 用 `/lumi-ingest` 把选中的资料加入 wiki。

定期查找只做到第 2 步。仔细阅读、下载论文文件、写摘要、创建 wiki 页面，以及和旧笔记
建立链接，仍然发生在 `/lumi-ingest` 步骤。

## 1. 选择要跟踪的主题

在和助手的对话中运行：

```text
/lumi-research-watchlist
```

你可以自然地描述，例如：

```text
我想跟踪“课堂上使用手机的影响”这个主题，每周查找一次，每次只显示大约 5 份值得看的资料。
```

助手会帮你把这个主题保存到跟踪列表里。你不需要记住配置文件名。

推荐起步设置：

- 对大多数主题来说，每周查找一次就够了。
- 如果还没有配置其他来源，先使用 arXiv。
- 每次显示大约 5 份新资料，这样列表更容易阅读。

## 2. 先试运行一次

正式运行前，先试运行：

```bash
lumina discover run --dry-run
```

这个命令只检查 Lumina-Wiki 会查找什么。它不会写入新的结果。

如果看起来没问题，再正式运行：

```bash
lumina discover run
```

正式运行后，Lumina-Wiki 会把新资料列表保存到 `raw/discovered/`。

## 3. 有了新列表之后做什么？

这是最重要的一步：不要把所有结果都加入 wiki。

你可以自己查看列表，也可以先请助手帮你筛选：

```text
请查看 raw/discovered/ 里的新资料，并帮我选出 3 份最值得读的、关于课堂上使用手机影响的资料。
```

助手应该帮你：

- 按更小的主题给资料分组，
- 解释为什么某份资料值得读，
- 跳过重复或离主题太远的资料，
- 建议哪些资料应该先加入 wiki。

然后选择一份资料加入 wiki：

```text
/lumi-ingest <你选择的资料>
```

只有到这一步，Lumina-Wiki 才会下载完整内容、写摘要、创建 wiki 页面，并和旧笔记建立
链接。

## 4. 用 GitHub Actions 定期运行

如果你的项目在 GitHub 上，并且希望电脑关机时也能查找资料，可以用这种方式。

创建 `.github/workflows/lumina-discovery.yml`，内容如下：

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

这个例子每周一运行。GitHub 使用 UTC 时间，所以实际运行时间可能与你所在时区不同。

这个 workflow 会自动提交。如果某次运行没有找到新资料，`git commit` 步骤会因为没有
内容可保存而自动跳过。

## 5. 在 macOS 或 Linux 上用 cron 定期运行

Cron 是一种简单方式，可以让电脑在固定时间运行一个命令。

首先，在 Lumina-Wiki 项目的终端里运行：

```bash
pwd
```

这个命令会输出项目的完整路径。保留这个路径。例如：

```text
/Users/you/Projects/my-wiki
```

接着打开 cron：

```bash
crontab -e
```

如果电脑要求你选择编辑器，不确定时可以选 `nano`。在 `nano` 中，按 `Ctrl+O`、Enter
保存，再按 `Ctrl+X` 退出。

在文件末尾添加类似这一行：

```cron
0 8 * * 1 cd /Users/you/Projects/my-wiki && lumina discover run
```

记得把 `/Users/you/Projects/my-wiki` 换成你自己的真实项目路径。

这行的意思是：每周一早上 8:00，进入项目文件夹，然后运行查找研究资料的命令。

你可以这样更改频率：

```cron
# 每天 8:00
0 8 * * * cd /Users/you/Projects/my-wiki && lumina discover run

# 每周一 8:00
0 8 * * 1 cd /Users/you/Projects/my-wiki && lumina discover run

# 每月第一天 8:00
0 8 1 * * cd /Users/you/Projects/my-wiki && lumina discover run
```

如果你想之后方便检查错误，可以使用带日志的版本：

```cron
0 8 * * 1 cd /Users/you/Projects/my-wiki && lumina discover run >> .lumina-discovery.log 2>&1
```

保存后，检查 cron 是否已经记录这个计划：

```bash
crontab -l
```

电脑需要在计划时间保持唤醒。如果笔记本正在睡眠，cron 可能不会运行。

## 6. 在 Windows 上定期运行

Windows 有 **Task Scheduler**。如果项目在 Windows 机器上，可以使用它。

创建一个 Basic Task：

- Trigger：每周，在你选择的时间。
- Action：Start a program。
- Program：`lumina`。
- Arguments：`discover run`。
- Start in：你的项目文件夹。

电脑需要在计划时间处于开机状态。

## 7. 跟踪 RSS / Atom 源（v1.4+）

除了主题搜索之外，你还可以跟踪 RSS / Atom 源。每次按计划运行时，runner
会一次性轮询 watchlist 中的所有 feed，基于每个 feed 的独立状态去重，并把
新的候选条目写入 `raw/discovered/`，方式与主题搜索一样。

通过 `/lumi-research-watchlist` 添加 `type: feed` 项，或直接编辑
`_lumina/config/watchlist.yml`：

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

原有的 `type: topic` 项继续按原样工作。Feed 的 URL 必须使用 `https://`，
且不能以 `--` 开头。

每个 feed 的状态保存在 `_lumina/_state/feeds/<feed-id>.json`（etag、
last-seen guids、轮询计数）。Lumina 把 `last_seen_guids` 限制在 5000 条以内
并清除超过 90 天的旧条目，因此即使长期使用，这个文件也会保持很小。

如果你想直接在聊天里执行一次（不通过调度），使用
`/lumi-research-watch-run`。它是 `lumina discover run` 的聊天内等价命令，
并会用通俗语言报告新发现的内容。

关于 v1.4 的 feed schema、etag 缓存、XXE 拒绝，以及把 `umask 077` 和日志
轮转结合在一起的 `cron-daily.sh` 包装器，请参阅
[Research Watch 深度参考](research-watch.md)（英文；v1.4 技术参考）。
