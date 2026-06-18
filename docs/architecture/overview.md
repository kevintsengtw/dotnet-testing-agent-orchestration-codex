# 架構總覽

- [架構總覽](#架構總覽)
  - [1. 設計理念](#1-設計理念)
    - [Agent Orchestration](#agent-orchestration)
    - [Orchestrator 為 Skill、Subagent 由 SpawnAgent 調度](#orchestrator-為-skillsubagent-由-spawnagent-調度)
    - [run-state.json 稽核狀態檔](#run-statejson-稽核狀態檔)
  - [2. 系統架構圖](#2-系統架構圖)
  - [3. Agent 組成](#3-agent-組成)
  - [4. 標準工作流程](#4-標準工作流程)
  - [5. 執行循序圖](#5-執行循序圖)
  - [6. 關鍵設計決策](#6-關鍵設計決策)

---

## 1. 設計理念

### Agent Orchestration

Agent Orchestration 是一種多 AI 代理協作模式：由一個「指揮者」（Orchestrator）統籌協調多個「執行者」（Subagent），各司其職地完成複雜任務。

在本 repo 的架構中：

- **Orchestrator**：負責任務拆解、順序協調與結果整合，本身不撰寫任何測試程式碼
- **Subagent**：接受 Orchestrator 委派，專注執行單一職責（分析 / 撰寫 / 執行 / 審查）

這種分工讓每個 Subagent 的 context 保持精簡，避免單一 AI 實例因上下文過長導致品質下降。

### Orchestrator 為 Skill、Subagent 由 SpawnAgent 調度

本架構將 Orchestrator 定義為 **Skill**，將四個角色定義為 **Subagent**（`.codex/agents/*.toml`）：

- Orchestrator Skill（`dotnet-testing-orchestrator-unit`）載入主對話的 context
- 主對話載入 Skill 後，透過 Codex 原生 **SpawnAgent** 依序調度四個 Subagent
- 每個 Subagent 的定義檔（`.codex/agents/*.toml`）由 SpawnAgent 自動載入

> SpawnAgent 是 Codex 原生的多代理調度機制，與 Claude Code 的 Agent tool 不同。本 repo 由上游 Claude 版經 migrate-to-codex 轉換後，dispatch 已改用 Codex 原生 SpawnAgent。

### run-state.json 稽核狀態檔

工作流程執行過程中，Orchestrator 會維護一份 `run-state.json`（位於測試專案的 `.orchestrator/` 目錄下），記錄各階段的 wall-clock 起訖時間、subagent 結果與整體狀態。

- `run-state.json` 的 wall-clock 時間戳是**官方階段耗時與整體耗時的唯一真實來源**，不依賴 narration 或其他推算。
- `config.toml` 可選擇啟用 `codex_hooks` 作為額外 telemetry，但官方耗時一律以 `run-state.json` 為準。

> 本版**不提供 token 用量統計**：Codex native SpawnAgent subagent 的全流程 token 無可靠 truth source（實證確認），故不回報 token 數字，避免誤導。

---

## 2. 系統架構圖

```mermaid
graph TD
    Dev[👤 開發人員] -->|呼叫 $dotnet-testing-orchestrator-unit| Skill[📋 Orchestrator Skill\n主對話 context]

    subgraph pipeline [四階段 Subagent 流水線（SpawnAgent 調度）]
        direction TB
        AN[🔍 Analyzer Subagent\ndotnet-testing-analyzer]
        WR[✍️ Writer Subagent\ndotnet-testing-writer]
        EX[⚙️ Executor Subagent\ndotnet-testing-executor]
        RV[📋 Reviewer Subagent\ndotnet-testing-reviewer]
        AN --> WR --> EX --> RV
    end

    subgraph external [📚 外部技術型 Agent Skills\ndotnet-testing-agent-skills]
        AS1[autofixture-*]
        AS2[nsubstitute-*]
        AS3[awesome-assertions-*]
        AS4[其他技術技能]
    end

    Skill -->|SpawnAgent 委派| pipeline
    pipeline -.->|更新 run-state.json| State[(.orchestrator/run-state.json\n稽核狀態 + wall-clock 耗時)]

    AN & WR & RV -->|按需載入| external
    EX -->|執行| DT[dotnet build / dotnet test]
```

---

## 3. Agent 組成

本版聚焦 Unit 測試，由 1 個 Orchestrator Skill 調度 4 個專屬 Subagent。

| 角色         | 類型     | 定義檔路徑                                         |
| ------------ | -------- | -------------------------------------------------- |
| Orchestrator | Skill    | `.codex/skills/dotnet-testing-orchestrator-unit/`  |
| Analyzer     | Subagent | `.codex/agents/dotnet-testing-analyzer.toml`       |
| Writer       | Subagent | `.codex/agents/dotnet-testing-writer.toml`         |
| Executor     | Subagent | `.codex/agents/dotnet-testing-executor.toml`       |
| Reviewer     | Subagent | `.codex/agents/dotnet-testing-reviewer.toml`       |

> Integration / Aspire / TUnit 的 Orchestrator 與對應 Subagent 為後續釋出 🚧。

---

## 4. 標準工作流程

```mermaid
flowchart TD
    Start([開始]) --> P0[Phase 0\n清理殘留 .orchestrator/ 目錄\n初始化 run-state.json]
    P0 --> P1[Phase 1：Analyzer\n分析被測試目標\n產出 analysis.json]
    P1 --> Check{方法數 > 5\n或情境數 > 20？}

    Check -- 否 --> P2[Phase 2：Writer\n單一 Writer 撰寫所有測試]
    Check -- 是 --> P2A[Phase 2a：Writer 1\n負責前半部方法]
    Check -- 是 --> P2B[Phase 2b：Writer 2\n負責後半部方法]
    P2A & P2B --> P2Merge[合併兩個 Writer 產出]

    P2 --> P3[Phase 3：Executor\ndotnet build\ndotnet test]
    P2Merge --> P3

    P3 --> ExecCheck{全部通過？}
    ExecCheck -- 否，修正並重試\n最多 3 輪 --> P3
    ExecCheck -- 是 --> P4[Phase 4：Reviewer\n審查測試品質\n產出評分與建議]

    P4 --> ReviewCheck{有修正建議\n且使用者同意套用？}
    ReviewCheck -- 否 --> P5[Phase 5\n清理 executor-result/ 暫存\n收尾 run-state.json]
    ReviewCheck -- 是 --> Mod[修改流程\nWriter 修改 → Executor 執行 → Reviewer 複審]
    Mod --> P5

    P5 --> End([完成])
```

---

## 5. 執行循序圖

```mermaid
sequenceDiagram
    actor Dev as 👤 開發人員
    participant Main as 主對話
    participant Skill as Orchestrator Skill
    participant State as run-state.json
    participant AN as Analyzer
    participant WR as Writer
    participant EX as Executor
    participant RV as Reviewer

    Dev->>Main: $dotnet-testing-orchestrator-unit\n「為 ProductService 撰寫單元測試」
    Main->>Skill: 載入 Skill context
    Skill->>Skill: Phase 0：清理殘留 .orchestrator/
    Skill->>State: 初始化 run-state.json

    Note over Skill,AN: SpawnAgent 委派 Analyzer
    Skill->>AN: SpawnAgent(dotnet-testing-analyzer, prompt)
    AN-->>Skill: 分析摘要 + analysis.json 路徑
    Skill->>State: 記錄 Analyzer 起訖時間與結果

    Note over Skill,WR: SpawnAgent 委派 Writer
    Skill->>WR: SpawnAgent(dotnet-testing-writer, analysisFilePath + 輸出路徑)
    WR-->>Skill: 測試檔案路徑 + testCount
    Skill->>State: 記錄 Writer 起訖時間與結果

    Note over Skill,EX: SpawnAgent 委派 Executor
    Skill->>EX: SpawnAgent(dotnet-testing-executor, 測試專案路徑 + 交接檔案路徑)
    EX->>EX: dotnet build
    EX->>EX: dotnet test
    EX-->>Skill: 通過數 / 失敗數 / 修正輪次
    Skill->>State: 記錄 Executor 起訖時間與結果

    Note over Skill,RV: SpawnAgent 委派 Reviewer
    Skill->>RV: SpawnAgent(dotnet-testing-reviewer, 測試檔案路徑 + 交接檔案路徑)
    RV-->>Skill: 評分 + issues + 改善建議
    Skill->>State: 記錄 Reviewer 起訖時間與結果

    Skill->>Skill: Phase 5：清理 executor-result/ 暫存
    Skill->>Main: 整合結果 + 各階段耗時（取自 run-state.json）
    Main->>Dev: 呈現結果
```

---

## 6. 關鍵設計決策

| 設計選擇          | 決策                          | 原因                                                                                         |
| ----------------- | ----------------------------- | -------------------------------------------------------------------------------------------- |
| Orchestrator 載體 | Skill（非 Subagent）          | Skill 在主對話中執行，才能透過 SpawnAgent 調度 Subagent；若定義為 Subagent 則身處子對話，無法再對外調度 |
| Dispatch 機制     | Codex 原生 SpawnAgent         | 由上游 Claude 版的 Agent tool 經 migrate-to-codex 轉換而來，改用 Codex 原生多代理調度          |
| 耗時量測          | run-state.json wall-clock     | wall-clock 時間戳是唯一真實來源；hooks 僅為可選 telemetry，官方耗時不依賴 narration            |
| Token 統計        | 不提供                        | Codex native subagent 的全流程 token 無可靠 truth source（實證確認），回報數字會誤導            |
| 大型類別處理      | Writer 分割策略               | 方法數 > 5 或情境數 > 20 時，拆分為最多 2 個平行 Writer，避免單一 Subagent 因上下文過長導致品質下降 |
| 技能載入方式      | 動態載入技術型 Agent Skills   | Analyzer 依分析結果決定 Writer 需要哪些技能，按需載入，避免無謂的 context 佔用                  |
| 交接機制          | JSON 檔案（.orchestrator/）   | Subagent 間透過交接 JSON 傳遞結構化資料，而非在 prompt 中嵌入完整內容，保持每個 Subagent 的 prompt 精簡 |
| 清理策略          | 保留 analysis/，刪除 executor-result/ | analysis.json 供 review 時當證據；executor-result/ 為暫存資料，每次流程結束後清理（皆不進版控）  |
