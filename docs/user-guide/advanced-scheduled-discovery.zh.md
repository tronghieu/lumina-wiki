# 如何定期查找研究资料而不自动填满 wiki

当你已经知道要跟踪哪些研究主题或资料源时，请使用本指南。流程包括：在聊天中描述跟踪清单，安全地试运行一次，审阅新候选资料，只把你选择的来源加入 wiki。

## 前提条件

- 已安装 research pack 的 Lumina-Wiki 工作区。
- 已通过 `/lumi-research-watchlist` 创建跟踪清单。
- 若要自动运行：一台能运行 `lumina` 并可访问工作区的电脑，或一个 GitHub 仓库。

查找步骤只会在 `raw/discovered/` 中创建候选记录。它不会把资料加入 wiki、下载全文，也不会替你决定该读什么。

## 1. 在聊天中创建跟踪清单

先运行：

```text
/lumi-research-watchlist
```

描述主题、频率、优先资料源和每次想看到的新条目数量。例如：

```text
每周跟踪课堂上使用手机的研究。每次最多显示 5 条新资料，先使用 arXiv。
```

如果你关注某个特定发布者，也可以用同一个命令添加 RSS 或 Atom 源。建议先从每周的小列表开始，以便轻松审阅。

## 2. 安全地试运行

在工作区根目录中，先预览一次而不保存候选资料：

```bash
lumina discover run --dry-run
```

如果主题和资料源正确，再正式运行：

```bash
lumina discover run
```

新候选资料会出现在 `raw/discovered/`。你也可以在聊天中用 `/lumi-research-watch-run` 运行一次。

## 3. 加入前先审阅

请助手将新候选资料与你的目标进行比较。例如：

```text
请审阅新的研究候选资料，并为我的“课堂手机使用”主题推荐最有用的三份来源。说明每份为什么值得读，并标记重复或关联较弱的资料。
```

把结果当作阅读清单，而不是自动导入。打开原始来源，选择哪些资料值得保留为长期笔记。

## 4. 加入你选择的来源

对每个选中的来源，使用：

```text
/lumi-ingest <选中的来源>
```

只有这一步会深入读取选中的来源，并把生成的笔记加入 wiki。

## 5. 自动运行查找

自动化是可选的。请先确保手动运行成功，并始终保留审阅与决定是否加入 wiki 的权利。

### GitHub Actions

当工作区位于 GitHub 仓库中，而且你希望电脑关闭时仍能查找资料，可使用 GitHub Actions。添加 `.github/workflows/lumina-discovery.yml`：

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

GitHub 的计划使用 UTC。请手动运行一次工作流，并确认它只提交候选记录。如果仓库不允许直接推送，请按你的审阅流程调整最后一步。

### macOS 和 Linux

如果机器通常会在指定时间保持唤醒，可使用 cron。先用 `pwd` 找到工作区路径，再打开 crontab：

```bash
crontab -e
```

添加一行，并将示例路径替换为你的工作区路径：

```cron
0 8 * * 1 cd /Users/you/Projects/my-wiki && lumina discover run
```

用 `crontab -l` 确认计划。笔记本休眠时，cron 不能可靠运行。若这很重要，请使用 GitHub Actions 或常开机器。

### Windows

使用 Windows Task Scheduler：

1. 创建 **Basic Task**，并选择每周触发。
2. 选择 **Start a program**。
3. 将 **Program/script** 设为 `lumina`，**Add arguments** 设为 `discover run`。
4. 将 **Start in** 设为工作区文件夹。
5. 手动运行任务，并确认候选资料出现在 `raw/discovered/`。

电脑必须开机，或者任务需要配置为电脑下次启动后运行。

## 验证与排查

每次自动运行后，请在加入资料前审阅 `raw/discovered/`。如果没有候选资料，先在工作区根目录手动运行 `lumina discover run --dry-run`，然后在聊天中修正跟踪清单。如果计划任务找不到 `lumina`，请使用该命令的完整路径或修正工作文件夹，然后再手动运行任务。

有关资料源的技术规则和命令细节，请参阅 [Research Watch 参考](../reference/research-watch.md)。
