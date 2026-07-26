# 通过第一份资料学习使用 Lumina-Wiki

在这份简短的练习中，你会建立一个个人学习空间，加入一份资料，把它变成有用的笔记，并就它提出问题。完成后，你会知道原始资料该放在哪里、怎样请 Lumina-Wiki 阅读它，以及怎样检查结果。

## 开始前的准备

你需要：

- 一台已安装最新版 LTS [Node.js](https://nodejs.org/) 的电脑。
- 一个存放 wiki 的空文件夹，例如 `Documents/my-study-wiki`。
- 一个能使用电脑文件的 AI 应用。在安装时选择你准备使用的应用。
- 一份用于练习的小资料：PDF、文本文件或 Markdown 笔记。

## 1. 安装 Lumina-Wiki

在 macOS 或 Linux 上打开 Terminal，在 Windows 上打开 PowerShell。进入刚创建的空文件夹，然后运行：

```bash
npx lumina-wiki install
```

用日常语言回答安装问题：选择语言，说明你想学习或研究什么，选择 AI 应用，并按需选择额外功能包。基础工具会自动包含。只有当你以后想获得查找和整理研究资料的帮助时，才选择 Research 功能包。

安装完成后，在你选择的 AI 应用中打开该文件夹。

### 检查点

你应该会看到 `raw/` 文件夹，用来放原始资料；以及 `wiki/` 文件夹，用来放 Lumina-Wiki 建立的笔记。让 AI 照料 `wiki/` 中的文件；你的第一项工作只是加入一份资料。

## 2. 询问 Lumina-Wiki 下一步该做什么

在 AI 聊天窗口中，先使用 `lumi-help`。它会读取当前工作空间的状态，并推荐一个有用的下一步操作。以后不知道该做什么时，也可以再次使用它。

在 Codex 中输入：

```text
$lumi-help
```

在大多数其他受支持的 AI 应用中输入：

```text
/lumi-help
```

对于新的工作空间，Lumina-Wiki 通常会建议先初始化 wiki。请按照这个建议运行启动命令：

```text
$lumi-init
```

```text
/lumi-init
```

这个命令会为第一份资料准备空 wiki。如果你不确定是否已经做过，可以安全地再次运行。

### 检查点

AI 应该会告诉你 wiki 已准备好。再次运行 `lumi-help`，确认新的建议已经反映工作空间的当前状态。

## 3. 加入一份资料

把练习资料复制到 `raw/sources/`。例如：

```text
raw/sources/learning-notes.pdf
```

选择主题清楚的资料。短文章或几页笔记很适合作为第一次练习。即使 Lumina-Wiki 已经读过它，也请把原始文件保留在这里。

### 检查点

确认文件能在 `raw/sources/` 中看到，而且文件名便于你认出。

## 4. 请 Lumina-Wiki 阅读资料

告诉 AI 要加入哪一个文件。在 Codex 中：

```text
$lumi-ingest raw/sources/learning-notes.pdf
```

在其他受支持的 AI 应用中：

```text
/lumi-ingest raw/sources/learning-notes.pdf
```

Lumina-Wiki 会阅读资料，提出摘要和相关想法，并在过程中让你查看结果。请阅读它展示的简短草稿。如果草稿准确，就同意；如果你希望修改，就直接说明。你不需要了解笔记的内部安排也能给出有用意见；例如“把主要结论说得更清楚”就足够。

### 检查点

完成后，你应该会有：

- `wiki/sources/` 中的一页资料笔记。
- 资料中出现的重要想法或人物的笔记。
- `wiki/index.md` 中更新后的资料清单。

打开新的资料页面，检查两件事：摘要是否符合你提供的资料，以及你能否找到页面上提到的原始文件。

## 5. 提一个有用的问题

现在就 Lumina-Wiki 已读的内容提问：

```text
$lumi-ask 这份资料中对初学者最有用的三个想法是什么？
```

或者：

```text
/lumi-ask 这份资料中对初学者最有用的三个想法是什么？
```

回答应该会带你回到相关笔记和资料。如果 wiki 里的内容还不够，AI 会说明原因并建议接下来该加入什么。

### 最后检查

当以下四项都成立时，你就完成了第一个循环：

- 原始文件仍在 `raw/sources/` 中。
- `wiki/sources/` 中有对应页面。
- `wiki/index.md` 包含新资料。
- `/lumi-ask` 或 `$lumi-ask` 能根据该资料回答，并告诉你在哪里查看。

## 你学到了什么

你已经掌握 Lumina-Wiki 的日常节奏：保留原始资料，用 `lumi-ingest` 加入它，查看笔记，再用 `lumi-ask` 提问。每当读到值得保存的内容，就重复这个单份资料的循环。

## 下一步

- [查阅所有可用命令](commands.zh.md)。
- [按照实用的研究流程进行](research.zh.md)。
- [高级：定期查找研究资料](advanced-scheduled-discovery.zh.md)。
- [高级搜索](advanced-qmd.zh.md)。
- [从聊天服务使用多个 wiki](openclaw-hermes-integration.zh.md)。
