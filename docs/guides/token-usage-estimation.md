# Estimated Token Usage 估算使用指南

本文件說明四個測試工作流程(unit / tunit / integration / aspire)共用的 **Estimated Token Usage(估算式 token 用量)** 功能:它**估算**什麼、怎麼跑、輸出長怎樣、以及**明確的限制與已知偏差**。

> ⚠️ **這是估算,不是 billing。** Codex native SpawnAgent subagent 的全流程**真實** token 沒有可靠 truth source(實證確認:`get_goal` / `codex_hooks` / SpawnAgent 回傳 / agent 自報皆不暴露 token)。因此本功能**不回報正式用量**,改以「可見上下文(visible-context)」估算作**相對成本比較**。**不可用於計費、runtime truth,或任何 correctness gate。**

---

## A. 估算原理

估算器 `.codex/scripts/estimate-token-usage.mjs` 在四階段完成後執行,流程:

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

估算器隨 `.codex/` 一起部署（`.codex/scripts/estimate-token-usage.mjs`），**零相依、無需 `npm install`**,有 Node.js 即可從消費者專案根目錄執行:

```bash
# 對某測試專案產生估算（不需要安裝任何套件）
node .codex/scripts/estimate-token-usage.mjs --test-project <測試專案路徑>

# 範例（aspire net9 sample）
node .codex/scripts/estimate-token-usage.mjs \
  --test-project samples/aspire/practice_aspire/tests/Practice.Aspire.AppHost.Tests

# EXP-00 之後可額外量測 main-thread Orchestrator contract。
# 此數值獨立呈現，不會改變既有 summary.totalTokensEstimated 語意。
node .codex/scripts/estimate-token-usage.mjs \
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
