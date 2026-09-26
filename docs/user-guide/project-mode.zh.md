# 项目模式

项目模式是安装 Lumina-Wiki 的另一种方式。它不会从你加入的资料建立新 wiki，而是直接在项目已有的文档上建立一个类型化图。

## 项目模式是什么

项目模式会读取项目已有的文档——决策、需求、规则、流程——并把它们变成一个类型化图：文档、片段和概念，通过 `supersedes`、`governs`、`depends-on` 等类型化关系相连。Lumina 不会写任何 markdown 页面，也不会修改你的文档，除非是你在项目设置时明确批准的 frontmatter 修正。这里没有 `raw/`，也没有 `wiki/`：你的文档留在原处，图在每次读取时都会从它们重新建立。

## 什么时候该用它而不是经典 wiki

如果你在收集和总结外部资料——论文、书籍、文章、研究笔记——请使用经典 wiki（`raw/` + `wiki/`）。

如果项目已经有自己的文档——ADR、规格、需求、流程页面——而你想跨这些文档提问，或找出其中的不一致（一个已被取代的决策仍被引用、一项需求没有任何东西满足、一处失效的交叉引用），却不想再写一份副本，就用项目模式。

## 安装

在项目仓库的根目录下：

```bash
npx lumina-wiki install --mode project
```

回答安装设置的问题，或加上 `--yes` 以非交互方式运行。项目模式可以安装到三个目标中的一个或多个，用 `--ide-targets` 选择：

```bash
npx lumina-wiki install --mode project --yes --ide-targets claude_code,codex
```

- `claude_code` — Claude Code
- `codex` — Codex 及其他兼容 `AGENTS.md` 的 CLI
- `antigravity` — Antigravity

加上 `--yes` 但不指定 `--ide-targets` 时，项目模式只会为 `claude_code` 安装。`--mode project` 不能与 `--packs` 或 `--agents` 同时使用——这两个参数只属于经典模式；一起使用会以错误退出。

## 安装会写入什么

项目模式不会创建 `raw/` 或 `wiki/`。它会写入：

- `_lumina/project/` — 引擎本体（`project.mjs` 及其库文件）。会被提交。
- `_lumina/config/` — 你批准的范围以及类型/关系映射（`project.yaml`），由随后运行的项目设置写入。会被提交。
- `_lumina/facts/` — 每份源文档对应一个 JSON 文件，保存代理从中提取的事实。会被提交——这是你团队花费 token 换来的产出。
- `_lumina/graph/` — 图查看器文件。已加入 gitignore，每次运行 `lumi-project-view` 都会重新建立。
- `_lumina/_state/` — 引擎的写锁。已加入 gitignore。
- `_lumina/manifest.json` — 本地安装记录。已加入 gitignore。
- `.agents/skills/lumi-project-*` — 下面六个技能，写入每个被选中的目标。
- `.claude/skills/lumi-project-*` — 指向同一批技能的符号链接，仅当 `claude_code` 是被选中的目标之一时才会写入。
- `CLAUDE.md`（针对 `claude_code`）和/或 `AGENTS.md`（针对 `codex` 或 `antigravity`）中 `<!-- lumina:project -->` 标记之间的一小段内容，指向 `_lumina/project/PROJECT.md`。
- `.gitignore` 中 `# >>> lumina` 标记之间的一小段内容，覆盖上面三个已加入 gitignore 的路径。

## 六个技能

具体怎样调用一个技能取决于你使用的 AI 应用（例如 Claude Code 中的斜杠命令、Codex 中的 `$name`）——请参照你所用应用自己的约定。按工作流顺序：

- **lumi-project-setup** — 扫描范围内的文档，提出范围、类型/关系映射和概念词表；在你批准之前不会写入任何内容。例如："为这个仓库设置项目模式。"
- **lumi-project-ingest** — 按文档提交关系和片段状态，这些内容来自解析器看不到的文字，默认只处理 `changed`/`stale` 的文档。例如："处理我刚编辑的 docs/adr/ 下的文档。"
- **lumi-project-ask** — 从图中回答一个项目问题，在问题需要正文内容时读取图所引用的文档文字，图中没有匹配时回退到文档搜索。例如："ADR-0052 对成本手册做了什么决定？"
- **lumi-project-check** — 运行图的 lint 检查，按规则 id 报告发现的问题，并为每个问题给出可能的修复方法。例如："检查项目文档图有没有问题。"
- **lumi-project-verify** — 对每条已提交事实的证据做项目范围的检查，报告哪些已经和文档对不上，或其源文档已经不存在。例如："检查有没有已提交的事实过时或失效。"
- **lumi-project-view** — 打开一个可浏览、可筛选的图视图。例如："给我看看项目图。"

## 让它保持最新

没有钩子，文件保存时也不会自动运行任何东西。每次读取都会实时解析你的文档，所以图的结构始终是最新的；只有 `_lumina/facts/` 中代理提取的事实可能过时，因为它们是在某个特定时间点提交的。

每份文档都有四种状态之一，由 `node _lumina/project/project.mjs status` 报告：

- `fresh` — 提交的事实仍然和当前文本一致。
- `changed` — 文档在其事实被提交之后又发生了变化。
- `stale` — 已提交的事实站不住脚了：引用的句子消失了、某处引用无法解析、该文档处理之后配置或本体发生了变化，或者事实文件本身已损坏。
- `never-ingested` — 这份文档还没有提交过任何事实。

修改一份已经处理过的文档会让它变成 `changed`，下一次默认的 `lumi-project-ingest` 运行会自动处理它。新加入的文档一开始是 `never-ingested`，默认运行会跳过它——按名字指定该文档，或说 "ingest all"（意为"全部处理"），才会把它包含进来；报告中始终会说明还剩多少 never-ingested 的文档。

`lumi-project-ask` 的每个回答结尾也会附带一条最新度说明，但它是针对整个项目的，而不是按文档：有多少文档处于 stale、changed 和 never ingested 状态的计数，加上按路径列出的 stale 文档——而不是 `status` 按文档报告的 fresh/changed/stale/never-ingested 状态。

## 常见问题处理

- **孤立的事实文件。** `lumi-project-check` 或 `lumi-project-verify` 报告某个事实文件的源文档已被删除。两个技能都会先运行 `node _lumina/project/project.mjs facts-prune --dry-run`，把 `removed`/`kept` 列表展示给你；只有在你批准之后，它们才会运行 `node _lumina/project/project.mjs facts-prune`，精确删除那份已批准的列表——之后请提交这次删除。`facts-prune` 只会删除那些确实已从磁盘上消失的文档对应的事实：一份仍在磁盘上但被排除在范围之外的文档会保留其事实（`kept: out-of-scope`），一份改了名字的文档在其新路径被重新处理之前也会保留（`kept: rename-candidate`——先处理新路径，之后清理才会删除旧文件）。
- **过时的文档。** 它已提交的事实和当前文本已经对不上了。对该文档运行 `lumi-project-ingest`。
- **`config-check` 报错。** `_lumina/config/project.yaml` 无效。修复报告的问题后重新运行 `lumi-project-setup`，或者直接再运行一次 `node _lumina/project/project.mjs config-check` 来确认。
- **模式冲突。** `--mode project cannot be combined with --packs, --agents, or a profile` 表示你把一个只属于经典模式的参数和 `--mode project` 一起使用了。去掉那个参数；如果你本来就是想用经典 wiki，就去掉 `--mode project`。

## 卸载

```bash
npx lumina-wiki uninstall
```

这会移除引擎、六个技能，以及 `CLAUDE.md`、`AGENTS.md` 和 `.gitignore` 中的标记内容块。`_lumina/facts/` 和 `_lumina/config/` 会分开处理：`uninstall --yes` 始终会保留它们；不加 `--yes` 运行时会先询问，只有在你确认后才会删除。
