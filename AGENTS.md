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
- `.agents/skills/` — 跨 Agent 共用技術 Skills 的 canonical location
- `.codex/skills/` — 4 個 Orchestrator Skill + `dotnet-test`
- `.agents/skills/unit-test-scenarios/` — consumer setup 從公開 repo `kevintsengtw/unit-test-scenarios` 抓取的可選前置 Skill；本 repo 不內含
- `.codex/config.toml` — Codex workspace 設定（啟用 `multi_agent`、設定 agent thread 上限與 runtime 上限）
- `.codex/scripts/` — `run-state`、Estimated Token Usage 與四工作流程 runtime validators（零相依、自含；需 Node.js）

## Agent 預設模型

`.codex/agents/` 內全部 16 個 agent TOML 都明確指定 `model = "gpt-5.6-sol"` 與 `reasoning_effort = "medium"`。因此四種工作流程的 Analyzer、Writer、Executor、Reviewer 預設均使用 GPT-5.6 Sol、medium 推理強度。模型計費比較（GPT-5.4、GPT-5.5、GPT-5.6 Sol／Terra／Luna）見 [docs/guides/model-pricing.md](docs/guides/model-pricing.md)。

> Shared Agent Skills 分別由外部 `dotnet-testing-agent-skills` 與公開 repo `kevintsengtw/unit-test-scenarios` 提供，由 VS Code Extension 的 consumer deployment 抓取後安裝到 `.agents/skills/`；不得從 orchestration repository 內含或複製 `unit-test-scenarios`。

Unit workflow 接受使用者以任意格式提供測試情境與資料。合理的使用者內容必須優先使用，只能逐項排除不合理或不正確的情境；未提供時可先呼叫 `$unit-test-scenarios` 產生情境。

## Dispatch 機制

Orchestrator Skill 載入主對話後，透過 Codex 原生 **SpawnAgent** 依序調度 4 個 Subagent。
工作流程額外產出 `run-state.json`（可稽核的狀態檔），記錄各階段 wall-clock 時間與結果，為官方階段耗時與整體耗時的唯一真實來源。

正式執行契約：

- 四角色使用 fresh/self-contained context，不讀 prior-attempt artifacts、workspace 外部 memory 或未核准 handoffs。
- 每個 target 固定一個 Writer，不依 method、scenario、endpoint、Resource 或輸出大小 split。
- Analyzer scenario 數不設上限；唯一 Writer 必須完整承接。遇到 context/output limit 時 fail closed，不恢復 split、不刪減案例。
- Executor artifact 是 build/test runtime truth；Reviewer 審查品質與跨 artifact 一致性，不自行重跑測試覆蓋 Executor evidence。
- 正式流程不使用 RAG；canonical artifacts、isolation、read scope、scenario/endpoint acceptance、strict timing 與 production mutation 都是正式 gates。

## 測試專案邊界

`samples/*/tests/` 是可重複使用的空白起點。工作流程產生的測試檔、fixtures、`.orchestrator/`、`bin/`、`obj/`、`TestResults/` 與 csproj 修改是 byproduct，不得 commit。驗證完成後應還原，再以 `git status` 確認乾淨。

## 與 Claude 版的差異

- **Token 用量：估算版（非 billing）** — Codex native SpawnAgent subagent 的全流程**真實** token 無可靠 truth source（實證確認），故不回報正式用量。改提供 optional **`Estimated Token Usage`**：四階段完成後可執行 `node .codex/scripts/estimate-token-usage.mjs --test-project <測試專案>`，以**零相依的內建 `chars-heuristic`** 對各 subagent 的 visible context 做估算，**僅供相對成本比較，明確排除 hidden framing / internal reasoning / cached input / provider billing，不可用於計費或任何 correctness gate**；estimator 缺檔/失敗時優雅降級為 unavailable，不阻塞工作流程。細節見 [docs/guides/token-usage-estimation.md](docs/guides/token-usage-estimation.md)。
- **Dispatch 機制**：Codex 原生 SpawnAgent（非 Claude Agent tool）；額外產出 `run-state.json` 可稽核狀態檔。
- **產出非決定性**：同一輸入下，Analyzer scenario 數、測試數、技術型 Skill 選擇與 wall-clock 可能有 run-to-run 波動；Writer topology 固定為每 target 一個，不屬於可波動項目。
