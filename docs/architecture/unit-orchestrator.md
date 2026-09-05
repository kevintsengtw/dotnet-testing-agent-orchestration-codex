# Unit Testing Orchestrator 架構

Unit 工作流程保留 Full 版的 **1 Orchestrator Skill + 4 Agent TOML** 架構。v1.3.0 的重點不是增加提示規則，而是把可由程式判定的 workflow truth 移到 `.codex/scripts/unit-runtime/`。

## 元件與責任

| 元件 | 類型 | 主要責任 | 不承擔的責任 |
| --- | --- | --- | --- |
| Unit Orchestrator | Skill | 接收範圍、依 phase 調度、傳遞 canonical artifacts、呈現結果 | 自行分析、撰寫測試、宣告 machine truth |
| Analyzer | Agent | 分析行為、建立 scenarios、選擇技術型 Skills | 建置、執行、修復測試 |
| Writer | Agent | 依 analysis 與 Skills 撰寫測試、回報 scenario mapping | 判定測試是否真的通過 |
| Executor | Agent | 診斷 build/test 失敗，在核准邊界內修復 | 以摘要取代原始執行證據 |
| Reviewer | Agent | 審查語意品質、斷言、可維護性與情境覆蓋 | 重跑測試取代 Executor evidence |
| Unit runtime | JavaScript | phase state、artifact validation、build/test evidence、integrity、final projection | 測試案例設計與品質判斷 |

技術型 `dotnet-testing-*` Skills 是測試技術來源。角色依目標需要載入相關內容，不把 Skill 當成逐句比對的法典，也不因單次模型變異持續增加 target-specific 規則。

## 固定拓樸

```text
Unit Orchestrator
  → Analyzer
  → 每 target 一個 Writer
  → Executor
  → Reviewer
```

- 每個角色都使用 `fork_turns: "none"`。
- 同一 target 固定一個 Writer，不依 method、scenario 或輸出大小拆分。
- Analyzer 可提出符合目標行為的合理 scenarios，不設人為數量上限。
- 多 target 必須完成同一 phase 後才能進入下一 phase。
- Executor 共用測試專案時循序執行，避免 build/test 競爭。
- Writer 超過 context 或 output limit 時，本次 attempt 停止並保留證據，不改回 split，也不刪減已接受 scenarios。

## Deterministic truth chain

```text
analysis artifact
  → writer artifact
  → build/test raw evidence
  → reviewer artifact
  → normalized workflow result
```

`.codex/scripts/unit-runtime/` 包含 8 個零相依模組：

| Script | 用途 |
| --- | --- |
| `workflow-state.mjs` | 固定 phase 順序、狀態轉移、terminal state 與 timing |
| `workflow.mjs` | 多 target phase barrier、單一 Writer 與 Executor 循序規則 |
| `artifact-normalizer.mjs` | 接受自然的精簡或豐富 artifact shape，拒絕客觀矛盾 |
| `coverage-decision.mjs` | 依 target-scoped coverage 與 threshold 產生 deterministic retry／terminal decision |
| `execution-evidence.mjs` | 正規化 build、TRX、Cobertura 與 execution attempt evidence |
| `run-unit-execution.mjs` | build-first 執行器，保存 stdout、stderr、TRX 與 coverage 原始證據 |
| `project-integrity.mjs` | production/test project 檔案雜湊 inventory 與明確 allowlist 驗證 |
| `workflow-result.mjs` | 從同一份 machine truth 投影 JSON 與 Markdown 最終結果；讀取 run-state 並執行 token estimator |

模型可以用不同措辭或不同欄位豐富度表達結果；runtime 只要求必要識別、scenario mapping、執行數據與裁決不互相矛盾。optional prose 缺少或改寫不構成失敗。

## Phase 流程

### 0. 啟動與完整性基準

1. 確認 workspace、target 與 test project。
2. 建立本次 attempt 的 `.orchestrator/` 範圍。
3. 用 `project-integrity.mjs capture` 保存修改前 inventory。
4. 初始化 workflow state。

### 1. Analyzer

Analyzer 讀取目標程式碼與核准的使用者情境，輸出 canonical analysis。runtime 驗證 target、scenario ID 與必要集合結構；測試價值與技術選擇仍由模型判斷。

### 2. Writer

Writer 讀取目標程式碼、canonical analysis 與必要 Skills，完成所有已接受 scenarios。runtime 對帳 scenario mapping、輸出檔與 target ownership，不用固定句子驗收測試內容。

### 3. Executor

執行器從 assignment payload 取得 target source/class 與 workflow state 的 Line／Branch thresholds，先 build，再以 `dotnet test --no-build` 執行完整測試專案。原始輸出、TRX 與 target-scoped Coverage 是 machine truth；模型摘要不能覆寫它們。

修復不是固定成功輪數。runtime 記錄 `attempt`、`fixRound`、`maxFixRounds` 與 `repairEligible`；Executor 以可對帳的 `executionEvidencePaths` 宣告同 assignment retry history，跨 run／其他 target／archive artifact仍拒絕。達到界線、需要未授權 production 變更或環境無法執行時，以失敗或 blocked 結束，不增加提示規則繞過。

### 4. Reviewer

Reviewer 使用 analysis、writer artifact 與 Executor evidence 審查情境覆蓋、斷言品質、隔離性、命名與可維護性。全部有效 scenario 由 Writer coverage 對帳；`userScenarioCoverage` 只統計 `USR-*`，因此 GEN-only limitation 可形成 blocked，而 user coverage仍維持空集合且 complete。Reviewer 必須執行，但不得重跑測試來改寫 runtime truth。

### 5. 最終投影

Terminal 後先由 `run-state.mjs closeout` 依 workflow-state truth驗證 assignment completion並關閉 phase 與 overall boundary，再執行 deterministic profiling finalize 與 strict timing validation；closeout不回填 assignment timestamp。Canonical artifact 的 access／permission failure一律 fail closed，不修改 ACL、ownership 或 permission繞過。`workflow-result.mjs` 接著產生 JSON 與 Markdown 兩種輸出。傳入 `--test-project` 後，runtime 自動讀取 `.orchestrator/run-state.json` 並執行 `estimate-token-usage.mjs`；模型不負責重算或拼接 final report。固定輸出包含測試結果總覽、情境覆蓋、Reviewer 結論、修正／異常與交付、各階段耗時、Timing Evidence、Profiling Summary 與 Estimated Token Usage。缺少 timing 或 token evidence 時保留對應區塊並標示 unavailable，不省略、不補零、不推測；token telemetry 不參與 correctness gate。

## Integrity 與變更邊界

- 預設 production source 不得變更。
- 合法的新增、修改或移除必須以精確路徑 allowlist 宣告。
- `.agents/skills/**`、`.codex/skills/dotnet-test/**` 與技術型 Skills 是唯讀基準。
- `samples/*/tests/**` 的生成測試、`.csproj` 異動、`.orchestrator/`、`bin/`、`obj/`、`TestResults/` 都是驗收 byproduct，不得簽入。

## 驗收原則

靜態 regression 與 artifact replay 優先驗證固定契約：

- phase 順序與 barrier；
- single Writer topology；
- natural artifact shape；
- build-first 與原始 evidence；
- production integrity；
- JSON／Markdown final projection 一致性；
- public snapshot 是否包含全部 runtime scripts。

只有靜態證據無法回答的 dispatch、context/output limit 與模型品質風險才進入 Codex CLI live matrix。candidate batch 一旦開始即凍結，執行途中不修改提示或追加規則；整批完成後只做一次總複盤。

## 相關文件

- [Unit 使用指南](../guides/unit-testing.md)
- [工作流程驗證](../guides/workflow-validation.md)
- [安裝與環境設定](../SETUP.md)
