# 架構總覽

本 repository 提供 Unit、TUnit、Integration、Aspire 四套 Codex 原生測試工作流程。每一套都有自己的 **1 Orchestrator Skill + 4 Agent TOML**，不是共用單一角色組合。

## 四套工作流程

| Workflow | Orchestrator | Agent prefix | Runner |
| --- | --- | --- | --- |
| Unit | `dotnet-testing-orchestrator-unit` | `dotnet-testing-*` | xUnit `dotnet test` |
| TUnit | `dotnet-testing-orchestrator-tunit` | `dotnet-testing-advanced-tunit-*` | Microsoft.Testing.Platform `dotnet run` |
| Integration | `dotnet-testing-orchestrator-integration` | `dotnet-testing-advanced-integration-*` | xUnit `dotnet test` + Docker/Testcontainers |
| Aspire | `dotnet-testing-orchestrator-aspire` | `dotnet-testing-advanced-aspire-*` | Aspire Testing + xUnit `dotnet test` |

四套流程都依序執行 Analyzer → Writer → Executor → Reviewer，但分析粒度、執行環境、artifact 與驗證契約由各自實作決定。Lite 的兩角色拓樸、情境編號或 runtime 結構不構成 Full 版規格。

## 調度與 context

Orchestrator 是載入主對話的 Skill，透過 Codex 原生 SpawnAgent 調度四個角色。正式 dispatch 固定使用：

- `fork_turns: "none"`；
- self-contained assignment；
- 只讀 assigned source/project、repo-local Skills 與本次 run 核准的 canonical handoffs；
- 每 target 一個 Writer，不依 method、scenario、endpoint、Resource 或輸出大小拆分。

模型角色的責任如下：

| 角色 | 判斷責任 |
| --- | --- |
| Analyzer | 分析被測行為、建立 scenarios、選擇相關技術型 Skills |
| Writer | 撰寫符合 scenarios 與技術來源的測試程式碼 |
| Executor | 診斷 build/test 失敗並在核准邊界內修復 |
| Reviewer | 審查測試語意品質、斷言、覆蓋與可維護性 |

Skills 是測試技術來源，不是逐句比對的法典。客觀 workflow truth 應由 deterministic runtime 或 validator 管理，不能靠持續增加提示規則模擬。

## Truth 分層

```text
模型判斷
  行為分析／測試實作／失敗診斷／品質審查

Orchestrator 調度
  phase 順序／角色 dispatch／canonical handoff／結果呈現

Deterministic runtime
  state／artifact consistency／build-test evidence／integrity／timing／projection

驗收環境
  .NET SDK／Docker／workspace isolation／artifact replay／跨平台 checks

發布流程
  manifest／public snapshot validation／sync／tag／Release
```

`run-state.json` 的 wall-clock 時間是正式 timing truth。Executor 原始 build/test evidence 是 runtime truth；Reviewer 必須執行，但不得自行重跑測試來改寫 Executor 結果。Estimated Token Usage 只是 visible-context 估算，不是 billing truth，也不參與 correctness gate。

## Unit v1.3.0 deterministic runtime

Unit 是 v1.3.0 的主要重整範圍。`.codex/scripts/unit-runtime/` 提供：

- 固定 phase state 與多 target barrier；
- 自然 artifact shape normalization；
- build-first runner、TRX 與 Cobertura evidence；
- project integrity inventory 與精確 allowlist；
- JSON／Markdown final projection。

這些機制接管 machine truth，但不接管 scenario 價值、測試設計或 Reviewer 的語意判斷。TUnit、Integration、Aspire 保留自己的 runner 與既有 validators，本版不直接複製 Unit runtime 拓樸。

## Skill 位置

- `.codex/skills/`：四個 Orchestrator 與 `dotnet-test`，隨公開版發布。
- `.agents/skills/`：外部 `dotnet-testing-agent-skills` 與可選 `unit-test-scenarios`，不追蹤、不隨本 repository 發布。

目前 shared technical Skills 相容基準為 `v2.4.2`，exact commit `715400f6d64e321d2faa4d8164643b412118f9c8`。

## 公開發布邊界

`public-release-manifest.json` 是公開部署白名單的唯一來源。兩條同步 workflow 共用 `scripts/sync-public-assets.mjs` 產生 snapshot，再以 `scripts/validate-public-release-assets.mjs --strict-public` 驗證。

公開內容包含：

- 16 個 Agent TOML；
- 5 個 Codex-specific Skills；
- `.codex/config.toml`；
- 21 支 `.codex/scripts/` runtime scripts；
- 白名單文件與四套 samples scaffold。

公開內容不包含 `.agents/skills/`、lab setup/tests、lock files、workflow records 或 sample byproducts。

## 驗收策略

固定契約先以 regression 與 artifact replay 驗證。只有 dispatch、context/output limit 與模型品質等靜態證據無法回答的風險，才進入 Codex CLI live matrix。

final candidate 建立前，repository regression、clean public snapshot、跨平台檢查與 protected path 檢查必須全綠。candidate batch 開始後保持 frozen，完成後只做一次總複盤。

## 相關文件

- [Unit 架構](unit-orchestrator.md)
- [TUnit 架構](tunit-orchestrator.md)
- [Integration 架構](integration-orchestrator.md)
- [Aspire 架構](aspire-orchestrator.md)
- [工作流程驗證](../guides/workflow-validation.md)
