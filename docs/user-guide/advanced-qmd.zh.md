# 📚 高级指南：使用 QMD 加速 AI 查询

**QMD (Query Markup Documents)** 是一款本地搜索工具，可帮助 AI 加速在 Wiki 中检索信息的速度。AI 不再需要按顺序读取文件，而是利用 QMD 创建的索引来快速定位最相关的文本段落。

该工具结合了**关键词搜索** (BM25) 和**语义搜索** (Vector)，能够提供精准的结果，使 `/lumi-ask` 等命令在大型知识库上运行更加高效。

---

## 1. 为什么需要 QMD？

*   **性能**：通过使用预建索引来节省时间，避免 AI 手动扫描整个文件内容。
*   **智能搜索**：支持语义搜索，即使不包含您提供的精确关键词，也能找到相关内容。
*   **安全**：整个索引和搜索过程 100% 在您的本地计算机上运行。

---

## 2. 安装步骤

### 第 1 步：安装 QMD 工具

请根据您的操作系统执行以下说明：

#### **在 macOS 上**
虽然 Mac 预装了 SQLite，但系统版本不支持 QMD 所需的向量搜索功能。因此，您需要通过 Homebrew 安装更完整的版本：
1.  打开**终端 (Terminal)**。
2.  安装 SQLite 和 QMD：
    ```bash
    brew install sqlite
    npm install -g @tobilu/qmd
    ```

#### **在 Windows 上**
1.  以管理员身份打开 **PowerShell** 或**命令提示符 (Command Prompt)**。
2.  安装 QMD：
    ```bash
    npm install -g @tobilu/qmd
    ```
    *注意：请确保在 Windows 设置中启用了**开发者模式**，以支持文件符号链接。*

---

### 第 2 步：为 AI 安装 Skill

为了让您的 AI 知道如何使用 QMD，您需要通过聊天界面（Gemini CLI、Claude Code 等）执行以下命令来安装相应的 Skill：

```bash
npx skills add https://github.com/tobi/qmd --skill qmd
```

---

## 3. Wiki 的初始配置

安装完成后，您需要让 QMD 为您的知识库建立索引。

**提示：您可以直接在聊天中粘贴以下内容，让 AI 为您完成此操作：**
> "请帮我设置 QMD：将 wiki 文件夹添加到 'my-wiki' 集合中并运行 embed 命令。"

如果您想手动操作：
1.  在 Lumina-Wiki 项目的根目录下打开终端。
2.  将 `wiki/` 文件夹添加到 QMD 的管理列表：
    ```bash
    qmd collection add wiki --name my-wiki
    ```
3.  开始索引过程 (Embedding)：
    ```bash
    qmd embed
    ```
    *   **注意**：首次运行时，QMD 会下载必要的 AI 模型（约 2GB）。随后，它将读取 `wiki/` 中的所有内容以构建索引。此过程可能需要几分钟。

---

## 4. 如何使用

### 通过 AI 使用（自动）
安装 Skill 后，每当您使用 `/lumi-ask` 或其他查询命令时，AI 都会自动优先使用 QMD，以获得更快、更准确的结果。

### 手动使用（命令行）
如果您想自己进行快速搜索，可以使用以下命令：
*   `qmd search "关键词"`：搜索精确关键词。
*   `qmd vsearch "要查找的内容"`：按含义搜索。

---

## 5. 针对非 GPU 系统（仅限 CPU）的说明

QMD 经过优化，可在 CPU 上良好运行：
*   **自动检测**：QMD 将自动检测您的机器配置，如果没有找到合适的 GPU，将使用 CPU。
*   **更新索引**：每当您的 wiki 有新内容时（运行 `/lumi-ingest` 后），您应该运行以下命令来更新索引：
    ```bash
    qmd update && qmd embed
    ```

---
*希望本指南能帮助您优化 Lumina-Wiki 的使用体验。如果遇到问题，请随时向 AI 寻求帮助，或查看 [QMD 官方文档](https://github.com/tobi/qmd)。*
