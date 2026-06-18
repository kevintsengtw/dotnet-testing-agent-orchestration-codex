# dotnet-testing Agent Orchestration for Codex

這個 repo 提供 **Codex 原生 Subagent** 的 .NET 測試工作流程，透過 Agent Orchestration 自動化完成測試。
核心採 **1 + 4 模型**：1 個 Orchestrator Skill 指揮 4 個專用 Subagent，依序完成 Analyzer → Writer → Executor → Reviewer。

> 本版由 [`dotnet-testing-agent-orchestration-claude`](https://github.com/kevintsengtw/dotnet-testing-agent-orchestration-claude) 經 migrate-to-codex 轉換並在 Codex 平台優化驗證而成。

## 目前涵蓋範圍

| 測試類型 | Orchestrator Skill | 狀態 |
|---|---|---|
| Unit Testing | `dotnet-testing-orchestrator-unit` | ✅ 已釋出 |
| Integration / Aspire / TUnit | — | 🚧 後續釋出 |

## 架構概覽

```text
Orchestrator Skill（dotnet-testing-orchestrator-unit）
    ├── Analyzer Subagent  （分析目標類別、依賴項、測試技術）
    ├── Writer Subagent    （載入 Skills，產生測試程式碼）
    ├── Executor Subagent  （建置並執行測試，處理修正迴圈）
    └── Reviewer Subagent  （審查命名、斷言、覆蓋率、合規性）
```

各階段依序完成；Reviewer 提出建議後，使用者確認才會啟動 Writer + Executor 修改流程。
透過 Codex 原生 **SpawnAgent** dispatch 四個 subagent。

## 內容

```text
.codex/
├── agents/
│   ├── dotnet-testing-analyzer.toml
│   ├── dotnet-testing-writer.toml
│   ├── dotnet-testing-executor.toml
│   └── dotnet-testing-reviewer.toml
├── config.toml
└── skills/
    ├── dotnet-test/
    └── dotnet-testing-orchestrator-unit/
```

> `dotnet-testing-*` 基礎技能系列（unit-test-fundamentals、nsubstitute-mocking 等）不隨此 repo 發佈，請另行安裝。

## 安裝

1. 將 `.codex/agents/`、`.codex/config.toml`、`.codex/skills/` 放入你的 Codex workspace。
2. 安裝 `dotnet-testing-*` 基礎技能系列。
3. 呼叫 `$dotnet-testing-orchestrator-unit`，給定被測試類別即可。

## 使用範例

```text
呼叫 $dotnet-testing-orchestrator-unit，為 src/MyProject.Core 的 OrderService 撰寫單元測試。
```

## 與 Claude 版差異

- **Token 用量統計：未提供**（Codex native subagent token 無可靠 truth source，de-scoped）
- Dispatch 經 Codex SpawnAgent；產出 `run-state.json` 可稽核狀態檔
- 同輸入產出有 run-to-run 非決定性（Codex 多 subagent dispatch 本質）

詳見 [CHANGELOG.md](CHANGELOG.md)。
