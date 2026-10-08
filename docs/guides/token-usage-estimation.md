# Token 實際用量與 credit 換算（含歷史估算說明）

v1.3.1 已移除 codex-full 估算器。Unit、TUnit、Integration、Aspire 皆完成各自獨立的完整實際用量 HTML、Standard credit 換算及絕對路徑交付的人工功能驗收。Unit 讀寫宣告使用 `declaredAccess`，不作 token 估算，也不證明讀取完整性。版本更新細節見 [v1.3.1 更新說明](v1.3.1-release-notes.md)。

## 目前版本：四套 workflow HTML 實際用量

四套 workflow 各自擁有 `usage-session.mjs`、`usage-report.mjs`、`usage-observer.mjs`，沒有跨 workflow import。TUnit／Integration／Aspire 在 run-state 初始化後由 Skill 啟動用量 observer；Unit 在 workflow start 成功後、Analyzer 前啟動，避免等待頁被初始化視為殘留。入口立刻建立 HTML 等待頁；Unit／TUnit／Aspire canonical renderer 在各自既有區塊及 Profiling Summary 後，以尾端獨立的 `HTML token-usage report` 提供可點擊的 HTML 絕對路徑、文字區塊中的原生絕對路徑、可複製的 file URL、收集狀態及說明，位置與 Integration 一致，維持原區塊順序與 presentation receipt；Integration 沿用自己的 link 入口，亦交付絕對路徑。主代理回合結束且三次快照一致後，背景程序更新同一份 HTML。

資料來源是逐請求 `token_usage_record.usage`；依明確 root thread／root turn、SQLite 唯讀代理關係及 run-state agentId 核對，response ID 去重，保留必要修正回合。不同 root turn 不混算；同一 root turn 混入其他工作則無法分離。需要可讀的 session 與受支援的 Codex state schema。優先使用同一 Node 程序的內建 SQLite 唯讀查詢，不需要額外啟動 Python；內建讀取方式不可用時，才依序嘗試現有的 python、python3。每次失敗的讀取方式、錯誤碼、exit code 與 stderr 都保留在 diagnosticDetails，runtime 不會自行安裝依賴。

報告列出未快取輸入、快取輸入、輸出、總量與請求數。推理已包含在輸出，不重複加總；資料缺漏不補零。`observed-complete` 表示已觀察完成與穩定，不代表帳務結算。中止、不支援、逾時或背景程序失敗均保留狀態與診斷，不改寫測試結果或 run-state 計時。unsupported 表示未啟動背景程序，重新整理不會恢復收集；只有 pending／observing 會繼續等待資料。

四套 workflow 使用與 codex-lite-lab 相同的完整 HTML 模板、用量表、說明文字及選用 Standard credit 換算互動。模板各自獨立保存在所屬 renderer，不跨 repo 或 workflow 載入。各請求的模型、推理強度與服務模式取自同回合、該請求之前最近的 `turn_context`，依代理與設定分組換算；未知模型、非 Standard 模式、缺漏用量不提供合計，服務模式缺漏時明確標示 Standard 前提試算。前端使用模板中註明日期的費率，不呼叫模型，也不代表實際扣抵。四套人工功能驗收已完成；Aspire 保留八項回報、原始環境例外與已接受的 Reviewer 警告，HTML 位於回覆最尾端。

產物位於本次測試專案的 `.orchestrator/usage/{runIdentifier}/`：`binding.json`、`captures.json`（僅允許欄位）、`report.json`、`report.html`、`status.json` 與 observer 程序記錄。HTML 可離線開啟，不載入外部資源；等待頁開啟後可重新整理。每個 observer 最多執行兩小時，不自動重啟或覆寫另一個 run；run-state 建立前中止時沒有用量報告。

## Standard credit 試算與模型支援

在 HTML 展開選用的 credit 區塊並使用換算按鈕。費率適用 ChatGPT token-based credits，不適用 API key 或舊制企業方案；頁面使用本版的 2026-10-07 費率快照，不會自動查詢最新費率或企業帳戶餘額。新版新增 `gpt-6.1-sol`；下表其餘三個模型原已支援，本版保留。

| 模型 | 每百萬未快取輸入 | 每百萬快取輸入 | 每百萬輸出 |
|---|---:|---:|---:|
| `gpt-6.1-sol` | 50 credits | 2.5 credits | 250 credits |
| `gpt-6-sol` | 50 credits | 5 credits | 250 credits |
| `gpt-6-luna` | 2.5 credits | 0.25 credits | 12.5 credits |
| `gpt-6-astra` | 250 credits | 25 credits | 1,250 credits |

```text
credits = (未快取輸入 × 輸入費率 + 快取輸入 × 快取費率 + 輸出 × 輸出費率) ÷ 1,000,000
```

推理強度不另乘倍率；推理 tokens 已含在輸出。GPT-6.1 Sol 三欄各一百萬 tokens 的試算為 `50 + 2.5 + 250 = 302.5 credits`。四份人工流程產生的 HTML 皆已核對此換算；正式流程模型仍是 `gpt-5.6-sol／medium`，沒有以 GPT-6.1 Sol 重跑四角色或量測企業帳戶實際扣抵。

CLI 結束摘要的 total 只包含主代理未快取 input 加 output，cached 另列；HTML 的整個 workflow 總量包含主代理、全部子代理與快取。兩種範圍不同，不應直接比對總量。

## 歷史估算器（命令不適用目前版本）

以下保留舊版設計供歷史參考。

## 舊版設計（歷史參考）

本文件說明四個測試工作流程(unit / tunit / integration / aspire)共用的 **Estimated Token Usage(估算式 token 用量)** 功能:它**估算**什麼、怎麼跑、輸出長怎樣、以及**明確的限制與已知偏差**。

> ⚠️ **這是估算,不是 billing。** Codex native SpawnAgent subagent 的全流程**真實** token 沒有可靠 truth source(實證確認:`get_goal` / `codex_hooks` / SpawnAgent 回傳 / agent 自報皆不暴露 token)。因此本功能**不回報正式用量**,改以「可見上下文(visible-context)」估算作**相對成本比較**。**不可用於計費、runtime truth,或任何 correctness gate。**

---

## A. 估算原理

估算器 `.codex/scripts/dotnet-testing-codex-full/estimate-token-usage.mjs` 在四階段完成後執行,流程:

1. 讀 `{testProjectDir}/.orchestrator/run-state.json`,取每個 phase(analyzer / writer / executor / reviewer)的 assignment(phase key 大小寫不敏感)。
2. 對每個 assignment,以**內建 chars 啟發式**對其**可觀測材料**估 token:
   - **input 側**:spawn payload、agent 定義 `.toml`、讀取的 source/skill/交接檔(`tokenEstimateInputs.readFiles`)、工具輸出片段(`toolOutputRefs`,如 build/test 輸出)。
   - **output 側**:寫出的測試檔與交接 artifact(`tokenEstimateInputs.writtenFiles` + artifact 本身)。
3. 每個 subagent 在自己的交接 artifact 寫入頂層 `tokenEstimateInputs`(`schemaVersion` / `estimateKind` / `readFiles` / `writtenFiles` / `toolOutputRefs`);**agent 本身不計算 token**,只登記「實際讀/寫了哪些可觀測檔案」,由估算器事後 tokenize。
4. 套用各角色 overhead 係數(analyzer 1.15 / writer 1.2 / executor 1.25 / reviewer 1.2)得 high range。
5. 輸出 `{testProjectDir}/.orchestrator/token-usage-estimate.json`。

**估算方法 = `chars-heuristic`(零相依,自含)**:以 `Math.ceil(字元數 / 3.6)` 粗估每段文字的 token(`estimator.method = "chars-heuristic"`、`charsPerToken = 3.6`)。**刻意不引入任何外部 tokenizer 套件**(gpt-tokenizer / tiktoken 等)—— 此功能定位為「相對成本比較的 optional telemetry、非 billing」,粗估即可,換來零 npm、零 node_modules、隨 `.codex/` 直接 `node` 執行。代價是絕對數字較糙(尤其**中文等非拉丁文字** chars/3.6 偏差較大),但「同一把尺量全部」→ **相對比較仍自洽**。`confidence` 上限即 `medium`(永不 `high`)。

---

## B. 執行方式

估算器隨 `.codex/` 一起部署（`.codex/scripts/dotnet-testing-codex-full/estimate-token-usage.mjs`），**零相依、無需 `npm install`**,有 Node.js 即可從消費者專案根目錄執行:

```bash
# 對某測試專案產生估算（不需要安裝任何套件）
node .codex/scripts/dotnet-testing-codex-full/estimate-token-usage.mjs --test-project <測試專案路徑>

# 範例（aspire net9 sample）
node .codex/scripts/dotnet-testing-codex-full/estimate-token-usage.mjs \
  --test-project samples/aspire/practice_aspire/tests/Practice.Aspire.AppHost.Tests

# EXP-00 之後可額外量測 main-thread Orchestrator contract。
# 此數值獨立呈現，不會改變既有 summary.totalTokensEstimated 語意。
node .codex/scripts/dotnet-testing-codex-full/estimate-token-usage.mjs \
  --test-project samples/unit/practice/tests/Practice.Core.Net10.Tests \
  --orchestrator-contract .codex/skills/dotnet-testing-orchestrator-unit/SKILL.md
```

輸出寫到 `<測試專案>/.orchestrator/token-usage-estimate.json`,並把該路徑印到 stdout。

> 四個 orchestrator SKILL 會在最終報告以 `### Estimated Token Usage` 區塊呈現此估算(估算不可得時顯示 unavailable),屬 optional telemetry,**不會擋住工作流程**。

---

## C. 輸出結構(摘要)

```jsonc
{
  "schemaVersion": 2,
  "schemaCompatibility": {
    "minimumReaderVersion": 1,
    "additiveOnlyFromVersion": 1
  },
  "workflow": "aspire",                 // 取自 run-state.workflow
  "estimator": { "method": "chars-heuristic", "charsPerToken": 3.6 },
  "summary": {
    "measurementScope": "subagent-visible-context",
    "estimateKind": "estimated",        // 或 "unavailable"
    "inputTokensEstimated":  123456,
    "outputTokensEstimated": 23456,
    "totalTokensEstimated":  146912,
    "range": { "low": 146912, "high": 178000 },  // high = 套 overhead
    "confidence": "medium"              // medium/low/unavailable（chars 粗估上限即 medium，取各 assignment 最低）
  },
  "orchestratorContractEstimate": {
    "estimateKind": "estimated",
    "path": ".codex/skills/dotnet-testing-orchestrator-unit/SKILL.md",
    "source": "cli",
    "tokensEstimated": 13413,
    "includedInSubagentSummaryTotal": false
  },
  "observations": {
    "fileReuse": {
      "countedOccurrences": 42,
      "uniqueFiles": 25,
      "repeatedOccurrences": 17,
      "repeatedTokensEstimated": 48000,
      "skippedDedupedOccurrences": 9,
      "dedupedOccurrencesByReason": {
        "deduped-contract-owned": 4,
        "deduped-canonical-artifact": 5
      }
    }
  },
  "phases": { "analyzer": {...}, "writer": {...}, "executor": {...}, "reviewer": {...} },
  "knownMissing": [ "Codex runtime hidden framing", "internal reasoning tokens",
                    "cached input token accounting", "actual provider billing usage",
                    "chars-heuristic（非真實 BPE，粗估；中文等非拉丁文字偏差較大）" ]
}
```

每個 assignment 另列 `inputEstimate` / `outputEstimate` 細項、`countedFiles`（逐檔 token 與 status）、`sharedArtifactDeduped`、`accountingDedupe`、`confidence`。`accountingDedupe` 分別揭露同 assignment 內被排除的 Agent definition read 與 canonical artifact write token，讓總量可對帳。

`summary.totalTokensEstimated` 保留既有口徑，只計 subagent visible context。`orchestratorContractEstimate` 是 main-thread Orchestrator Skill 檔案本身的獨立估算，不包含主對話、tool calls、hidden framing 或 reasoning，也不併入既有 summary total。

Estimator implementation v4 只排除兩種同 assignment accounting duplication：Agent TOML 已由 `agentDefinitionPath` 固定計入時，相同 `readFiles` 標示 `deduped-contract-owned`；canonical artifact 已由 `artifactTokens` 計入時，相同 `writtenFiles` 標示 `deduped-canonical-artifact`。它不做跨 assignment 或跨 phase 的全域去重。

`observations.fileReuse` 顯示同一可見檔案在不同 phase / assignment 的重複計數位置，用來找出 contract、Skill、source 與 artifact 重複載入熱點。上述 `deduped-*` occurrence 不進入 repeated-file 統計，但會另列於 `skippedDedupedOccurrences` 與 `dedupedOccurrencesByReason`。下游 phase 重新讀取上游 artifact 仍是實際可見成本並保留計數。`repeatedTokensEstimated` 是觀測值，不代表 provider cache miss，也不得直接從總量扣除。

---

## D. 限制與已知偏差(務必理解)

**結構性排除**(`knownMissing`,估算口徑本就不含):
- Codex runtime hidden framing、internal reasoning tokens、cached input accounting、實際 provider billing。

**已知系統性偏差**:
- **Orchestrator 主執行緒只估 contract 檔** — 提供 `--orchestrator-contract` 或 `run-state.orchestratorDefinitionPath` 時，可獨立估算 Orchestrator Skill 檔案；主對話、tool calls、hidden framing、reasoning 與其他 main-thread context 仍不在內。未提供路徑時此欄為 `unavailable`。
- **Repeated-file observation 不是 cache truth** — `observations.fileReuse` 只呈現 estimator 看見的檔案 occurrence；Codex/provider 是否命中 cache 不可觀察，因此不得把 repeated estimate 當成實際可省 token。
- **同 assignment ownership 去重不是 cache 模擬** — v4 只排除 estimator 自己已固定計入、又被同一 assignment manifest 重列的 Agent TOML 或 canonical artifact；不同 assignment / phase 的真實 read 不會被扣除。
- **two-step(分批 Writer)去重** — 同 phase 多 assignment 共用同一 merged 交接 artifact 時,估算器以 `seenArtifacts` 對「artifact 衍生 token」去重(每個 assignment 仍各計 agentToml + payload),避免 ~Nx 過計。

**口徑提醒**:此估算數量級(visible-context,約 10^5)與 Claude 版的「含 cache 讀取 runtime 真實量」(約 10^6)**不可直接相等**;判讀以「內部自洽 + 落在可見上下文合理區間」為準,而非追平 Claude。

---

## E. 失敗與降級行為

| 情況 | 行為 |
|---|---|
| `run-state.json` 不存在/不可讀 | 輸出 `estimateKind: "unavailable"` + `reason`,不報錯中止工作流程 |
| `tokenEstimateInputs` 缺漏 | 走 artifact fallback(以 artifact + `testFilePaths` 等推估),`confidence` 降為 `low` |
| 個別檔案不存在 | 該檔計 0、status `missing`,不影響其他項 |

**估算缺漏絕不阻塞工作流程,也絕不作為 correctness gate** —— 這是設計硬規則。
