# 如何用 QMD 在大型 wiki 中进行本地搜索

当 wiki 中有很多 Markdown 笔记而你想在本机快速查找内容时，请使用本指南。QMD 是可选工具：Lumina-Wiki 不会安装它，也不会让 `/lumi-ask` 自动使用它。

## 前提条件

- Node.js 22 或更高版本；用 `node --version` 检查。
- 一个终端，以及安装全局 npm 包的权限。
- 在 macOS 上：Homebrew 和 Homebrew 的 SQLite 包。QMD 的扩展需要它。
- 一个包含 `wiki/` 文件夹的 Lumina-Wiki 工作区。

## 安装并检查 QMD

在 macOS 上，先安装 SQLite：

```bash
brew install sqlite
```

然后安装 QMD：

```bash
npm install -g @tobilu/qmd
qmd --version
qmd doctor
```

`qmd doctor` 会说明缺少哪些条件。如果 macOS 报告 SQLite 问题，请确认已安装 Homebrew SQLite，再按该命令的提示处理。

## 添加 wiki 并建立搜索索引

在工作区根目录中，将 wiki 添加为一个集合。选择一个不会和本机其他集合冲突的简短名称。

```bash
qmd collection add wiki --name my-wiki
qmd update
qmd embed
```

第一次建立语义搜索索引会下载本地模型，可能需要时间和磁盘空间。完成前请不要关闭终端。

## 验证是否可用

检查集合，然后搜索某篇笔记中确实出现过的短语：

```bash
qmd status
qmd collection show my-wiki
qmd search "笔记中的一个短语" -c my-wiki
qmd query "关于笔记的一个问题" -c my-wiki
```

用 `qmd search` 快速匹配关键词。用 `qmd query` 按含义搜索并获得排序结果。看到 wiki 中的路径和摘录，就说明 QMD 已能读取该集合。

## 在笔记变化后刷新索引

添加或编辑笔记后，运行：

```bash
qmd update
qmd embed
```

这两个命令会刷新 QMD 的结果；它们不会修改 wiki 中的笔记。

## 如果你想让 AI 助手使用 QMD

明确告诉助手需要运行什么，例如：

```text
请在 `my-wiki` 集合中使用 `qmd query` 查找与这个问题有关的笔记，并说明使用了哪些笔记。
```

助手能否运行 QMD 取决于它的权限和设置。若有需要，请单独配置连接；不要假定安装 QMD 会自动改变 Lumina-Wiki 的命令行为。

## 更新 QMD

更新工具，检查运行状况，然后刷新集合：

```bash
npm update -g @tobilu/qmd
qmd doctor
qmd status
qmd update
qmd embed
```

## 排查问题

| 问题 | 处理方法 |
| --- | --- |
| `qmd: command not found` | 关闭并重新打开终端。如果仍不可用，将 npm 的全局 bin 目录加入 `PATH`，然后重新安装 QMD。 |
| `qmd doctor` 提示 Node 版本不受支持 | 安装 Node.js 22 或更高版本，重开终端后再次运行 `node --version`。 |
| macOS 报告 SQLite 或扩展问题 | 运行 `brew install sqlite`，重开终端，然后运行 `qmd doctor`。 |
| 集合中缺少应有的笔记 | 在工作区根目录运行命令，检查 `qmd collection show my-wiki`，然后运行 `qmd update` 和 `qmd embed`。 |
| 最近的笔记没有出现在按含义搜索的结果中 | 先运行 `qmd update`，再运行 `qmd embed`；关键词搜索可能已能找到该笔记。 |

命令细节和支持的连接方式请查看 [QMD 官方文档](https://github.com/tobi/qmd)。
