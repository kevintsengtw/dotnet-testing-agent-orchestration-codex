# AGENTS.md

## 專案概述

dotnet-testing Agent Orchestration for Codex。提供 **Codex 原生 Subagent** 的 .NET 測試工作流程，透過 Agent Orchestration 自動化完成測試。

採 **1 + 4 模型**：1 個 Orchestrator Skill 指揮 4 個專用 Subagent，依序完成 Analyzer → Writer → Executor → Reviewer。目前涵蓋 4 種工作流程：

| 測試類型 | Orchestrator Skill |
| --- | --- |
| Unit | `dotnet-testing-orchestrator-unit` |
| TUnit | `dotnet-testing-orchestrator-tunit` |
| Integration | `dotnet-testing-orchestrator-integration` |
| Aspire | `dotnet-testing-orchestrator-aspire` |

四種工作流程共用同一個 1 + 4 模型，差別在執行模型、測試粒度與技術棧。本版由上游 [`dotnet-testing-agent-orchestration-claude`](https://github.com/kevintsengtw/dotnet-testing-agent-orchestration-claude) 經 migrate-to-codex 轉換，並在 Codex 平台多輪實驗優化驗證而成。安裝與使用見 [README.md](README.md) 與 [docs/README.md](docs/README.md)。

## 關鍵目錄

- `.codex/agents/` — 16 個自訂 Subagent 定義檔（`.toml`）：unit 的 4 個 `dotnet-testing-*` + tunit / integration / aspire 各 4 個 `dotnet-testing-advanced-*-*`（analyzer / writer / executor / reviewer）
- `.codex/skills/` — 4 個 Orchestrator Skill（`dotnet-testing-orchestrator-{unit,tunit,integration,aspire}`）+ 測試執行器 Skill（`dotnet-test`）
- `.codex/config.toml` — Codex workspace 設定（啟用 `multi_agent`、設定 agent thread 上限與 runtime 上限）
- `.codex/scripts/` — Estimated Token Usage 估算器（零相依、自含；需 Node.js）

> 技術型 Agent Skills（`dotnet-testing-*`）由外部 repo [`dotnet-testing-agent-skills`](https://github.com/kevintsengtw/dotnet-testing-agent-skills) 提供，需另行安裝（直接複製到 `.codex/skills/`）。

## Dispatch 機制

Orchestrator Skill 載入主對話後，透過 Codex 原生 **SpawnAgent** 依序調度 4 個 Subagent。
工作流程額外產出 `run-state.json`（可稽核的狀態檔），記錄各階段 wall-clock 時間與結果，為官方階段耗時與整體耗時的唯一真實來源。

## 與 Claude 版的差異

- **Token 用量：估算版（非 billing）** — Codex native SpawnAgent subagent 的全流程**真實** token 無可靠 truth source（實證確認），故不回報正式用量。改提供 optional **`Estimated Token Usage`**：四階段完成後可執行 `node .codex/scripts/estimate-token-usage.mjs --test-project <測試專案>`，以**零相依的內建 `chars-heuristic`** 對各 subagent 的 visible context 做估算，**僅供相對成本比較，明確排除 hidden framing / internal reasoning / cached input / provider billing，不可用於計費或任何 correctness gate**；estimator 缺檔/失敗時優雅降級為 unavailable，不阻塞工作流程。細節見 [docs/guides/token-usage-estimation.md](docs/guides/token-usage-estimation.md)。
- **Dispatch 機制**：Codex 原生 SpawnAgent（非 Claude Agent tool）；額外產出 `run-state.json` 可稽核狀態檔。
- **產出非決定性**：同一輸入下，測試數 / 分割分組 / skill 選擇有 run-to-run 波動，屬 Codex 多 subagent dispatch 的已知限制。
