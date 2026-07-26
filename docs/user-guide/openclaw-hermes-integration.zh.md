# 安装并集成 Lumina-Wiki、OpenClaw 与 Hermes

使用本指南，让一个 OpenClaw 或 Hermes Agent 同时管理多个 Lumina-Wiki。你可以直接在聊天中发送文档、提问，或请它建立新的 wiki，无需先打开项目文件夹。

这是一份 Lumina-Wiki 集成指南。它假定你已经安装 OpenClaw 或 Hermes、连接好聊天渠道，并允许 Agent 运行命令。安装 Agent 或配置聊天渠道，请参阅 [OpenClaw 官方文档](https://docs.openclaw.ai/) 或 [Hermes 官方文档](https://hermes-agent.nousresearch.com/docs/)。

## 开始前需要准备什么？

- 在 Agent 的运行环境中安装 Node.js 20 或更高版本。
- 已能正常使用 OpenClaw 或 Hermes 及所选聊天渠道。
- 每个 wiki 都有一个稳定的文件夹。

先检查 Node.js：

```bash
node --version
```

## 1. 为 Agent 安装 Lumina-Wiki

请在 Agent 的运行环境中执行以下两个命令。第一个命令安装 `lumina` CLI，第二个命令为 OpenClaw 安装 Lumina 技能：

```bash
npm install --global lumina-wiki
lumina install --yes --agents openclaw
```

如果使用 Hermes，请把 `openclaw` 换成 `hermes`。若 OpenClaw 和 Hermes 在同一环境中运行，请使用：

```bash
lumina install --yes --agents openclaw,hermes
```

安装后，新开一个与 Agent 的聊天。你可以问：

```text
你能帮我完成哪些 Lumina-Wiki 工作？
```

Agent 应能通过 `/lumi-hub` 列出、设置、检查和使用你的 wiki。

## 2. 登记已有 wiki 或创建新 wiki

请在聊天中完成这一步，不要手动创建 Lumina 文件夹。Agent 会先查看路径，再只询问仍缺少的信息。

登记已有 wiki 时，可以这样说：

```text
请记住 /Users/me/wikis/ai-engineering 这个 wiki，名称是 AI 工程。
也可以简称为 AI wiki。
```

创建新 wiki 时，请给出路径、用途和所需的包：

```text
请在 /Users/me/wikis/cooking 创建一个名为美食的新 wiki，别名为 cooking。
它用来保存食谱和厨房笔记，并加入 research 包。
```

Agent 会先检查文件夹，再做任何改动。

- 如果那里已经是 Lumina-Wiki，它只会把它加入你的 wiki 列表。
- 如果文件夹为空或不存在，它会先询问名称、说明和可选包，再进行设置。
- 如果文件夹已有你的文件，它会告诉你发现了什么，并等待你的明确同意。它只补充缺少的 Lumina 内容，不会覆盖已有文件。

请选择一个在聊天中自然好说的短别名。例如，`AI wiki` 通常比很长的项目名更方便。

## 3. 在日常聊天中使用 wiki

当 Agent 已经认识某个 wiki 后，只要在请求中说出它的名字：

```text
把这份 PDF 加到我的 AI wiki。

我的美食 wiki 里关于如何保持刀具锋利是怎么说的？

检查阅读笔记 wiki 中的失效链接。
```

如果请求清楚指向一个 wiki，Agent 就在该 wiki 中工作。如果多个 wiki 都可能合适，它会请你选择，而不是自行猜测。每次改动后的回复都应说明修改的是哪个 wiki。

当你通过聊天发送文档时，Agent 会在选定 wiki 中放入一个新副本，再执行 Lumina 的正常导入流程。wiki 中已有的文件不会被覆盖。

## 4. 检查全部 wiki

你可以问 Agent“我有哪些 wiki？”或“所有 wiki 都正常吗？”。也可以在终端中运行：

```bash
lumina wikis list
lumina wikis resolve "AI wiki"
lumina wikis doctor
```

若需要便于定时任务或其他工具读取的结果，请加上 `--json`：

```bash
lumina wikis doctor --json
```

如果检查发现 Lumina 的某些部分缺失，只补齐缺失的部分：

```bash
lumina wikis doctor --fix
```

修复不会删除或重写已有的 wiki 内容。它适合用于文件夹复制不完整、恢复不完整或误删了一部分内容之后。

你可以用 OpenClaw 或 Hermes 的定时任务定期运行 `lumina wikis doctor --json`。不要安排自动导入文档，因为选择哪些文档仍应由你决定。

## 故障排查与运行限制

| 情况 | 处理方法 |
| --- | --- |
| Agent 找不到 wiki | 请它运行 `lumina wikis doctor`。若 wiki 已移动，请在聊天中登记新路径。 |
| Agent 不确定你指的是哪个 wiki | 回复 wiki 的名称或别名。Agent 不应替你选择。 |
| 安装后看不到 Lumina 技能 | 新开聊天或重启平台，然后再次运行相应的 `lumina install --yes --agents ...`。 |
| 检查发现缺少内容 | 使用 `lumina wikis doctor --fix`；它只会补齐缺失内容。 |

同一时间，每个 wiki 最好只由一个主要 Agent 写入。不要让两个 Agent 同时向同一个 wiki 导入文档或进行编辑。Lumina 也会让 wiki 保持分开：它不会在 wiki 之间建立链接，也不会把所有 wiki 合并回答一个问题。

只向 Agent 开放你愿意让它访问的文件夹和聊天渠道。如需更严格的边界，请使用各平台自己的权限和沙箱控制。

## 下一步

第一个 wiki 可以使用后，先发送一份小文档，再问一个与它有关的简单问题。这能确认整条流程都正常：聊天附件、正确的 wiki、文档导入和有用的回答。

日常使用 Lumina 命令，请回到[用户指南](zh.md)。
