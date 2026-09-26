# 在你项目的文档上使用项目模式

项目模式会在你项目已有的文档——决策、需求、规则、流程——之上建立一个类型化图，而不是建立新的 wiki。
Lumina 不会写任何 markdown 页面，也不会修改你的文档，除了你在设置时批准的两件事：frontmatter 修正，以及一个术语表文件。
这里没有 `raw/`，也没有 `wiki/`：你的文档留在原处，图会在每次读取时从它们重新建立。

如果你在收集外部资料——论文、书籍、文章、研究笔记——请使用经典 wiki。
如果项目已经有自己的文档，就用项目模式。
之后你可以跨这些文档提问，或找出其中的不一致，而不必再写一份副本。

## 安装

在项目仓库的根目录下：

```bash
npx lumina-wiki install --mode project
```

回答安装提示，或加上 `--yes` 以非交互方式运行。项目模式可以安装到三个目标中的一个或多个，用 `--ide-targets` 选择：

```bash
npx lumina-wiki install --mode project --yes --ide-targets claude_code,codex
```

- `claude_code` — Claude Code
- `codex` — Codex 及其他兼容 `AGENTS.md` 的 CLI
- `antigravity` — Antigravity

加上 `--yes` 但不指定 `--ide-targets` 时，项目模式只会为 `claude_code` 安装。`--mode project` 不能与 `--packs`、`--agents` 或某个 profile 一起使用——这些都是只属于经典模式的参数，一起使用会以错误退出。

## 项目设置

接下来运行 `lumi-project-setup`。它会扫描范围内的文档，提出一个范围、一份类型/关系映射和一份概念词表。在你批准之前，它不会写入任何内容。

批准之后，它会报告范围内的文档数量，并主动询问是否立即处理文档。回答"是"，就会以首次运行的方式启动 `lumi-project-ingest`，把所有文档都处理掉，不需要再输入第二个命令，也不需要再批准一次。回答"否"，设置就到此结束，之后你可以自己运行 `lumi-project-ingest`。

确认设置是否生效：

```bash
node _lumina/project/project.mjs status
```

刚设置完、还没有处理任何文档时，输出大致如下（有删减）：

```json
{
  "docs": [
    { "path": "docs/adr/0001-use-postgres.md", "hash": "b00b80fe0172...", "state": "never-ingested" },
    { "path": "docs/adr/0002-cache-layer.md", "hash": "629cdbcc2c71...", "state": "never-ingested" }
  ],
  "summary": { "fresh": 0, "changed": 0, "stale": 0, "neverIngested": 2 }
}
```

每份文档都会带有一个状态。刚设置完时，每份文档都是 `never-ingested`，这是正常的——还没有任何内容被读入图中。每份文档还带有 `metaType`（没有更具体的类型时为 `Document`），匹配到类型规则后还会带有 `type`。

## 处理文档并提问

运行 `lumi-project-ingest`，把你的文档读入图中。首次运行时，因为还没有处理过任何文档，它会提供全部文档；超过 20 份文档时，它会显示数量并等待你批准后再继续。

候选文档超过 20 份、且所在的编码助手支持子代理时（Claude Code 支持），处理会并行进行：文档按类型分组，拆成最多 8 个批次，一次批准就覆盖整个计划；某个批次失败不会中断其他批次，遗漏的文档会自动重试一次。不支持子代理的助手仍会像以前一样逐份处理。这个过程是安全的：每份文档的事实会写入各自独立的文件并加锁保护，而图在每次读取时都会从文档和事实重新建立，写入顺序不会改变结果。

处理结束时会重新生成图视图（`_lumina/graph/view.html`）并打印它的 `file://` 链接；你也可以随时运行 `lumi-project-view` 重新生成它。

之后，提出一个问题：

> "ADR-0001 对数据存储做了什么决定？"

`lumi-project-ask` 会根据图和它引用的文档文字来回答，每条结论都指向 `file:line`。
每个回答结尾都会附带一条最新度说明：整个项目范围内有多少文档处于 stale、changed 或 never ingested 状态，并按路径列出 stale 的文档。

## 让它保持最新

没有钩子，保存文件也不会自动触发任何操作。修改一份已经处理过的文档，它会变成 `changed`；下一次默认的 `lumi-project-ingest` 运行会自动处理它。

新加入的文档一开始是 `never-ingested`。默认运行会跳过它——按名字指定该文档，或说 "ingest all"，才会把它包含进来。报告中始终会说明还剩多少 `never-ingested` 的文档。

## 常见问题处理

### 孤立的事实文件

`lumi-project-check` 或 `lumi-project-verify` 报告某个事实文件的源文档已被删除。

1. 运行 `node _lumina/project/project.mjs facts-prune --dry-run`。
2. 查看它给出的 `removed` 和 `kept` 列表。`out-of-scope` 表示文档仍然存在，但已经不在范围内。`rename-candidate` 表示文档已经改名或移动，还没有在新路径重新处理过。
3. 批准删除。
4. 用批准的路径运行 `node _lumina/project/project.mjs facts-prune`。
5. 提交这次删除。

对于改名的候选文档，先处理新路径——只有新文档有了自己提交的事实之后，清理旧文件才会生效。

### 过时的文档

它已提交的事实和当前文本已经对不上了。对该文档运行 `lumi-project-ingest`。

### `config-check` 报错

`_lumina/config/project.yaml` 无效。运行 `node _lumina/project/project.mjs config-check` 查看具体问题。你可以自己修复该文件，也可以重新运行 `lumi-project-setup` 来代为修复。然后再次运行 `config-check` 确认。

### 模式冲突

`Project mode (detected or --mode project) cannot be combined with --packs, --agents, or a profile` 表示你把一个只属于经典模式的参数和 `--mode project` 一起使用了，或者用在了已经设置为项目模式的仓库里。去掉那个参数；如果你本来就是想用经典 wiki，就去掉 `--mode project`。

## 卸载

```bash
npx lumina-wiki uninstall
```

这会移除 `_lumina/` 下除 `_lumina/facts/` 和 `_lumina/config/` 之外的所有内容，加上六个技能、`.claude/skills` 中的链接，以及 `CLAUDE.md`、`AGENTS.md` 和 `.gitignore` 中的标记内容块。`_lumina/facts/` 和 `_lumina/config/` 会分开处理：`uninstall --yes` 始终会保留它们；不加 `--yes` 运行时会先询问，只有在你确认后才会删除。

## 参考

### 安装会写入什么

项目模式不会创建 `raw/` 或 `wiki/`。它会写入：

- `_lumina/project/` — 引擎本体（`project.mjs` 及其库文件）。会被提交。
- `_lumina/config/` — 你批准的范围以及类型/关系映射（`project.yaml`），由随后运行的设置写入。会被提交。
- `_lumina/facts/` — 每份源文档对应一个文件，保存代理从中提取的事实。会被提交。
- `_lumina/graph/` — 图查看器文件。已加入 gitignore，每次处理文档或运行 `lumi-project-view` 都会重新建立。
- `_lumina/_state/` — 引擎的写锁。已加入 gitignore。
- `_lumina/manifest.json` — 本地安装记录。已加入 gitignore。
- `.agents/skills/lumi-project-*` — 下面六个技能，写入每个被选中的目标。
- `.claude/skills/lumi-project-*` — 指向同一批技能的符号链接，仅当 `claude_code` 是被选中的目标之一时才会写入。
- `CLAUDE.md`（针对 `claude_code`）和/或 `AGENTS.md`（针对 `codex` 或 `antigravity`）中 `<!-- lumina:project -->` 标记之间的一小段内容，指向 `_lumina/project/PROJECT.md`。
- `.gitignore` 中 `# >>> lumina` 标记之间的一小段内容，覆盖上面三个已加入 gitignore 的路径。

### 技能

具体怎样调用一个技能取决于你使用的 AI 应用（例如 Claude Code 中的斜杠命令、Codex 中的 `$name`）——请参照你所用应用自己的约定。

- **lumi-project-setup** — 扫描范围内的文档，提出范围、类型/关系映射和概念词表；在你批准之前不会写入任何内容。例如："为这个仓库设置项目模式。"
- **lumi-project-ingest** — 读取文档结构之外的内容——它们之间如何关联，以及某个片段声明了什么状态——并按文档提交，默认处理已更改或已过时的文档。例如："处理我刚编辑的 docs/adr/ 下的文档。"
- **lumi-project-ask** — 从图和它引用的文档文字中回答一个项目问题，图中没有匹配时回退到文档搜索。例如："ADR-0052 对成本手册做了什么决定？"
- **lumi-project-check** — 运行图的 lint 检查，按规则 id 报告发现的问题，并为每个问题给出可能的修复方法。例如："检查项目文档图有没有问题。"
- **lumi-project-verify** — 检查每条已提交事实的证据，报告哪些已经和文档对不上，或其源文档已经不存在。例如："检查有没有已提交的事实过时或失效。"
- **lumi-project-view** — 打开一个可浏览、可筛选的图视图。例如："给我看看项目图。"

### 文档状态

- `fresh` — 提交的事实仍然和当前文本一致。
- `changed` — 文档在其事实被提交之后又发生了变化。
- `stale` — 已提交的事实站不住脚了：引用的句子消失了、某处引用无法解析、该文档处理之后配置或本体发生了变化，或者事实文件本身已损坏。
- `never-ingested` — 这份文档还没有提交过任何事实。
