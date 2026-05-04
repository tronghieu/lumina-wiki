# Lumina-Wiki 使用指南

Lumina-Wiki 帮你把 AI 变成个人知识助手：你把文档、笔记、论文或文章放到一个固定位置；AI 会阅读、总结、整理、建立关联，并把它们维护成一个以后可以继续提问的 wiki。

你可以把 Lumina-Wiki 看作阅读和研究用的“第二大脑”。不同之处在于，你不需要从零开始手写所有笔记。AI 会承担繁重的部分：阅读来源、提取要点、创建概念页面、记录文档之间的联系，并让 wiki 保持结构化。

你的角色是选择来源、提出问题、检查分析方向，并决定哪些内容重要。AI 的角色是维护 `wiki/` 里的知识区域：写新页面、更新旧页面、保持链接、更新目录、记录日志，并在 wiki 逐渐变大时帮助它保持一致。

## 目录

- [用旧方式管理知识时常见的问题](#用旧方式管理知识时常见的问题)
- [你可以用 Lumina-Wiki 做什么？](#你可以用-lumina-wiki-做什么)
- [Lumina-Wiki 如何工作？](#lumina-wiki-如何工作)
- [安装](#安装)
- [如何在 AI Agent 中调用命令](#如何在-ai-agent-中调用命令)
- [快速开始](#快速开始)
- [面向研究工作的 Research Pack](#面向研究工作的-research-pack)
- [常用命令](#常用命令)
- [与 Codex App、Claude Code、Gemini CLI 一起使用](#与-codex-appclaude-codegemini-cli-一起使用)
- [用 Obsidian 阅读 Wiki](#用-obsidian-阅读-wiki)
- [升级 Lumina-Wiki](#升级-lumina-wiki)
- [常见问题](#常见问题)
- [给研究者的一个推荐 Workflow](#给研究者的一个推荐-workflow)

## 用旧方式管理知识时常见的问题

资料还很少时，你可以把它们放在一个文件夹里，在浏览器里加星标，或者在笔记应用里写几行。但资料一多，这种方式通常会遇到很多问题：

- **资料分散在各处：** PDF 在下载文件夹里，链接在浏览器里，笔记在笔记应用里，而关键想法留在聊天记录中。
- **读完后很难再次使用：** 你记得自己读过一份重要资料，但不记得它在哪里，也不记得主要观点是什么。
- **笔记之间没有连接：** 同一个想法出现在多份资料里，但你必须自己记住哪份资料说了什么，以及它们之间有什么关系。
- **新资料不会更新旧理解：** 读到新的来源后，你需要自己回头修改旧笔记，补充矛盾、证据和链接。
- **很难写综述：** 到了需要写报告、论文、计划或演示文稿时，你要从很多地方重新收集并重新整理。
- **个人 wiki 容易荒废：** 一开始你可能记得很认真，但资料越多，命名、分组、建立链接和更新就越累。
- **把 AI 当作零散聊天来用，仍然容易从头开始：** 如果只是把文件上传到某一次聊天里，AI 当时可以回答，但好的分析通常会沉在聊天历史里，无法变成一个持续维护的知识库。

Lumina-Wiki 的做法是让 AI 负责照料 wiki。你仍然决定哪些来源重要、哪些问题值得追踪，但 AI 会帮助你把资料变成一个结构化的知识区域，并长期维护它。

## 你可以用 Lumina-Wiki 做什么？

当你有很多资料，并希望把它们变成一个可以继续提问的知识库时，Lumina-Wiki 会很有用。下面是一些具体使用场景。

### 1. 建立个人知识库

你阅读书籍、文章、报告、通讯、个人笔记或播客文字稿。也许你并没有做一个正式课题，但仍然希望自己读过的东西不要几天后就消失。

如果你想有一个地方保存要点、来源、未解决的问题，以及已读内容之间的联系，Lumina-Wiki 很适合。随着时间推移，wiki 会变成你的个人记忆库：你可以回来查看自己读过什么，哪些主题反复出现，哪些想法值得继续深入。

这个场景很适合自学者、阅读很多但不稳定记笔记的人，或者想建立一个“第二大脑”但不想手动维护每条笔记的人。

### 2. 管理者、公司运营者

你需要阅读很多类型的资料：市场报告、客户反馈、会议记录、竞品资料、内部战略、行业分析、新政策。问题不只是存储，而是把它们变成可用于决策的判断。

如果你经常需要问：客户最常抱怨什么，竞争对手正在怎样转向，哪些风险反复出现，哪些机会有足够强的证据，Lumina-Wiki 很适合。wiki 帮助 AI 保留每个判断的来源，连接分散的信号，并在新资料出现时维护一幅整体图景。

这个场景适合创始人、产品经理、战略、运营、市场、销售，或任何需要把多种信息来源转化为清晰决策的人。

### 3. 教师、课程设计者

你有教材、课件、参考资料、学习目标、练习、学生反馈、真实案例和拓展阅读。课程规模变大后，要记住哪一课对应哪个概念、哪个例子已经用过、学生常在哪些地方卡住，会越来越难。

如果你想为一门课程或培训项目建立知识库，Lumina-Wiki 很适合：核心概念、解释来源、例子、常见误解、课程之间的关系、哪些内容应该先教、哪些部分需要补充资料。

当你需要经常更新课程时，这个场景尤其有用。新资料可以放入 wiki，让 AI 帮你和旧课程建立关联，而不是让所有内容散落在多个文件夹中。

### 4. 学生

你有教材、课件、阅读材料、课堂笔记、复习提纲和参考资料。每个文件单独看都能理解，但到了复习考试或写作业时，你需要看清它们之间如何连接。

如果你常有“我明明读过了，但不知道该从哪里开始复习”的感觉，Lumina-Wiki 很适合。wiki 会积累每份资料的重要内容，创建概念页面，连接相关课程，并保存你要求过的总结。

这个场景适合长期学习：期末复习、写小论文、准备毕业论文、学外语、学习一门难课，或自学一项新技能。

### 5. 研究者

你处理学术论文、专著、技术报告、辅助数据、实验笔记、想法草稿和相关来源。你不只是需要总结每个来源，还需要看清这些来源如何相互构建、补充或反驳。

Lumina-Wiki 适合长期研究，因为 wiki 可以随着每个来源逐步积累。添加新资料时，AI 可以帮助更新旧概念，记录矛盾，关联作者、方法、证据和研究空白。

这个场景也是 Research Pack 发挥价值最多的地方：寻找相关来源，提前创建基础概念，选择值得阅读的资料，并根据 wiki 已知内容生成综述。

## Lumina-Wiki 如何工作？

Lumina-Wiki 使用两个主要区域：

- `raw/`：你放原始资料的地方。
- `wiki/`：由 AI 负责照料和维护的知识区域。AI 会在这里创建笔记、总结、概念、人物档案、回答，以及它们之间的链接。

简单来说：`raw/` 是你的来源资料库；`wiki/` 是 AI 帮你编写并长期整理的知识大脑。

例如：

```text
你把资料放入 raw/sources/
        ↓
你用 lumi-ingest 要求 AI 阅读
        ↓
AI 在 wiki/sources/ 中创建总结页面
        ↓
AI 更新概念、相关人物、链接、目录和日志
        ↓
你用 lumi-ask 再次提问
```

你不需要记住全部内部结构。日常使用时，只要记住：

- 原始资料放在 `raw/`，
- 已处理的知识放在 `wiki/`，
- 你通过名为 `lumi-*` 的命令使用 Lumina-Wiki。根据不同 AI 工具，你可以用 `/` 或 `$` 调用它们。

## 安装

在你想用作 wiki 的项目中打开 terminal，然后运行：

```bash
npx lumina-wiki install
```

安装程序会询问你几个选项，例如是否要额外安装 `research` 或 `reading` 等 pack。

如果你使用 Windows，README 建议开启 Developer Mode，这样 installer 可以更好地使用 symlink。如果没有开启，Lumina-Wiki 仍然可以改用复制文件的方式。

## 如何在 AI Agent 中调用命令

Lumina-Wiki 的命令名称形如 `lumi-*`，例如 `lumi-ingest`、`lumi-ask`、`lumi-research-discover`。

调用命令的语法取决于你使用的 AI 工具：

| 工具 | 示例语法 |
| --- | --- |
| Codex App | `$lumi-ingest raw/sources/tai-lieu.pdf` |
| Claude Code | `/lumi-ingest raw/sources/tai-lieu.pdf` |
| Gemini CLI | `/lumi-ingest raw/sources/tai-lieu.pdf` |

下面的大多数示例使用 `/lumi-*` 语法。如果你使用 Codex App，请把 `/` 改成 `$`。

## 快速开始

### 1. 把资料放入 `raw/sources/`

例如你有一个文件：

```text
bao-cao-giao-duc.pdf
```

请把它放到：

```text
raw/sources/bao-cao-giao-duc.pdf
```

### 2. 要求 AI 把资料放入 wiki

在与 AI agent 的聊天窗口中运行：

```text
/lumi-ingest raw/sources/bao-cao-giao-duc.pdf
```

如果使用 Codex App，请用 `$` 调用 skill：

```text
$lumi-ingest raw/sources/bao-cao-giao-duc.pdf
```

AI 会阅读资料，在 `wiki/sources/` 中创建总结页面，并在需要时创建其他相关页面。

### 3. 向知识库提问

当 wiki 中已经有几份资料后，你可以问：

```text
/lumi-ask 这些资料正在讨论哪些共同问题？
```

或者：

```text
/lumi-ask 请比较最近三份资料的主要观点。
```

Lumina-Wiki 会帮助 AI 基于已经放入 `wiki/` 的知识回答，而不是只依赖某一次聊天的临时记忆。

一个重要回答也可以成为 wiki 中的新页面。这样，阅读、比较和分析的结果不会丢在聊天历史里，而是继续积累到共同的知识区域中。

![AI 在 Codex App 中基于 wiki 回答的示例](../../assets/social-impacts-of-AI-lumi-answer.png)

Codex App 中的示例：AI 基于 Lumina-Wiki 已构建的知识库进行回答。

## 面向研究工作的 Research Pack

如果你用 Lumina-Wiki 做研究，Research Pack 会非常有用，尤其是在你需要寻找相关资料、筛选来源、建立概念基础，或根据已读内容写综述时。

Research Pack 有四个主要命令：

| 命令 | 用来做什么 |
| --- | --- |
| `/lumi-research-setup` | 准备研究环境，检查 Python 工具，并在需要时协助配置 API key。 |
| `/lumi-research-discover` | 查找并排序与你提供的主题相关的研究来源。 |
| `/lumi-research-prefill` | 提前为常见概念创建基础页面，让后续阅读更稳定地建立链接。 |
| `/lumi-research-survey` | 根据 wiki 中已有的来源和概念生成研究综述。 |

### 什么时候应该使用 Research Pack？

当你正在做下面这些事情时，可以使用 Research Pack：

- 为某个主题寻找新资料，
- 选择哪些资料应该先读，
- 为一个领域建立知识基础，
- 提前创建基础概念，让后续阅读不会因为理解或命名不一致而偏离，
- 把已经读过的资料整理成一份综述，
- 寻找不同来源之间的空白或分歧。

### 一个研究流程示例

假设你想研究“在课堂上使用手机的影响”。

首先，配置研究工具：

```text
/lumi-research-setup
```

接着，建议先创建几个基础概念：

```text
/lumi-research-prefill 课堂上使用手机
```

```text
/lumi-research-prefill 学生注意力水平
```

这一步帮助 AI 在阅读大量资料之前先有一层共同概念。当不同来源用不同说法表达同一个意思时，wiki 更容易把它们连接到同一个知识基础中，而不是创建很多零散页面或产生理解偏差。

然后，让 Lumina-Wiki 查找来源：

```text
/lumi-research-discover 课堂上使用手机的影响
```

这个命令会生成候选列表供你查看。它不会自动把所有结果都变成 wiki 页面。你选择哪些资料值得读，然后逐个 ingest：

![Research Pack 在 Codex App 中发现新论文的示例](../../assets/lumi-discover-new-paper.png)

Codex App 中的示例：Research Pack 建议新的研究来源，供你在放入 wiki 之前先查看。

```text
/lumi-ingest <你选择的文档或来源>
```

当 wiki 中已经有一些来源后，你可以问：

```text
/lumi-ask 这些资料如何描述手机对注意力水平的影响？
```

或者生成综述：

```text
/lumi-research-survey 课堂上使用手机
```

重点是：Research Pack 帮你扩展和组织研究过程。把某个具体来源放入 wiki 仍然要通过 `/lumi-ingest`，这样 wiki 才能保持清晰的结构、链接和日志。

对于长期研究，最大的价值是积累：每个新来源不只是被单独总结，还可能澄清旧概念、为某个论点补充来源，或指出它与 wiki 之前记录的内容存在矛盾。

### 研究时常用的问题示例

```text
/lumi-ask 哪些资料的证据最可靠？
```

```text
/lumi-ask 作者们在哪些问题上存在分歧？
```

```text
/lumi-ask 哪些观点组被最多来源提到？
```

```text
/lumi-ask 如果我要写文献综述，应该分成哪些主题组？
```

```text
/lumi-research-survey 请综合这个领域的主要方向，并指出研究空白。
```

## 常用命令

下面的示例使用 `/lumi-*` 语法，适合使用 slash command 的环境。如果你使用 Codex App，请把 `/lumi-*` 改成 `$lumi-*`，例如把 `/lumi-ingest` 改成 `$lumi-ingest`。

| 命令 | 简单理解 |
| --- | --- |
| `/lumi-init` | 准备初始 wiki 结构，并扫描 `raw/` 中已有的内容。 |
| `/lumi-ingest <文件或来源>` | 把一份资料放入 wiki。这是你会经常使用的命令。 |
| `/lumi-ask <问题>` | 向 `wiki/` 中已经创建的知识库提问。 |
| `/lumi-edit <wiki 页面>` | 请 AI 修改或更新某个具体 wiki 页面。 |
| `/lumi-check` | 请 AI 检查 wiki 的健康状态：结构错误、断开的链接，或没有正确更新的页面。 |
| `/lumi-reset` | 以受控方式删除或重置 wiki 的一部分。 |

## 与 Codex App、Claude Code、Gemini CLI 一起使用

Lumina-Wiki 不是一个独立的聊天应用。它是一套文件夹结构、script 和命令，让 AI agent 在你的项目中工作。

对于 Codex App、Claude Code 或 Gemini CLI 这类工具，通用用法是：

1. 打开已经安装 Lumina-Wiki 的正确项目文件夹。
2. 在该项目中与 AI agent 聊天。
3. 按照该工具支持的语法调用 Lumina 命令。

### Codex App

[Codex](https://openai.com/codex) 是 OpenAI 的 coding agent。与 Lumina-Wiki 一起使用时，请在 Codex App 中打开已安装 Lumina-Wiki 的项目，然后用 `$` 调用 skill。

例如：

```text
$lumi-ingest raw/sources/bao-cao-giao-duc.pdf
```

```text
$lumi-ask 这些资料正在讨论哪些共同问题？
```

本指南不会详细说明 Codex App 中每个按钮，因为应用界面可能会变化。关键是 Codex 需要在正确的项目文件夹中工作，也就是包含 `AGENTS.md`、`README.md`、`raw/`、`wiki/` 和 `_lumina/` 的地方。

### Claude Code

使用 Claude Code 时，打开已安装 Lumina-Wiki 的项目，并在聊天中使用 `/lumi-*` 命令。Lumina-Wiki 为 Claude Code 提供了 entry file，让 agent 知道需要阅读 README，并使用已经安装的正确 skill。

### Gemini CLI

使用 Gemini CLI 时，在已安装 Lumina-Wiki 的项目中打开 terminal，然后在正确文件夹内与 Gemini 聊天。Lumina-Wiki 为 Gemini CLI 提供了 entry file，让 agent 理解 wiki 结构和 Lumina 命令。

## 用 Obsidian 阅读 Wiki

[Obsidian](https://obsidian.md/) 是一款笔记应用，它把你的笔记保存为本机 Markdown 文件，并帮助你把笔记相互连接。

因为 Lumina-Wiki 会创建 Markdown 文件，如果你想更方便地阅读和浏览 wiki，可以用 Obsidian 打开项目文件夹。README 建议打开**项目根目录**，而不是只打开 `wiki/` 文件夹。

![在 Obsidian 中查看 Lumina-Wiki](../../assets/obsidian-preview.png)

图片来源：[obsidian.md](https://obsidian.md/)

## 升级 Lumina-Wiki

当你想升级某个已有项目中的 Lumina-Wiki 时，重新运行：

```bash
npx lumina-wiki install
```

Installer 会更新 script、schema 和 skill。你在 `wiki/` 中的知识内容、`raw/` 中的原始资料，以及已有日志都会保留下来。

如果旧 wiki 缺少一些新的 metadata 字段，installer 可能会给出警告。此时你可以运行：

```text
/lumi-migrate-legacy
```

这个命令会帮助 AI 阅读 changelog，并以受控方式为旧页面补充缺失信息。

## 常见问题

### 我需要会编程吗？

基本使用 Lumina-Wiki 不需要会编程。你需要知道如何打开 terminal、运行安装命令、把文件放到正确文件夹，然后与 AI agent 聊天。

### 我应该把文件放在哪里？

主要资料，例如 PDF、论文、报告、文字稿，应该放在：

```text
raw/sources/
```

个人笔记可以放在：

```text
raw/notes/
```

### 我应该手动修改 `wiki/` 里的文件吗？

可以，但要谨慎。`wiki/` 是 AI 负责维护结构、链接和 metadata 的知识区域。如果想修改某个页面，更好的方式是使用：

```text
/lumi-edit <wiki 页面路径>
```

### 我刚把资料放进 `raw/`，为什么 `/lumi-ask` 还不知道？

因为新的原始资料还只是放在 `raw/` 里。请先用下面的命令把它放入 wiki：

```text
/lumi-ingest raw/sources/<文件名>
```

之后 `/lumi-ask` 才能使用 `wiki/` 中已经处理过的知识。

### 什么是 API key？

API key 是外部服务提供的一串密钥，例如 Semantic Scholar 或 DeepXiv。Research Pack 可以使用一些 API key 来寻找更好的来源，或提高访问限制。不要把 API key 放进你准备 commit 或公开分享的文件中。

### Obsidian 可以替代 Lumina-Wiki 吗？

不能。Obsidian 是笔记应用。Lumina-Wiki 是帮助 AI 阅读资料并创建结构化 wiki 的系统。两个工具可以一起使用，但角色不同。

## 给研究者的一个推荐 Workflow

1. 安装 Lumina-Wiki，并选择 Research Pack。
2. 运行 `/lumi-research-setup` 检查研究工具。
3. 用 `/lumi-research-prefill` 为领域中的基础概念做预填充。
4. 把已有资料放入 `raw/sources/`。
5. 对每份重要资料运行 `/lumi-ingest`。
6. 用 `/lumi-research-discover` 查找更多相关来源。
7. 选择值得阅读的来源并继续 ingest。
8. 用 `/lumi-ask` 提问、比较、寻找空白。
9. 用 `/lumi-research-survey` 根据 wiki 已知内容生成综述。
10. 如果想更方便地阅读和浏览 Markdown 笔记，可以用 Obsidian 打开项目。

Lumina-Wiki 越是持续使用，越有价值。每一份被好好 ingest 的资料，都会让你的知识大脑更清晰、链接更丰富，也更容易再次提问。你得到的不只是多一份总结，而是在一个共同系统中多了一部分由 AI 照料的知识。
