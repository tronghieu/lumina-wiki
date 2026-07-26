# 通过 OpenClaw 或 Hermes 使用 Lumina-Wiki

将你正在使用的 OpenClaw 或 Hermes 聊天 Agent 与 Lumina-Wiki 连接一次，之后就能在熟悉的聊天中管理多个 wiki。你可以把文档发送到指定 wiki、询问其中的内容，或请 Agent 接管或创建 wiki，无需自己打开那个文件夹。

这是一份面向已能使用 OpenClaw 或 Hermes 的高级操作指南。安装聊天平台或连接聊天渠道，请参阅 [OpenClaw 官方文档](https://docs.openclaw.ai/) 或 [Hermes 官方文档](https://hermes-agent.nousresearch.com/docs/)。

## 开始前

- OpenClaw 或 Hermes 已能接收你的消息，并能在 Agent 自己的环境中运行命令。
- 该环境已安装 Node.js 20 或更高版本。请运行：

  ```bash
  node --version
  ```

- Agent 对你要用作 wiki 的文件夹有读写权限。
- 如果 Hermes 在 Docker 中运行，继续之前请把 wiki 文件夹和 `~/.lumina` 都挂载进容器。

当一个聊天 Agent 需要照看多个 wiki 时，使用本指南。若你只有一个 wiki，并且总是在编辑器里打开它，常规 Lumina-Wiki 设置通常更简单。

## 为聊天 Agent 安装 Lumina 技能

请在运行 Agent 的环境中执行以下命令。将 `<platform>` 替换为 `openclaw` 或 `hermes`：

```bash
npm install --global lumina-wiki
lumina install --yes --agents <platform>
```

如果两个平台在同一环境中运行，请在第二个命令中使用
`--agents openclaw,hermes`。

这会为所选平台安装由 Lumina 管理的技能；不会创建 wiki，也不会替换 Agent 已安装的无关技能。

### 检查点：确认 Agent 能看到 Lumina

新开一个聊天；若平台不会在聊天之间重新载入技能，请重启平台。然后问：

```text
你能帮我完成哪些 Lumina-Wiki 工作？
```

Agent 应说明自己可以管理一组 wiki，并能够使用 `/lumi-hub`。若不能，请参阅[故障排查](#故障排查)。

## 在聊天中添加第一个 wiki

告诉 Agent 你已有的 wiki 或一个新文件夹。请提供一个自然好叫的名称、一个简短别名；如果要创建新 wiki，还应提供用途和想要的可选包。

```text
在 /Users/me/wikis/ai-engineering 创建一个 wiki，名称是 AI 工程。
简称 AI wiki。它用于保存 AI 工程笔记和论文。加入 research 包。
```

Agent 会遵循一条安全、以聊天为先的流程：

1. 它检查路径，但不会先做改动。
2. 如果文件夹已有你的文件，它会告诉你发现了什么，并在添加 Lumina 文件前取得你的明确同意。
3. 它只询问仍缺少的信息，然后用一次只添加内容的操作创建并登记 wiki。

如果该路径已经是完整的 Lumina-Wiki，Agent 只会登记它，不会重新安装或升级。通过聊天创建的 wiki 会特意保持精简：聊天 Agent 的技能放在全局位置，wiki 则保存自己的笔记和工作文件。

### 检查点：wiki 已可在聊天中使用

请问：

```text
我有哪些 wiki？
```

你应该能看到 **AI 工程** 及其别名。之后使用别名发出请求时，Agent 会先找到正确的 wiki 再开始工作。

## 在聊天中工作

每次发送文档或提出任务时，都说出 wiki 名称：

```text
把这份 PDF 加到我的 AI wiki。

AI 工程 wiki 里关于评估驱动开发是怎么说的？

检查我的 AI wiki 中的失效链接。
```

对于每个请求，Agent 会按名称或别名找到 wiki，阅读该 wiki 的 `README.md`，然后在那里执行常规 Lumina 流程。如果主题只明确匹配一个 wiki，它会告诉你选择了哪一个；否则会请你选择。

你附上文档后，Agent 会先确认平台已提供该附件，再把一份不重名的新副本放入选定的 wiki，然后导入。它不会覆盖已有源文件。它的回复应说明发生改动的是哪个 wiki。

### 检查点：测试完整路径

发送一份小文档，并说“把这个加入我的 AI wiki”。完成后，问一个该文档能够回答的问题。成功结果表示附件、wiki 选择、导入和提问流程都正常。

## 保持整个 wiki 组健康

问 Agent：“我的所有 wiki 都正常吗？”它可以对已知的所有 wiki 运行只读健康检查。如果某个 wiki 缺少应有的 Lumina 部分，请让它修复该 wiki。修复只会补齐缺少的结构并应用安全的链接修复；绝不会删除或覆盖已有 wiki 内容。

你可以用平台的计划任务安排健康检查。用于自动化的命令是 `lumina wikis doctor --json`。请安排检查，而不要安排自动导入：仍应由你决定添加哪些文档。

## 故障排查

| 情况 | 处理方法 |
| --- | --- |
| 看不到 Lumina 技能 | 新开聊天或重启平台。确认 Node.js 和 `lumina` 命令在 Agent 自己的环境中可用，然后为该平台重新运行安装命令。 |
| Agent 找不到 wiki | 使用准确名称或别名。若文件夹已移动，告诉 Agent 新路径，让它检查并重新登记。 |
| Agent 在使用已有文件的文件夹前询问 | 这是正常的。查看它报告的文件，只有在你想把 Lumina 添加到这些文件旁边时才同意。 |
| 无法读取文档附件 | 检查平台的附件权限和当前大小限制，然后尝试更小的文件。由于这些限制可能变化，请以平台官方文档为准。 |
| 健康检查报告问题 | 请 Agent 修复指定 wiki。它只会补齐缺失部分并做安全修复，不会替换你的笔记或源文档。 |

## 运行限制与安全

- 同一时间，每个 wiki 只保留一个主要写入 Agent。不要让两个 Agent 同时向同一 wiki 导入或编辑。
- 各 wiki 保持独立。Lumina 不会在它们之间建立链接，也不会把它们合并为一个回答。
- 只向 Agent 开放你愿意让它使用的聊天渠道和文件夹。需要时请使用 OpenClaw 或 Hermes 的权限与沙箱控制。
- 通过聊天导入文档仍由你发起。除非你特意选择其他流程，否则只为健康检查使用计划任务。

如需在已选 wiki 中进行日常工作，请返回[用户指南](zh.md)。
