# 📚 Advanced Guide: Accelerate AI Queries with QMD

**QMD (Query Markup Documents)** is a local search tool that helps AI speed up information retrieval within your Wiki. Instead of reading through files sequentially, the AI uses an index created by QMD to quickly identify the most relevant text segments.

This tool combines **keyword search** (BM25) and **semantic search** (Vector) to provide accurate results, making commands like `/lumi-ask` more effective on large knowledge bases.

---

## 1. Why do you need QMD?

*   **Performance**: Save time by using a pre-built index instead of having the AI manually scan through entire file contents.
*   **Intelligent Search**: Supports semantic search, helping find relevant content even if it doesn't contain the exact keywords you provided.
*   **Security**: The entire indexing and search process runs 100% locally on your machine.

---

## 2. Installation Steps

### Step 1: Install the QMD Tool

Follow the instructions for your operating system:

#### **On macOS**
While Macs come with SQLite pre-installed, the system version does not support the Vector search features QMD requires. Therefore, you need to install a more complete version via Homebrew:
1.  Open your **Terminal**.
2.  Install SQLite & QMD:
    ```bash
    brew install sqlite
    npm install -g @tobilu/qmd
    ```

#### **On Windows**
1.  Open **PowerShell** or **Command Prompt** (as Administrator).
2.  Install QMD:
    ```bash
    npm install -g @tobilu/qmd
    ```
    *Note: Ensure **Developer Mode** is enabled in Windows settings to support file symlinking.*

---

### Step 2: Install the AI Skill

To let your AI know how to use QMD, you need to install the corresponding skill via your chat interface (Gemini CLI, Claude Code, etc.):

```bash
npx skills add https://github.com/tobi/qmd --skill qmd
```

---

## 3. Initial Configuration for Your Wiki

After installation, you need to let QMD index your knowledge base.

**Tip: You can ask the AI to do this for you by pasting the following into the chat:**
> "Help me set up QMD: add the wiki folder to the 'my-wiki' collection and run the embed command."

If you want to do it manually:
1.  Open your Terminal in the root directory of your Lumina-Wiki project.
2.  Add the `wiki/` folder to QMD's management list:
    ```bash
    qmd collection add wiki --name my-wiki
    ```
3.  Start the indexing process (Embedding):
    ```bash
    qmd embed
    ```
    *   **Note:** On the first run, QMD will download the necessary AI models (about 2GB). It will then read all content in `wiki/` to build the index. This process may take a few minutes.

---

## 4. How to Use

### Using via AI (Automatic)
Once the Skill is installed, every time you use `/lumi-ask` or other query commands, the AI will automatically prioritize using QMD for faster and more accurate results.

### Manual Use (Command Line)
If you want to perform quick searches yourself, you can use these commands:
*   `qmd search "keywords"`: Search for exact keywords.
*   `qmd vsearch "content you're looking for"`: Search by meaning.

---

## 5. Notes for Non-GPU Systems (CPU-only)

QMD is optimized to run well on CPUs:
*   **Automatic Detection**: QMD will detect your machine's configuration and use the CPU if no suitable GPU is found.
*   **Updating the Index**: Whenever your wiki has new content (after running `/lumi-ingest`), you should run the following command to update the index:
    ```bash
    qmd update && qmd embed
    ```

---
*I hope this guide helps you optimize your Lumina-Wiki experience. If you run into issues, don't hesitate to ask the AI for help or check the [official QMD documentation](https://github.com/tobi/qmd).*
