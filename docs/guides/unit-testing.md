# Unit Testing 使用指南

Unit 工作流程用一個 Orchestrator Skill 調度 Analyzer、Writer、Executor、Reviewer 四個 Agent。模型負責測試判斷與實作，JavaScript runtime 負責可重現的狀態、執行證據、完整性與結果投影。

## 前置條件

- Codex 支援原生 SpawnAgent 與 workspace agents。
- 已安裝目標專案需要的 .NET SDK。
- Node.js 可執行 `.codex/scripts/` 的零相依 runtime。
- `dotnet-testing-agent-skills@v2.4.2` 已安裝到 `.agents/skills/`。
- workspace 包含 `.codex/agents/`、`.codex/skills/`、`.codex/scripts/` 與 `.codex/config.toml`。

技術型 Skills 不隨本 repository 發布。consumer 必須從鎖定的上游 Release 安裝；目前相容基準 commit 為 `715400f6d64e321d2faa4d8164643b412118f9c8`。

## 啟動方式

在 workspace root 啟動 Codex，指定 target 與 test project：

```text
$dotnet-testing-orchestrator-unit

Target：src/OrderService.cs
Test project：tests/OrderService.Tests/OrderService.Tests.csproj
```

也可以附上 Markdown、文字、表格或 JSON 情境。Analyzer 會保留合理的使用者情境，逐項說明無法採用的內容，再補足目標行為所需的 scenarios。

若沒有提供具體測試情境或測試資料，Orchestrator會以`userProvidedScenarios: null`調度 Analyzer。Target path、流程要求、production修改限制或產物保留方式只是操作限制，不會建立`USR-*` scenario；Analyzer依 production behavior產生的情境使用`GEN-*` provenance。

若要先設計情境，可先使用外部 `$unit-test-scenarios`，再把結果交給 Unit Orchestrator。該 Skill 是可選前置工具，不在 Unit workflow 發布資產內。

## 執行流程

```text
Analyzer → Writer → Executor → Reviewer → final projection
```

| 階段 | 模型產出 | Deterministic gate |
| --- | --- | --- |
| Analyzer | 行為分析、scenarios、Skills 選擇 | target 與 scenario identity、artifact shape |
| Writer | 測試程式碼、scenario mapping | 單一 Writer、檔案 ownership、mapping 完整性 |
| Executor | 失敗診斷與核准範圍內修復 | build-first、TRX／coverage、attempt evidence |
| Reviewer | 語意品質與維護性裁決 | 與 scenario mapping、Executor truth 對帳 |
| Final | 使用者可讀報告 | JSON／Markdown 來自同一 machine truth |

每個 target 固定一個 Writer。合理 scenario 數不設上限；若單一 Writer 無法在 context/output limit 內完成，本次 attempt 以 blocker 結束，不拆 Writer，也不刪減案例。

## Artifact 形狀

runtime 接受自然的精簡或豐富 JSON。模型不必輸出固定句子，optional 說明也不影響客觀驗證。以下只示意核心欄位：

```json
{
  "target": "src/OrderService.cs",
  "scenarios": [
    { "id": "S-001", "behavior": "有效訂單會建立成功" }
  ]
}
```

```json
{
  "target": "src/OrderService.cs",
  "scenarioMappings": [
    { "scenarioId": "S-001", "testMethods": ["Create_有效訂單_建立成功"] }
  ],
  "testFiles": ["tests/OrderService.Tests/OrderServiceTests.cs"]
}
```

artifact 若同時宣告互相矛盾的客觀事實，例如 `passed=true` 卻含失敗測試數，runtime 會拒絕。blocked 或 unavailable 不會被投影成零失敗或零 coverage。

## Build 與測試證據

正式順序是 build-first：

```bash
dotnet build <test-project>
dotnet test <test-project> --no-build --logger trx --collect "XPlat Code Coverage"
```

實際參數由 runtime 組合並保存：

- build/test command、exit code、stdout、stderr；
- TRX 測試總數、通過、失敗、略過；
- Cobertura coverage；
- execution attempt、修復輪次與 repair eligibility；
- 各階段與整體 wall-clock timing。

Executor 摘要用於說明診斷，不是 runtime truth。Reviewer 也不能以自行重跑的結果取代 Executor evidence。

## Project integrity

執行前建立 inventory，執行後驗證差異：

```bash
node .codex/scripts/unit-runtime/project-integrity.mjs capture \
  --root <workspace> \
  --output <test-project>/.orchestrator/integrity-before.json
```

```bash
node .codex/scripts/unit-runtime/project-integrity.mjs verify \
  --root <workspace> \
  --baseline <test-project>/.orchestrator/integrity-before.json \
  --allow-add <approved-test-file> \
  --allow-change <approved-test-project-file>
```

allowlist 必須是精確相對路徑。未核准的 production source 異動會讓 workflow 失敗；不能以 Reviewer 評分或測試全綠覆蓋 integrity failure。

## 最終結果

最終輸出至少包含：

- target 與 terminal state；
- scenario coverage 與 Reviewer 裁決；
- build/test 數據與原始 evidence 路徑；
- coverage 可用值或 unavailable 原因；
- integrity 結果；
- phase 與整體 timing；
- Timing Evidence 與 Profiling Summary；
- Estimated Token Usage（固定區塊；估算不可得時顯示 unavailable；非 billing、不得作 correctness gate）。

`workflow-result.mjs` 可以從 bundled input 或四個 canonical artifacts 產生 JSON 與 Markdown：

```bash
node .codex/scripts/unit-runtime/workflow-result.mjs \
  --target <target> \
  --analysis <analysis.json> \
  --writer <writer-result.json> \
  --execution <execution-result.json> \
  --review <reviewer-result.json> \
  --test-project <test-project> \
  --json-output <workflow-result.json> \
  --markdown-output <workflow-result.md>
```

`--test-project` 讓 runtime 自動讀取 `<test-project>/.orchestrator/run-state.json`、執行 token estimator，並將固定 final report 一次寫入 Markdown。Orchestrator 只呈現該檔內容，不自行改寫格式或重新計算數值。

## 驗收與清理

驗收結束要檢查 `git status`，移除生成的測試檔、`.orchestrator/`、`bin/`、`obj/`、`TestResults/`，並還原 tracked test project 異動。`samples/*/tests/` 是空白起點，workflow byproducts 不得簽入。

Live Codex CLI 驗收只處理靜態 replay 無法回答的風險。開始 candidate batch 前，regression、artifact corpus、repository checks、跨平台 checks 與 public snapshot preview 必須全綠；batch 期間維持 frozen，完成後一次總複盤。

## 相關文件

- [Unit 架構](../architecture/unit-orchestrator.md)
- [工作流程驗證](workflow-validation.md)
- [安裝與環境設定](../SETUP.md)
