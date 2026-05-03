<p align="center" lang="zh">
  <img src="assets/lumina-logo.png" width="250" alt="Lumina-Wiki Logo">
</p>

# Lumina-Wiki

> **Where Knowledge Starts to Glow.**
>
> 专为技术研究设计的 LLM 维护型知识库。

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

---

## 1. 核心工作流

Lumina-Wiki 遵循一个简单的原则：将您的原始资料与 AI 的结构化知识分开。

```text
+-------------------------+      /lumi-ingest      +---------------------------+
|      您的输入            | ---------------------> |      AGENT 的大脑         |
|      (raw/ 文件夹)       |                        |      (wiki/ 文件夹)       |
|                         | <--------------------- |                           |
|  - my-paper.pdf         |       /lumi-ask        |  - my-paper.md (摘要)     |
|  - my-notes.txt         |                        |  - concept-a.md           |
+-------------------------+                        +---------------------------+
```

1.  **您提供：** 将您的文档（PDF、笔记）放入 `raw/` 目录。
2.  **Agent 构建：** 在 AI 聊天中使用指令（如 `/lumi-ingest`）让 Agent 读取 `raw/` 内容，并在 `wiki/` 目录中构建一个结构化、互相关联的维基。
3.  **您查询：** 针对 `wiki/` 中 Agent 的“大脑”进行提问（使用 `/lumi-ask`），获得更快、更具上下文感知能力的回答。

## 2. 快速开始

### **第一步：安装**
在当前项目中使用一条指令安装维基工作区：

```bash
npx lumina-wiki install
```
> **Windows 用户注意：** 为了获得最佳体验，建议[开启开发者模式](https://learn.microsoft.com/zh-cn/windows/apps/get-started/enable-your-device-for-development)，以便安装程序正确使用符号链接。如果开发者模式关闭，安装程序将退而使用文件复制，虽然功能正常，但不利于后续更新。

安装程序将引导您进行快速设置，包括选择可选的 **Packs**（如 `research` 和 `reading`）。

### **第二步（可选）：配置 Research Pack**
如果您安装了 `research` 包，某些技能需要 API 密钥才能进行在线搜索。请在 AI 聊天窗口中运行设置技能进行配置：

> **您：**
> `/lumi-research-setup`

Agent 将引导您通过交互式设置将密钥保存到本地 `.env` 文件中。

## 3. 常用指令（核心技能 Core Skills）

在您的 AI 聊天界面（Gemini CLI, Claude 等）中使用这些指令与维基进行交互。

**第一阶段：导入与构建**
-   `/lumi-init`: 扫描 `raw/` 目录并执行维基的首次构建。
-   `/lumi-ingest [path/to/file]`: 处理单个新文档并将其集成到知识库中。

**第二阶段：查询与维护**
-   `/lumi-ask [您的提问]`: 针对 `wiki/` 中的整个知识库进行提问。
-   `/lumi-edit [path/to/wiki/page]`: 要求对特定的维基页面进行修改或更正。
-   `/lumi-check`: 检查维基是否存在错误（死链等）。

*如果您安装了可选包如 `research` 或 `reading`，还会有更多可用技能。*

---

## 4. 工作区目录指南

Lumina 创建的工作区为每个目录都设定了明确的用途。

### **主要文件夹（您的日常工作区）**

| 路径 | 用途 | 管理方 |
| :--- | :--- | :--- |
| **`raw/`** | **您的不可变输入库。** Agent **只读**此目录。 | **您** |
| `raw/sources/` | 放置您的主要文档（PDF、文章）。 | 您 |
| `raw/notes/` | 您的个人、非结构化笔记和想法。 | 您 |
| `raw/assets/` | 用于笔记的图片或其他资产。 | 您 |
| `raw/discovered/`| *(Research Pack)* 由 `/lumi-research-discover` 找到的论文保存在此处。 | Agent |
| **`wiki/`** | **Agent 的大脑。** Agent 在此**写入**结构化知识。 | **Agent** |
| `wiki/sources/` | 为 `raw/sources` 中的每个文档生成 AI 摘要。 | Agent |
| `wiki/concepts/` | 核心思想和定义被提取到独立页面中。 | Agent |
| `wiki/people/` | 作者、研究人员等的概况。 | Agent |
| `wiki/outputs/` | 来自 `/lumi-ask` 的详细回答保存在此处供参考。 | Agent |
| `wiki/index.md` | 维基的主要目录索引。 | Agent |
| `...` | *(其他实体文件夹如 `foundations/`, `characters/` 会随包安装出现)* | Agent |


### **系统文件夹（由 Lumina 管理）**

| 路径 | 用途 | 管理方 |
| :--- | :--- | :--- |
| **`_lumina/`** | 维基的核心引擎、脚本和配置。 | **系统** |
| **`.agents/`** | 包含 Agent 可以使用的所有 `skills`（技能）。 | **系统** |
| `...` | *(其他点文件如 `.claude/`, `.gitignore`)* | **系统** |

**注意：** 您通常不需要修改系统文件夹。

### **使用 Obsidian 浏览您的 Wiki（可选）**

[Obsidian](https://obsidian.md) 是与 Lumina-Wiki 配合使用的推荐可视化工具。由于 Wiki 使用原生 Obsidian `[[wikilinks]]` 语法，您无需额外配置即可获得完整的图谱视图、反向链接面板和属性查询功能。

**将 Vault 指向项目根目录** — 而非仅指向 `wiki/` 子文件夹。项目根目录包含 `index.md`、`log.md`，以及 `wiki/` 页面与 `raw/` 原始文件之间的交叉链接——只有当 Obsidian 能同时访问两个目录时，这些链接才能正确解析。

**运行 `npx lumina-wiki install` 后的推荐配置：**

1. Obsidian → **Open folder as vault** → 选择项目根目录。
2. **Settings → Files & links → Excluded files** — 添加：
   - `_lumina/`, `.claude/`, `.cursor/`, `.agents/`, `.git/`, `wiki/graph/`
   - 重定向到 README.md 的 Agent 入口 stub 文件：`CLAUDE.md`、`AGENTS.md`、`GEMINI.md`、`QWEN.md` — 它们仅指向 `README.md`，若保留会在图谱视图中产生空节点。保留 `README.md` 本身：它是规范的 Schema 参考文档。
3. **Settings → Files & links**：
   - Use `[[Wikilinks]]`：**开启**
   - New link format：**Shortest path when possible**
   - Default attachment location：`In the folder specified below` → `raw/assets/`
4. **建议开启的核心插件：** Graph view、Backlinks、Outgoing links、Tags、Properties、Outline。
5. *（可选）* 社区插件 **Dataview** — 允许按 frontmatter 字段（如 `type`、`importance`、`confidence`、`date_added`）查询页面。

> `wiki/graph/` 文件夹包含 `edges.jsonl` 和 `citations.jsonl`（机器可读数据文件，非 Markdown）。排除该文件夹可保持图谱视图整洁。

### **使用 qmd 进行本地搜索（可选）**

随着您的 Wiki 不断增长，您可能希望获得比 `index.md` + `grep` 更快的全文搜索体验。我们推荐 [qmd](https://github.com/tobi/qmd) —— 一个完全本地、设备上的 Markdown 搜索引擎，结合 BM25、向量搜索和 LLM 重排序。qmd 与 Lumina-Wiki 和您的 AI Agent 配合得非常顺畅。

**如何与 AI Agent 集成：**

1. 按照 qmd 仓库中的说明安装，然后对项目根目录建立索引，使 qmd 能同时看到 `wiki/` 和 `raw/`。
2. **CLI 方式** — Agent 可以通过 `Bash` 调用 `qmd <query>`。只需在提示中提及该命令已可用。
3. **MCP 方式（在 Claude Code、Codex、Cursor 中很方便）** — 在 IDE 的 MCP 配置中注册 qmd 的 MCP 服务器。Agent 会将其识别为原生工具，可以从 `/lumi-ask` 或后续提问中调用。
4. 在每次 `/lumi-ingest` 后重新索引（手动或通过 hook），让新页面可被搜索到。

qmd 与 `index.md` 和 wiki 图谱并行工作 —— 作为一个快速检索层，在 Agent 完整阅读页面之前为它提供更好的候选结果。

**额外推荐 —— tobi 的官方 qmd skill。** tobi 还发布了一个专用 skill，教您的 Agent 如何高效使用 qmd（何时选择 `lex` vs `vec` vs `hyde`、如何编写 `intent` 进行消歧、lex 短语与排除项语法）。如果您的 IDE 支持 skill 格式，可以通过以下命令安装：

```bash
npx skills add https://github.com/tobi/qmd --skill qmd
```

建议先阅读 [skills.sh 上的 skill 页面](https://skills.sh/tobi/qmd/qmd)，了解它具体添加了什么。

---

## 5. 可用技能与工具 (v0.1)

### 技能 (用户指令)

这些是您在与 AI 聊天时可以使用的指令。

| 包 | 技能 | 用途 |
| :--- | :--- | :--- |
| **Core** | `/lumi-init` | 从 `raw/` 中的所有文件初始化维基。 |
| | `/lumi-ingest` | 将单个新文档处理到维基中。 |
| | `/lumi-ask` | 针对整个知识库提问。 |
| | `/lumi-edit` | 要求手动编辑维基页面。 |
| | `/lumi-check` | 检查维基是否存在错误（死链等）。 |
| | `/lumi-reset` | 安全地重置维基的部分内容。 |
| **Research**| `/lumi-research-discover` | 发现并对相关的研究论文进行排名。 |
| | `/lumi-research-survey` | 从现有知识中创建综述/摘要。 |
| | `/lumi-research-prefill` | 预填基础概念以避免重复。 |
| | `/lumi-research-setup` | 帮助配置研究工具的 API 密钥。 |
| **Reading** | `/lumi-reading-chapter-ingest`| 按章节导入书籍。 |
| | `/lumi-reading-character-track`| 追踪故事中的角色及其关系。 |
| | `/lumi-reading-theme-map` | 识别并绘制叙事中的主题。 |
| | `/lumi-reading-plot-recap` | 提供情节的渐进式回顾。 |

### 工具 (底层引擎)

这些是 Agent 技能用于执行操作的脚本。

| 位置 | 工具 | 角色 |
| :--- | :--- | :--- |
| **`_lumina/scripts/`** | `wiki.mjs` | **核心引擎。** 处理 `wiki/` 中的所有写入/编辑/链接操作。 |
| | `lint.mjs` | `/lumi-check` 用于查找错误的检查器。 |
| | `reset.mjs` | 安全删除内容的脚本。 |
| | `schemas.mjs` | 所有维基结构和规则的单一事实来源。 |
| **`_lumina/tools/`** | `discover.py` | *(Research Pack)* 为 `/lumi-research-discover` 提供支持。 |
| | `fetch_*.py` | *(Research Pack)* 用于从 ArXiv, Wikipedia 等 API 获取数据的一组工具。 |

---

## 6. 未来规划

当前版本为 **v0.2** (预览版)。完整计划位于 [`ROADMAP.md`](./ROADMAP.md)。核心项：

**v1.0.0 — 首个稳定版**
- **每日搜索与获取** — 观察列表查询 (`_lumina/config/watchlist.yml`) 定期运行；新的 arXiv / Semantic Scholar 结果自动进入 `raw/discovered/<date>/`。
- 新的 `/lumi-daily` 技能，用于分类自上次运行以来新增的内容。
- v0.1 版本的稳定性锁定（CLI 标志、退出代码、Schema 字段名）。
- 跨平台 CI 矩阵（macOS + Linux + Windows, Node 20 + 22）。

**v2.0.0 — Research Pack 来源扩展**
- **新论文来源：** OpenAlex, Unpaywall, CORE (优先级 1) → OpenReview, Hugging Face Papers, Papers With Code (优先级 2) → Crossref, DOAJ, 研究博客 RSS (优先级 3)。
- **论文排名：** 新的 `/lumi-rank` 技能，在论文的 frontmatter 中显示影响力引用数、领域标准引用排名、Scite 支持/对比统计以及 Altmetric 关注度。

**想要帮忙吗？** 选择 `ROADMAP.md` 中任何未勾选的项目，开一个 Issue 申领，然后发送 PR。所有来源获取程序在 `src/tools/` 中都遵循相同的模式（CLI + JSON, 无 async, 退出代码 `0/2/3`），非常适合作为首次贡献。请参阅下方的本地开发步骤。

---

## 7. 贡献与许可

### 🛠️ 本地开发 (针对贡献者)

如果您想为 `lumina-wiki` 安装程序本身做出贡献：
```bash
# 1. 克隆并安装依赖
git clone https://github.com/tronghieu/lumina-wiki.git
cd lumina-wiki
npm ci

# 2. 运行测试
npm run test:all
```

## 8. 其他语言

- [English (英文)](README.md)
- [Tiếng Việt (越南语)](README.vi.md)

**许可:** [MIT](LICENSE) © Lưu Trọng Hiếu.
