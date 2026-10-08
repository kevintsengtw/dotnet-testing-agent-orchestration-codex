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

四種工作流程各自擁有一套 1 Orchestrator Skill + 4 Agent TOML，差別在分析粒度、執行模型與技術棧。本版由上游 [`dotnet-testing-agent-orchestration-claude`](https://github.com/kevintsengtw/dotnet-testing-agent-orchestration-claude) 經 migrate-to-codex 轉換，並在 Codex 平台驗證。安裝與使用見 [README.md](README.md) 與 [docs/README.md](docs/README.md)。

## 關鍵目錄

- `.codex/agents/` — 16 個自訂 Subagent 定義檔（`.toml`）：unit 的 4 個 `dotnet-testing-*` + tunit / integration / aspire 各 4 個 `dotnet-testing-advanced-*-*`（analyzer / writer / executor / reviewer）
- `.agents/skills/` — 跨 Agent 共用技術 Skills 的 canonical location
- `.codex/skills/` — 4 個 Orchestrator Skill + `dotnet-test`
- `.agents/skills/unit-test-scenarios/` — consumer setup 從公開 repo `kevintsengtw/unit-test-scenarios` 抓取的可選前置 Skill；本 repo 不內含
- `.codex/config.toml` — Codex workspace 設定（啟用 `multi_agent`、設定 agent thread 上限與 runtime 上限）
- `.codex/scripts/dotnet-testing-codex-full/` — 四套獨立 runtime、用量收集／HTML、NuGet preflight 與 validators，共 59 支零相依 scripts；需 Node.js，依 Full 與各 owner asset manifest 部署。

## Agent 預設模型

`.codex/agents/` 內全部 16 個 agent TOML 都明確指定 `model = "gpt-5.6-sol"` 與 `model_reasoning_effort = "medium"`。因此四種工作流程的 Analyzer、Writer、Executor、Reviewer 預設均使用 GPT-5.6 Sol、medium 推理強度。模型計費比較（GPT-5.4、GPT-5.5、GPT-5.6 Sol／Terra／Luna）見 [docs/guides/model-pricing.md](docs/guides/model-pricing.md)。

> Shared Agent Skills 分別由外部 `dotnet-testing-agent-skills` 與公開 repo `kevintsengtw/unit-test-scenarios` 提供，consumer 必須從鎖定來源安裝到 `.agents/skills/`；不得從 orchestration repository 內含或複製 `unit-test-scenarios`。

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

## 消費端 sample-contamination 不變式

- 四套 Orchestrator `SKILL.md`、Agent TOML、runtime 與 validators 不得包含本 repository 真實 sample 的類別、方法、namespace、專案、solution、路徑、固定目錄結構或依 sample 慣例選路的捷徑。
- 範例只能使用不屬於 `samples/**` 的中性識別字或明確 placeholder；正式選路與執行只能依使用者提供且已驗證的 canonical inputs，不得從 sample 命名、target framework、版本目錄、檔名或 fixture 結構猜測。
- Lab-only tests 與驗證工具可引用 sample 作 deterministic regression；消費端例外必須由維護端精確登記並可失效，TUnit 消費端資產不得有真實 sample 例外。

## 測試專案邊界

`samples/*/tests/` 提供可重複使用的練習專案，執行起點依各套 Orchestrator 契約。工作流程產生的測試檔、fixtures、`.orchestrator/`、`bin/`、`obj/`、`TestResults/` 與 csproj 修改是 byproduct，不得 commit；處理產物前依使用者授權，以 `git status` 核對提交邊界。

Unit 可從既有測試、csproj、bin、obj 與 TestResults 開始，不以殘留產物阻擋正常啟動，也不為取得空白起點刪除既有測試。其他三套的驗證起點依所屬 Orchestrator 契約處理；產物是否保留或清理依使用者授權。

## v1.3.1 用量與環境契約

- 四套各自擁有 `usage-session.mjs`、`usage-report.mjs`、`usage-observer.mjs`，不得跨 workflow import。最終回覆尾端保留 HTML 絕對連結、可複製原生絕對路徑、file URL、收集狀態與說明；不省略既定最終報告欄位。
- 用量取自本次 root turn 與核對後的代理關係。快取另列，推理已含於輸出；缺漏不補零，HTML 不改寫 Executor 測試數字或 run-state 計時。`unsupported` 沒有啟動背景程序，不宣稱重新整理會恢復收集。
- Standard credit 依 HTML 註明日期的固定費率快照換算，支援 `gpt-6.1-sol` 及既有受支援模型；服務模式缺漏時明示試算前提，未知模型、非 Standard 模式或缺漏用量不提供合計。不以其他模型費率代替未知模型，不將試算描述為帳戶實際扣抵。
- 四套在 Analyzer 前各自執行 NuGet sandbox preflight；Aspire 另核對 Docker daemon。`NUGET_PACKAGES` 選用，未指定時沿用原 NuGet 設定與預設快取，不要求使用者手改設定或提供 CLI NuGet override。
- Unit／TUnit 的必要單次核准依本次工具政策與使用者授權處理；保留各自 runner、attempt、原始失敗與重試上限，不自行擴大核准範圍或更改全域設定。
- TUnit 的 methodIdentifier 在 Analyzer 與後續交接欄位保持一致，保留原 selector。正式 profiles 仍為 `gpt-5.6-sol／medium`，HTML 模型換算支援不改變正式流程模型。

更新細節見 [v1.3.1 更新說明](docs/guides/v1.3.1-release-notes.md) 與 [用量指南](docs/guides/token-usage-estimation.md)。

## 與 Claude 版的差異

- **Token 用量** — v1.3.1 不提供估算器。四套皆完成完整離線 HTML、絕對路徑與選用 Standard credit 換算的人工功能驗收；收集逐請求 runtime 觀測值，缺漏保留狀態，不作帳務 truth 或測試 correctness gate。
- **Dispatch 機制**：Codex 原生 SpawnAgent（非 Claude Agent tool）；額外產出 `run-state.json` 可稽核狀態檔。
- **產出非決定性**：同一輸入下，Analyzer scenario 數、測試數、技術型 Skill 選擇與 wall-clock 可能有 run-to-run 波動；Writer topology 固定為每 target 一個，不屬於可波動項目。
