<p align="left" lang="zh-Hans">
  <img src="assets/lumina-logo.png" width="250" alt="Lumina-Wiki 标志">
</p>

# Lumina-Wiki

> **Where Knowledge Starts to Glow.**

把读过的资料变成一个以后可以继续提问的知识库。

Lumina-Wiki 为你的 AI 助手提供一个长期用于学习和研究的工作空间。你可以加入论文、书籍、报告、课程资料或个人笔记。助手会总结内容、连接相关观点，并把结果保存为电脑上的普通 Markdown 文件。

<p align="center">
  <img alt="许可证" src="https://img.shields.io/badge/License-MIT-blue.svg">
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-%3E%3D20-blue.svg">
</p>

<p align="center">
  <a href="README.md" lang="en">English</a> · <a href="README.vi.md" lang="vi">Tiếng Việt</a> · 简体中文
</p>

<p align="center">
  <a href="docs/user-guide/zh.md">从使用指南开始</a>
</p>

<p align="center">
  <a href="https://www.youtube.com/watch?v=XuhhjbwoNeQ">
    <img src="https://img.youtube.com/vi/XuhhjbwoNeQ/maxresdefault.jpg" alt="Lumina-Wiki 视频教程" width="560">
  </a>
  <br>
  <a href="https://www.youtube.com/watch?v=XuhhjbwoNeQ">▶ 观看视频教程（越南语）</a>
</p>

## 你可以用它做什么？

当你希望完成下面这些事情时，Lumina-Wiki 会很有用：

- 把从多份资料中学到的内容保存在同一个地方；
- 比较多个来源中的观点或证据；
- 准备考试、论文、文献综述或长期研究项目；
- 回到旧主题时，不必翻找以前的聊天记录；
- 把重要答案和支持这些答案的来源保存在一起。

你不需要手动建立 wiki。你负责选择资料和做出重要决定。AI 助手负责阅读、整理、建立联系和检查笔记等日常工作。

## 它如何工作？

Lumina-Wiki 使用两个主要文件夹：

- `raw/` 保存你的原始资料。
- `wiki/` 保存根据这些资料整理出的笔记。

```text
raw/ 中的原始资料
        |
        |  lumi-ingest
        v
wiki/ 中整理好的笔记
        |
        |  lumi-ask
        v
根据已读资料生成的回答
```

原始资料与 AI 编写的笔记始终分开。这样更容易检查观点来自哪里，也方便在需要时修改 wiki。

## 几分钟内开始使用

### 开始前

请安装 [Node.js](https://nodejs.org/en/download) 的当前 LTS 版本。你还需要一个可以访问电脑文件夹的 AI 工具，例如 Codex、Claude Code 或 Gemini CLI。

### 1. 创建工作空间

在你想保存知识库的文件夹中打开命令行窗口，然后运行：

```bash
npx lumina-wiki install
```

设置过程会询问你使用哪种 AI 工具，以及是否需要可选功能。如果不确定，可以保留建议选项。以后再次运行同一命令即可更改设置。

### 2. 加入一份资料

把 PDF、Markdown 或文本文件放入：

```text
raw/sources/
```

例如：

```text
raw/sources/my-first-paper.pdf
```

### 3. 请 AI 助手阅读

在 Codex 中输入：

```text
$lumi-ingest raw/sources/my-first-paper.pdf
```

在使用 `/` 命令的工具中，例如 Claude Code 或 Gemini CLI，输入：

```text
/lumi-ingest raw/sources/my-first-paper.pdf
```

助手会在保存新笔记前让你查看草稿。你可以同意、要求修改，也可以停止并在以后继续。

### 4. 提出第一个问题

资料加入后，可以尝试：

```text
/lumi-ask 这份资料的主要观点是什么？
```

如果使用 Codex，请把开头的 `/` 改为 `$`。

不知道下一步做什么时，可以使用 `/lumi-help` 或 `$lumi-help`。

如需带有检查点和常见问题处理方法的完整引导，请阅读[使用指南](docs/user-guide/zh.md)。

## 可选功能

基础功能始终可用。设置时还可以加入：

| 功能 | 适合这些需求 |
| --- | --- |
| 研究 | 查找论文、跟踪研究主题、评估来源和撰写文献综述。 |
| 阅读 | 按章节阅读书籍，同时避免提前透露后面的情节。 |
| 学习 | 记录自己在学习过程中理解发生的变化。 |

以后可以再次运行 `npx lumina-wiki install` 来加入或移除可选功能。你的资料和 wiki 笔记会被保留。

## 日常常用命令

下面这些命令足以满足大多数需求：

| 命令 | 用途 |
| --- | --- |
| `/lumi-help` | 获得一条适合当前情况的下一步建议。 |
| `/lumi-ingest` | 把一份资料加入 wiki。 |
| `/lumi-ask` | 根据 wiki 中已有的知识提问。 |
| `/lumi-edit` | 修改或更新一个 wiki 页面。 |
| `/lumi-verify` | 检查笔记是否与引用的来源一致。 |
| `/lumi-check` | 检查失效链接和其他问题。 |

所有命令请查看[命令参考](docs/user-guide/commands.zh.md)。

## 其他指南

- [新手教程](docs/user-guide/zh.md)
- [研究流程](docs/user-guide/research.zh.md)
- [命令参考](docs/user-guide/commands.zh.md)
- [定期查找研究资料](docs/user-guide/advanced-scheduled-discovery.zh.md) — 高级
- [使用 QMD 进行本机搜索](docs/user-guide/advanced-qmd.zh.md) — 高级
- [连接 OpenClaw 或 Hermes](docs/user-guide/openclaw-hermes-integration.zh.md) — 高级

你也可以用 [Obsidian](https://obsidian.md) 打开项目根文件夹，以图形界面浏览 Markdown 笔记。

## 更新或卸载

如需更新 Lumina-Wiki 或更改设置，请运行：

```bash
npx lumina-wiki install
```

如需移除由 Lumina-Wiki 管理的文件，请运行：

```bash
npx lumina-wiki uninstall
```

卸载后，`raw/` 中的原始资料和 `wiki/` 中的知识笔记都会保留。

## 参与贡献

开发说明请见 [CONTRIBUTING.md](CONTRIBUTING.md)。稳定的命令行约定在 [docs/cli-contract.md](docs/cli-contract.md) 中，后续计划在 [ROADMAP.md](ROADMAP.md) 中。

Lumina-Wiki 使用 [MIT 许可证](LICENSE)。

---

## 贡献者

感谢所有为 Lumina Wiki 做出贡献的人！

[![Contributors](https://contrib.rocks/image?repo=tronghieu/lumina-wiki)](https://github.com/tronghieu/lumina-wiki/graphs/contributors)

**想要贡献？** 请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 开始参与——欢迎提交 Bug 报告、新 skill、工具集成以及翻译。
