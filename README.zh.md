<p align="center" lang="zh-Hans">
  <img src="assets/lumina-logo.png" width="250" alt="Lumina-Wiki Logo">
</p>

# Lumina-Wiki

> **Where Knowledge Starts to Glow.**
>
> 把 AI 变成您的个人知识助手和第二大脑。

<p align="center">
  <img alt="License" src="https://img.shields.io/badge/License-MIT-blue.svg"/>
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-%3E%3D20-blue.svg"/>
  <img alt="Python" src="https://img.shields.io/badge/Python-3.9+-yellow.svg"/>
  <img alt="Skills" src="https://img.shields.io/badge/Skills-14-purple.svg"/>
  <br>
  <img alt="Powered by" src="https://img.shields.io/badge/Powered%20by-grey?style=flat"/>
  <img alt="Claude" src="https://img.shields.io/badge/-Claude%20Code-orange?style=flat"/>
  <img alt="Codex" src="https://img.shields.io/badge/-Codex-blueviolet?style=flat"/>
  <img alt="Gemini" src="https://img.shields.io/badge/-Gemini-4285F4?style=flat"/>
</p>

<p align="center">
  <a href="README.md" lang="en">English</a> • <a href="README.vi.md" lang="vi">Tiếng Việt</a> • 简体中文
</p>

<p align="center">
  <a href="docs/user-guide/zh.md">用户指南</a>
</p>

## 目录

- [快速开始与安装](#2-快速开始)
- [用户指南](docs/user-guide/zh.md)
- [核心工作流](#1-核心工作流)
- [第一组指令](#3-您的第一组指令核心技能)
- [目录结构指南](#4-目录结构指南)
- [可用技能](#5-可用技能v01)
- [未来规划](#6-未来规划)
- [贡献与许可](#7-贡献与许可)
- [其他语言](#8-其他语言)

---

## 1. 核心工作流

Lumina-Wiki 遵循一个简单原则：将您的原始资料与 AI 的结构化知识分开。

```text
+-------------------------+      /lumi-ingest      +---------------------------+
|      您的输入            | ---------------------> |      AGENT 的大脑         |
|      (raw/ 文件夹)       |                        |      (wiki/ 文件夹)       |
|                         | <--------------------- |                           |
|  - paper.pdf            |       /lumi-ask        |  - paper.md (摘要)        |
|  - notes.txt            |                        |  - concept-a.md           |
+-------------------------+                        +---------------------------+
```

1.  **您提供：** 将文档（PDF、笔记）放入 `raw/` 目录。
2.  **Agent 构建：** 在 AI 对话中使用指令（如 `/lumi-ingest`），让 Agent 从 `raw/` 读取内容，并在 `wiki/` 中构建结构化、互相关联的维基。
3.  **您使用：** 通过 `/lumi-ask` 直接向 `wiki/` 中的 Agent“大脑”提问，获得更快、更贴合上下文的回答。

## 2. 快速开始

### **第一步：安装**

用一条命令把 wiki 工作区安装到当前项目中：

运行此命令前，您的电脑需要安装 **Node.js**。如果尚未安装，请从官方网站下载并安装推荐版本：[nodejs.org/en/download](https://nodejs.org/en/download)。

```bash
npx lumina-wiki install
```

> **Windows 用户注意：** 为了获得最佳体验，建议[启用开发者模式](https://learn.microsoft.com/zh-cn/windows/apps/get-started/enable-your-device-for-development)，以便安装程序正确使用符号链接。如果开发者模式关闭，安装程序会退回到复制 skill 文件；功能仍然可用，但对后续更新不如符号链接理想。

安装程序会引导您完成几个快速设置步骤，包括选择可选的 **Packs**，例如 `research`（研究）和 `reading`（阅读）。

### **第二步（可选）：配置 Research Pack**

如果您安装了 `research` 包，部分技能可以使用 API key 来获得更好的在线搜索效果。在 AI 对话中运行：

> **您：**
> `/lumi-research-setup`

Agent 会引导您检查研究工具，并在需要时把 key 保存到本地 `.env` 文件中。

### **第三步（升级时）：迁移旧版 Wiki 条目**

如果您在已经有旧版 `wiki/` 的项目上重新安装 Lumina-Wiki，直接再次运行 `npx lumina-wiki install` 即可。安装器会更新 scripts、schemas 和 skills；**您在 `wiki/`、`raw/`、`log.md` 中的内容不会被修改**。

如果安装器提示旧条目缺少新的 frontmatter 字段，可以用两种方式回填：

- **推荐：** 打开 AI 对话并运行 `/lumi-migrate-legacy`。
- **更快：** 运行终端命令：

```bash
node _lumina/scripts/wiki.mjs migrate --add-defaults
```

有关各版本 schema 变更的细节，请查看 [`CHANGELOG.md`](CHANGELOG.md) 或安装后的本地副本 `_lumina/CHANGELOG.md`。

## 3. 您的第一组指令（核心技能）

在 AI Agent 的聊天界面中使用这些指令与 wiki 交互，例如 Gemini CLI、Claude 等。

**阶段一：导入与构建知识**
-   `/lumi-init`: 扫描 `raw/` 目录并执行首次 wiki 构建。
-   `/lumi-ingest [path/to/file]`: 处理一个新文档并将其集成到知识库中。

**阶段二：查询与维护**
-   `/lumi-ask [您的问题]`: 基于 `wiki/` 中的完整知识库提问。
-   `/lumi-edit [path/to/wiki/page]`: 要求修改或修正某个具体 wiki 页面。
-   `/lumi-check`: 检查整个 wiki 的问题（断链、孤立页面等）。

*如果您安装了 `research` 或 `reading` 等可选包，还会有额外技能可用。*

---

## 4. 目录结构指南

Lumina 会创建一个工作区，每个目录都有明确用途。

| 路径 | 用途 | 管理方 |
| :--- | :--- | :--- |
| **`raw/`** | **您的不可变输入库。** Agent **只从这里读取**。 | **您** |
| `raw/sources/` | 放置主要文档（PDF、论文）的位置。 | 您 |
| `raw/notes/` | 您的个人笔记和未结构化想法。 | 您 |
| `raw/assets/` | 笔记所需的图片或其他资产。 | 您 |
| `raw/discovered/`| *(Research Pack)* `/lumi-research-discover` 找到的论文会保存在这里。 | Agent |
| **`wiki/`** | **Agent 的大脑。** Agent 在这里**写入**结构化知识。 | **Agent** |
| `wiki/sources/` | 为 `raw/sources` 中每个文档生成的 AI 摘要。 | Agent |
| `wiki/concepts/` | 被抽取成独立页面的核心想法和定义。 | Agent |
| `wiki/people/` | 作者、研究人员等人物资料。 | Agent |
| `wiki/outputs/` | `/lumi-ask` 的详细回答会保存在这里，便于引用。 | Agent |
| `wiki/index.md` | 整个 wiki 的主目录。 | Agent |
| `...` | *(其他实体目录，如 `foundations/`、`characters/`，会随对应 pack 出现)* | Agent |
| **`_lumina/`** | Lumina 管理的引擎、脚本和配置。 | **系统** |
| **`.agents/`** | Agent 可以使用的 skills。 | **系统** |

通常您只需要在 `raw/` 中工作，并阅读 `wiki/` 中的结果；不需要修改系统目录。

### **使用 Obsidian 浏览 Wiki（可选）**

[Obsidian](https://obsidian.md) 是一款本地 Markdown 笔记应用，可以帮助您阅读和浏览互相关联的笔记。由于 Lumina-Wiki 也生成 Markdown 文件，您可以用 Obsidian 打开**项目根目录**，更方便地阅读 wiki。更多信息请见[用户指南](docs/user-guide/zh.md#用-obsidian-阅读-wiki)。

### **使用 qmd 进行本地搜索（高级，可选）**

当 wiki 逐渐变大时，您可以使用 [qmd](https://github.com/tobi/qmd) 获得更快的本地 Markdown 搜索。如果您的 IDE 支持 skill 格式，可以通过以下命令安装官方 qmd skill：

```bash
npx skills add https://github.com/tobi/qmd --skill qmd
```

---

## 5. 可用技能（v0.1）

这些是您在与 AI 对话时可以使用的指令。

| Pack | Skill | 用途 |
| :--- | :--- | :--- |
| **Core** | `/lumi-init` | 从 `raw/` 中的所有文件初始化 wiki。 |
| | `/lumi-ingest` | 处理一个新文档并写入 wiki。 |
| | `/lumi-ask` | 基于整个知识库提问。 |
| | `/lumi-edit` | 要求手动编辑 wiki 页面。 |
| | `/lumi-check` | 检查 wiki 中的问题（断链等）。 |
| | `/lumi-reset` | 安全地删除 wiki 的部分内容。 |
| **Research**| `/lumi-research-discover` | 发现并排序相关研究论文。 |
| | `/lumi-research-survey` | 从现有知识创建综述/调研。 |
| | `/lumi-research-prefill` | 预先生成基础概念，避免重复。 |
| | `/lumi-research-setup` | 帮助配置研究工具的 API key。 |
| **Reading** | `/lumi-reading-chapter-ingest`| 按章节导入书籍知识。 |
| | `/lumi-reading-character-track`| 追踪故事中的角色及其关系。 |
| | `/lumi-reading-theme-map` | 识别并映射故事主题。 |
| | `/lumi-reading-plot-recap` | 提供情节的顺序回顾。 |

后台脚本位于 `_lumina/scripts/` 和 `_lumina/tools/`；通常您不需要直接调用它们。

---

## 6. 未来规划

当前版本是 **v0.2**（预览版）。完整计划见 [`ROADMAP.md`](./ROADMAP.md)。主要项目：

**v1.0.0 — 首个稳定版**
- **每日搜索与获取** — watchlist (`_lumina/config/watchlist.yml`) 按计划运行；来自 arXiv / Semantic Scholar 的新论文自动进入 `raw/discovered/<日期>/`。
- 新技能 `/lumi-daily`，用于整理上次运行以来刚收集到的内容。
- 锁定 v0.1 的稳定接口（CLI flags、退出码、schema 字段名）。
- 跨平台 CI 矩阵（macOS + Linux + Windows，Node 20 + 22）。

**v2.0.0 — 扩展 Research Pack 的论文来源**
- **新论文来源：** OpenAlex、Unpaywall、CORE（优先级 1）→ OpenReview、Hugging Face Papers、Papers With Code（优先级 2）→ Crossref、DOAJ、研究实验室博客 RSS（优先级 3）。
- **论文评估：** 新技能 `/lumi-rank`，将 influential-citation count、领域归一化排名、Scite support/contrast 和 Altmetric 添加到 frontmatter 的 `ranking:` 区块。

**想贡献？** 选择 `ROADMAP.md` 中任何未勾选的项目，开 issue 认领，然后提交 PR。所有论文来源 fetcher 都遵循 `src/tools/` 中相同模式（CLI + JSON、no async、退出码 `0/2/3`），很适合作为第一次贡献。请参考下面的本地开发步骤。

---

## 7. 贡献与许可

### 本地开发（贡献者）

如果您想为 `lumina-wiki` 安装器做贡献：
```bash
# 1. 克隆并安装依赖
git clone https://github.com/tronghieu/lumina-wiki.git
cd lumina-wiki
npm ci

# 2. 运行测试
npm run test:all
```

## 8. 其他语言

- [English（英文）](README.md)
- [Tiếng Việt（越南语）](README.vi.md)

**许可：** [MIT](LICENSE) © Lưu Trọng Hiếu.
