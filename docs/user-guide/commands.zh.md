# Lumina-Wiki 命令参考

当你已经知道自己想做什么时，用本页查找命令。下列命令按提供它们的功能组分类。你的 wiki 一定包含 Core 命令；其他组只会在安装时选择了相应功能包后出现。要查看你的 wiki 目前实际可用的命令，请运行 `/lumi-help skills` 或 `$lumi-help skills`。

下面的例子使用 `/`。在 Codex 中，把第一个 `/` 换成 `$`。

## Core 命令

| 命令 | 适用情况 | 示例 | 你会得到 |
| --- | --- | --- | --- |
| `/lumi-init` | 准备新的或空的 wiki | `/lumi-init` | 为第一份资料准备好的位置。可以安全地再次运行。 |
| `/lumi-ingest` | 把文档、链接或论文加入 wiki | `/lumi-ingest raw/sources/article.pdf` | 资料笔记、相互关联的重要想法笔记和更新后的目录。 |
| `/lumi-ask` | 询问 wiki 对某个问题的看法 | `/lumi-ask 这些资料在哪些方面一致？` | 指向所用笔记和资料的回答。 |
| `/lumi-edit` | 修改一页已有的 wiki 页面 | `/lumi-edit wiki/sources/article.md` | 你要求的修改，同时保持相关笔记的连接。 |
| `/lumi-check` | 查看 wiki 是否有需要注意的地方 | `/lumi-check` | 清楚的问题清单——大部分已自动修复——以及对仍需你判断的事项的建议。 |
| `/lumi-reset` | 对你选定的内容重新开始 | `/lumi-reset` | 先给出计划；只有你确认后才会改变内容。 |
| `/lumi-verify` | 将笔记与它们提到的资料进行核对 | `/lumi-verify article` | 需要你查看的结果；它不会自行改动笔记。 |
| `/lumi-migrate-legacy` | 在升级 Lumina-Wiki 后更新旧笔记 | `/lumi-migrate-legacy --backfill-ids` | 帮助为旧页面补充缺少的信息，尤其是自动检查无法安全自行填写的部分。 |
| `/lumi-help` | 寻找下一步或询问功能如何使用 | `/lumi-help` | 一个建议的下一步。用 `skills` 查看已安装命令，用 `explain <问题>` 询问 Lumina-Wiki。 |

当你没有本地文件时，`/lumi-ingest` 也接受论文标题、arXiv 编号或网页链接。只有你明确要求时，`/lumi-ask` 才会保存回答。

## Research 命令

这些命令需要 Research 功能包。

| 命令 | 适用情况 | 示例 | 你会得到 |
| --- | --- | --- | --- |
| `/lumi-research-setup` | 准备可选的研究工具 | `/lumi-research-setup` | 检查已准备好的部分，并指导你设置想使用的服务。 |
| `/lumi-research-prefill` | 在收集资料前加入稳定的背景想法 | `/lumi-research-prefill` | 可重复使用的背景笔记，减少重复解释。 |
| `/lumi-research-discover` | 为一个主题寻找候选资料 | `/lumi-research-discover` | 供你选择的短名单；未经你的选择不会加入资料。 |
| `/lumi-research-watchlist` | 选择想持续关注的主题 | `/lumi-research-watchlist` | 更新后的主题和资料源清单，供以后查看。 |
| `/lumi-research-watch-run` | 立即查看正在关注的主题 | `/lumi-research-watch-run` | 关于新候选资料的易读报告。 |
| `/lumi-research-survey` | 把已有笔记整理成文献式综述 | `/lumi-research-survey` | 有关联的综述，只有你要求时才保存。 |
| `/lumi-research-topic` | 围绕一个主题归类已有笔记 | `/lumi-research-topic` | 让相关资料和想法更容易找到的主题页面。 |
| `/lumi-research-rank` | 判断已加入的论文下一篇该读哪篇 | `/lumi-research-rank source-name` | 记录在该资料页面上的阅读优先级评估。 |

## Reading 命令

这些命令需要 Reading 功能包。

| 命令 | 适用情况 | 示例 | 你会得到 |
| --- | --- | --- | --- |
| `/lumi-reading-chapter-ingest` | 加入一本书的一个章节 | `/lumi-reading-chapter-ingest chapter-3` | 章节笔记，以及其中出现的人物、主题和事件。 |
| `/lumi-reading-character-track` | 更新 wiki 对人物的记录 | `/lumi-reading-character-track` | 更新后的人物页面和关系。 |
| `/lumi-reading-theme-map` | 查看跨多个章节的主题 | `/lumi-reading-theme-map` | 连接相关章节和人物的主题页面。 |
| `/lumi-reading-plot-recap` | 在不读到后面内容的情况下回顾情节 | `/lumi-reading-plot-recap book-name:chapter-4` | 在你指定章节之前停止的回顾。 |

## Learning 命令

这个命令需要 Learning 功能包。

| 命令 | 适用情况 | 示例 | 你会得到 |
| --- | --- | --- | --- |
| `/lumi-learning-reflect` | 记录并重新审视你自己的理解 | `/lumi-learning-reflect spaced-repetition` | 用你自己的话进行引导式反思，并可回看理解如何变化。 |

## 相关页面

- [从第一份资料开始](zh.md)。
- [按照实用的研究流程进行](research.zh.md)。
