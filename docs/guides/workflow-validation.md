# 四工作流程驗證指南

本文件定義 Unit、TUnit、Integration、Aspire 的共同 correctness、artifact、isolation 與 runtime 驗證原則。Estimated Token Usage 只用於 visible-context 相對成本比較，不參與測試通過、Reviewer 評分或 billing。

正式流程不使用 RAG。角色只讀 prompt 指定的 source/project、repo-local Skills，以及本次 run 核准的 canonical handoffs。

## 共同正式契約

- Phase 順序固定為 Analyzer → Writer → Executor → Reviewer。
- 所有正式 dispatch 使用 `fork_turns: "none"`、`executionContext: "self-contained"`、`contextForkPolicy=none`、`externalMemoryPolicy=forbid`。
- 每個 target 固定一個 Writer，不以 method、scenario、endpoint、Resource、target type 或預估輸出大小 split。
- Analyzer 的合理 in-scope scenarios 不設數量上限；唯一 Writer 必須承接全部有效 scenarios。
- Single Writer 無法完成時回報 blocker；不得回退 split 或靜默刪減 scenarios。
- Executor 先 build，再使用該 framework 的正式 runner 執行完整 project test。
- Executor 全綠後仍必須執行 Reviewer 與 scenario/endpoint acceptance gate。
- Production/AppHost code 不得為了讓生成測試通過而修改。
- `run-state.json` 是官方 wall-clock timing 的唯一 truth source。

Split／two-step topology 只保留在歷史實驗與 validator compatibility fixtures，不能成為正式 runtime fallback。

因此，現行 Unit 文件與 runtime 都只採用每 target 單一 Writer topology。

## 公開 bundle 必要資產

```text
.codex/
├── agents/                                      # 16 個 TOML
├── config.toml
├── scripts/
│   ├── run-state.mjs
│   ├── estimate-token-usage.mjs
│   └── validators/
│       ├── validate-unit-attempt-isolation.mjs
│       ├── validate-unit-scenario-contract.mjs
│       ├── validate-tunit-role-read-scope.mjs
│       ├── validate-tunit-execution-contract.mjs
│       ├── validate-integration-scenario-contract.mjs
│       ├── validate-integration-role-read-scope.mjs
│       ├── validate-integration-execution-contract.mjs
│       ├── validate-aspire-scenario-contract.mjs
│       ├── validate-aspire-role-read-scope.mjs
│       └── validate-aspire-execution-contract.mjs
└── skills/
    ├── dotnet-test/
    ├── dotnet-testing-orchestrator-unit/
    ├── dotnet-testing-orchestrator-tunit/
    ├── dotnet-testing-orchestrator-integration/
    ├── dotnet-testing-orchestrator-aspire/
    └── unit-test-scenarios/
```

另外需要安裝外部 [`dotnet-testing-agent-skills`](https://github.com/kevintsengtw/dotnet-testing-agent-skills)。

## Fresh workspace 前提

正式 runtime 必須從無前次 byproducts 的測試專案開始：

- 無 `.orchestrator/`。
- 無前次生成的測試或 infrastructure 檔案。
- 無 `bin/`、`obj/`、`TestResults/`。
- test csproj 與起始 scaffold 一致。
- 不複製前次 run 的 analysis、writer、executor 或 reviewer artifacts。

## 四階段驗證

### Analyzer

- 每個 target 產生一份 canonical `analysis.json`。
- 正確記錄 source/test project、framework、methods/endpoints/Resources 與有效 scenarios。
- `suggestedTestScenarios`、scenario catalog 與 review summary 數量一致。
- 使用者提供 scenarios/test data 時保留來源與逐項接受、正規化、合併、限制或拒絕理由。
- `tokenEstimateInputs.readFiles`／`writtenFiles` 如實記錄；不得讀 prior attempt、外部 memory 或 unrelated orchestration definitions。

### Writer

- 每個 target 正好一個 `single`／`full` Writer assignment。
- 一個 Writer 可以產生多個測試檔，但只產生一份 target canonical writer-result。
- `testFilePaths`、test method/case counts、skills、methods/endpoints 與 scenario coverage 可追溯。
- 所有有效 scenarios 都是 `implemented` 或有明確 blocker/limitation；不得靜默遺漏。
- 使用者提供 test data 時，不能以 generated data 取代後仍宣稱完整實作。

### Executor

- build result 與 test result 分開記錄。
- `fixRounds`、`fixHistory`、attempts 與實際命令一致。
- 執行完整、未過濾的 project regression；不得用舊 binary 或局部 filter 宣稱整體通過。
- 測試檔與 Writer artifacts 對得起來。
- production source、AppHost 與非授權專案檔沒有 mutation。

各 framework runtime truth：

| Workflow | Runner | 其他必要 evidence |
| --- | --- | --- |
| Unit | xUnit `dotnet test` | 全 project passed/failed/skipped |
| TUnit | Microsoft.Testing.Platform `dotnet run` | SourceGenerated、`OutputType=Exe`、實際 cases |
| Integration | xUnit `dotnet test` | Docker、required/started container kinds、必要時 project regression |
| Aspire | xUnit `dotnet test --blame-hang-timeout` | Docker、AppHost、Resource readiness、Aspire-native builder |

### Reviewer

- 必須產生 canonical reviewer-result，含 grade/score、`gateDecision`、issues、warnings 與 missing cases。
- 以 Executor artifact 作 runtime truth，不自行重跑測試取代它。
- scenario／endpoint／Resource acceptance 與 Analyzer、Writer、Executor 對帳。
- `gateDecision=pass|pass_with_warnings` 時不得仍有未揭露的 missing scenario。
- Unit/TUnit 的 `userScenarioCoverage` 只計 `source: "user"`；Analyzer `GEN-*` 不得混入 user arrays。
- 綠色 runtime 後照常回報 warnings，但不自動啟動 remediation pass。

## Runtime validator 命令

Attempt isolation 由四工作流程共用：

```bash
node .codex/scripts/validators/validate-unit-attempt-isolation.mjs --workflow <unit|tunit|integration|aspire> --workspace-root <workspace> --test-project <test-project> --artifact <artifact> --allow-read <approved-handoff>
```

Unit/TUnit scenario acceptance：

```bash
node .codex/scripts/validators/validate-unit-scenario-contract.mjs --workflow <unit|tunit> --analysis <analysis.json> --writer <writer-result.json> --reviewer <reviewer-result.json> --require-review-pass
```

Integration gates：

```bash
node .codex/scripts/validators/validate-integration-role-read-scope.mjs --role <analyzer|reviewer> --workspace-root <workspace> --artifact <artifact>
node .codex/scripts/validators/validate-integration-scenario-contract.mjs --analysis <analysis.json> --writer <writer-result.json> --reviewer <reviewer-result.json> --require-review-pass
node .codex/scripts/validators/validate-integration-execution-contract.mjs --analysis <analysis.json> --writer <writer-result.json> --executor <executor-result.json> --require-pass --forbid-production-mutation
```

Aspire gates：

```bash
node .codex/scripts/validators/validate-aspire-role-read-scope.mjs --role <analyzer|reviewer> --workspace-root <workspace> --artifact <artifact>
node .codex/scripts/validators/validate-aspire-scenario-contract.mjs --analysis <analysis.json> --writer <writer-result.json> --reviewer <reviewer-result.json> --require-review-pass --require-single-writer
node .codex/scripts/validators/validate-aspire-execution-contract.mjs --analysis <analysis.json> --writer <writer-result.json> --executor <executor-result.json> --require-pass --forbid-production-mutation --require-single-writer
```

所有 phase closeout 後驗證 strict timing：

```bash
node .codex/scripts/run-state.mjs validate --path <test-project>/.orchestrator/run-state.json --require-complete-timing
```

最後產生 optional Estimated Token Usage：

```bash
node .codex/scripts/estimate-token-usage.mjs --test-project <test-project>
```

Estimator unavailable 不會讓 correctness workflow 失敗，但必須回報 unavailable 原因；不得補猜 token 或改稱 billing usage。

## 修改流程

Reviewer 提出建議後，只有使用者明確授權才執行 Writer modification → Executor → Reviewer re-review。除非 scope 或 production source 已實質改變，否則不重跑 Analyzer。

## 不通過條件

- 任一正式 role 繼承主對話或讀取外部 memory。
- 同一 target dispatch 多個正式 Writers。
- Writer 超限後恢復 split 或刪減 scenarios。
- artifact 缺必要欄位仍進入下游 phase。
- build 失敗卻使用舊 binary test 結果宣稱通過。
- Executor 全綠後跳過 Reviewer 或 formal acceptance。
- Reviewer 把 limitation/blocked 偽報為 implemented，或隱藏 missing cases。
- 未經獨立授權修改 production/AppHost code。
- strict run-state gate 失敗卻宣稱 timing evidence 完整。
- Estimated Token Usage 被用作 correctness、Reviewer 評分或 billing truth。
