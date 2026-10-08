# Unit Testing 使用指南

Unit 工作流程用一個 Orchestrator Skill 調度 Analyzer、Writer、Executor、Reviewer 四個 Agent。模型負責測試判斷與實作，JavaScript runtime 負責可重現的狀態、執行證據、完整性與結果投影。

## 前置條件

- Codex 支援原生 SpawnAgent 與 workspace agents。
- 已安裝目標專案需要的 .NET SDK。
- Node.js 可執行 `.codex/scripts/dotnet-testing-codex-full/` 的零相依 runtime。
- `dotnet-testing-agent-skills@v2.4.5` 已安裝到 `.agents/skills/`。
- workspace 包含 `.codex/agents/`、`.codex/skills/`、`.codex/scripts/dotnet-testing-codex-full/` 與 `.codex/config.toml`。

技術型 Skills 不隨本 repository 發布。consumer 必須從鎖定的上游 Release 安裝；目前相容基準 commit 為 `a4908967ef8fe63ad2fe275df1df3c015ec51a4c`。

## 啟動方式

在 workspace root 啟動 Codex，指定 source project、target 檔案、完整類別名稱、class／method scope 與既有 test project exact `.csproj`。Source project 可先給目錄或 `.csproj`；Orchestrator 會解析成唯一 `.csproj`，無法唯一解析時停止。Skill path 由 Orchestrator 從本次 workspace 解析，不是使用者輸入：

```text
$dotnet-testing-orchestrator-unit

Workspace root：<目前 repository 的絕對路徑>
Source project：samples/unit/practice/src/Practice.Core.Net8/Practice.Core.Net8.csproj
Target file：samples/unit/practice/src/Practice.Core.Net8/TemperatureConverter.cs
Target class：Practice.Core.Net8.TemperatureConverter
Scope：class（全部公開方法）
Test project：samples/unit/practice/tests/Practice.Core.Net8.Tests/Practice.Core.Net8.Tests.csproj
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

一次指定多個 targets 時，Analyzer 與 Reviewer 可同批派遣；一般與 Coverage repair 的 Writer、Executor 都按 target 順序逐一執行。每個 phase 要等所有已派遣 targets 完成才進入下一階段，正式 phase timing 取該批最晚完成時間。若其中一個 target 提前 failed／blocked，runtime 先收回同批已派遣結果，再將未開始下游工作的 targets 標記為 `cancelled`。

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

指定 method selector 確實不存在或無法解析時，Analyzer 以空方法、空有效 scenario 與結構化 failure 交付 blocked artifact；Writer 不建立測試，Executor 產生 attempt-0 not-run evidence，Reviewer 完成 blocked 審查。這條路徑保留四角色與原因，不會把無效 selector 擴成全類別。

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
node .codex/scripts/dotnet-testing-codex-full/unit-runtime/project-integrity.mjs capture \
  --root <workspace> \
  --output <test-project>/.orchestrator/integrity-before.json
```

```bash
node .codex/scripts/dotnet-testing-codex-full/unit-runtime/project-integrity.mjs verify \
  --root <workspace> \
  --baseline <test-project>/.orchestrator/integrity-before.json \
  --allow-add <approved-test-file> \
  --allow-change <approved-test-project-file>
```

allowlist 必須是精確相對路徑。未核准的 production source 異動會讓 workflow 失敗；不能以 Reviewer 評分或測試全綠覆蓋 integrity failure。

## 最終結果

最終輸出至少包含：

- target 或 ordered targets 與各自的 terminal state；
- scenario coverage 與 Reviewer 裁決；
- build/test 數據與原始 evidence 路徑；
- coverage 可用值或 unavailable 原因；
- integrity 結果；
- phase 與整體 timing；
- Timing Evidence 與 Profiling Summary；

`workflow-result.mjs` 可以從 bundled input 或四個 canonical artifacts 產生 JSON 與 Markdown：

```bash
node .codex/scripts/dotnet-testing-codex-full/unit-runtime/workflow-result.mjs \
  --target <target> \
  --analysis <analysis.json> \
  --writer <writer-result.json> \
  --execution <execution-result.json> \
  --review <reviewer-result.json> \
  --test-project <test-project> \
  --json-output <workflow-result.json> \
  --markdown-output <workflow-result.md>
```

`--test-project` 讓 runtime 自動讀取 `<test-project>/.orchestrator/run-state.json`，並將固定 final report 一次寫入 Markdown。Orchestrator 只呈現該檔內容，不自行改寫格式或重新計算數值。

多 target terminal 直接交給同一份 workflow state；省略 `--target` 時，runtime 依 workflow-state 順序產生一份 schema v3 JSON 與一份固定八區塊 Markdown：

```bash
node .codex/scripts/dotnet-testing-codex-full/unit-runtime/workflow-result.mjs \
  --workflow-state <test-project>/.orchestrator/workflow-state.json \
  --test-project <test-project> \
  --json-output <workflow-result.json> \
  --markdown-output <workflow-result.md>
```

報告中的 Executor 修正內容只從已 seal 的 Executor／repair Executor artifact 讀取 `repairHistory`；未 seal 的文字、外部檔案或 Git diff 不會成為正式修正證據。

## 驗收與清理

驗收結束要檢查 `git status`，移除生成的測試檔、`.orchestrator/`、`bin/`、`obj/`、`TestResults/`，並還原 tracked test project 異動。`samples/*/tests/` 是空白起點，workflow byproducts 不得簽入。

Live Codex CLI 驗收只處理靜態 replay 無法回答的風險。開始 candidate batch 前，regression、artifact corpus、repository checks、跨平台 checks 與 public snapshot preview 必須全綠；batch 期間維持 frozen，完成後一次總複盤。

## 相關文件

- [Unit 架構](../architecture/unit-orchestrator.md)
- [工作流程驗證](workflow-validation.md)
- [安裝與環境設定](../SETUP.md)
