# dotnet-testing Agent Orchestration for Codex

這個 repo 提供 **Codex 原生 Subagent** 的 .NET 測試工作流程，透過 Agent Orchestration 自動化完成測試。
核心採 **1 + 4 模型**：1 個 Orchestrator Skill 指揮 4 個專用 Subagent，依序完成 Analyzer → Writer → Executor → Reviewer 的完整測試流程——從分析目標程式碼、撰寫測試、執行驗證，到審查品質，全程自動化。

> 本版由 [`dotnet-testing-agent-orchestration-claude`](https://github.com/kevintsengtw/dotnet-testing-agent-orchestration-claude) 經 migrate-to-codex 轉換，並在 Codex 平台多輪實驗優化驗證而成。

- [dotnet-testing Agent Orchestration for Codex](#dotnet-testing-agent-orchestration-for-codex)
  - [目前涵蓋範圍](#目前涵蓋範圍)
  - [v1.3.1 重要變更](#v131-重要變更)
  - [v1.3.0 重要變更](#v130-重要變更)
  - [架構概覽](#架構概覽)
  - [系統需求](#系統需求)
  - [安裝與環境設定](#安裝與環境設定)
    - [步驟 1：安裝本 repo 的 `.codex/` 內容](#步驟-1安裝本-repo-的-codex-內容)
    - [步驟 2：安裝外部 Agent Skills](#步驟-2安裝外部-agent-skills)
    - [步驟 3：確認完整 workspace 目錄結構](#步驟-3確認完整-workspace-目錄結構)
    - [步驟 4：驗證安裝](#步驟-4驗證安裝)
  - [Codex sandbox 與 NuGet restore](#codex-sandbox-與-nuget-restore)
  - [快速開始](#快速開始)
  - [練習專案](#練習專案)
  - [與 Claude 版的差異](#與-claude-版的差異)
  - [文件](#文件)

---

## 目前涵蓋範圍

| 測試類型 | Orchestrator Skill | 狀態 |
|---|---|---|
| Unit Testing | `dotnet-testing-orchestrator-unit` | ✅ 已釋出 |
| TUnit Testing | `dotnet-testing-orchestrator-tunit` | ✅ 已釋出 |
| Integration Testing | `dotnet-testing-orchestrator-integration` | ✅ 已釋出 |
| Aspire Testing | `dotnet-testing-orchestrator-aspire` | ✅ 已釋出 |

> 四種工作流程**共用同一個 1 + 4 模型**(1 Orchestrator Skill + 4 Subagent、Codex 原生 SpawnAgent、Analyzer → Writer → Executor → Reviewer);差別在**執行模型、測試粒度與技術棧**,如下。

> **Agent 預設模型**：`.codex/agents/` 內全部 16 個 agent TOML 預設使用 `gpt-5.6-sol`，推理強度為 `medium`。GPT-5.6 Sol 與 GPT-5.5 的標準 API 單位費率相同；完整的 GPT-5.4、GPT-5.5、GPT-5.6 Sol／Terra／Luna 計費比照表見 [模型計費與預設設定](docs/guides/model-pricing.md)。

> **Unit 工作流程**:使用者可在一開始以 Markdown、free text、表格、JSON 或混合格式提供測試情境與測試資料。合理內容優先於 Analyzer 自行補充的情境，只有個別情境不合理或不正確時才能逐項拒絕。若已安裝外部 `unit-test-scenarios`，可先呼叫 `$unit-test-scenarios` 產生情境，再交給 `$dotnet-testing-orchestrator-unit`。

> **TUnit 工作流程**:執行模型為 **`dotnet run`**(Source Generator / Microsoft.Testing.Platform,非 `dotnet test`),產出 `OutputType=Exe`、不含 `Microsoft.NET.Test.Sdk`;支援 `[Test]`/`[Arguments]`/`[MethodDataSource]`、exact project path、xUnit→TUnit 遷移與 Validator。呼叫 `$dotnet-testing-orchestrator-tunit`;練習素材見 `samples/tunit/practice_tunit/`,細節見 `docs/guides/tunit-testing.md`。

> **整合測試工作流程**:執行模型為 **`dotnet test`**(xUnit,含 `Microsoft.NET.Test.Sdk`、無 `OutputType=Exe`)+ **Docker / Testcontainers**;以 **HTTP endpoint 為粒度**,透過 `WebApplicationFactory<Program>` 發真實 HTTP 請求,HTTP 斷言用 **AwesomeAssertions.Web**(`Be200Ok`/`Be404NotFound` 等),錯誤格式驗 `ProblemDetails`/`ValidationProblemDetails`,容器化資料庫(PostgreSQL/SQL Server/MongoDB/Redis)搭配 Respawn 資料隔離。**需 Docker 環境**。呼叫 `$dotnet-testing-orchestrator-integration`;練習素材見 `samples/integration/practice_integration/`,細節見 `docs/guides/integration-testing.md`。

> **Aspire 工作流程**:執行模型為 **AppHost / `DistributedApplicationTestingBuilder`**(Aspire.Hosting.Testing,**非** `WebApplicationFactory`)+ xUnit **`dotnet test --blame-hang-timeout`**(8.x/9.x=`10m`、13.x=`15m`,非 `dotnet run`);以 **HTTP endpoint 為粒度**,`app.CreateHttpClient("name")` 名稱對齊 AppHost `AddProject("name")`,容器由 **Aspire AppHost 宣告式管理**(非程式化 Testcontainers)+ Respawn 資料隔離。Analyzer 分析 **AppHost Resource graph**;Writer 只載入單一 `aspire-testing` 技能。**需 Docker 環境**(容器由 AppHost 啟動,無 InMemory 退路;`Aspire.AppHost.Sdk` 9.0+ 為 NuGet,免安裝 workload)。呼叫 `$dotnet-testing-orchestrator-aspire`;練習素材見 `samples/aspire/practice_aspire/`,細節見 `docs/guides/aspire-testing.md`。

---

## v1.3.1 重要變更

四套工作流程都提供本次主代理與子代理的實際 token 用量 HTML；本版同時完成 runtime 隔離、收尾與環境前置檢查修正。完整內容見 [v1.3.1 更新細節](docs/guides/v1.3.1-release-notes.md) 與 [CHANGELOG](CHANGELOG.md)。

- **完整離線 HTML**：列出未快取輸入、快取輸入、輸出、含快取總量、請求數及收集狀態；主代理回合結束且三次快照一致後自動更新，保留資料缺漏與底層診斷。
- **絕對路徑交付**：最終回覆尾端提供可點擊的 HTML 絕對路徑、可複製的原生路徑及 file URL，維持既定最終報告區塊與測試數字。
- **選用 Standard credit 換算**：新增 `gpt-6.1-sol`，保留 `gpt-6-sol`、`gpt-6-luna`、`gpt-6-astra` 及其他受支援模型；採本版註明日期的費率快照。服務模式缺漏時標示 Standard 前提試算；未知模型、非 Standard 模式或資料缺漏不提供合計。結果不代表帳戶實際扣抵或 API key 費用。
- **工作流程修正**：Unit／TUnit 使用自有 run-state 與 validators；Unit 修正 Coverage 型別比對與 blocked 收尾，TUnit 修正方法識別交接及 gate 拒絕後的 deterministic closeout；Integration、Aspire 完成交接、執行證據與顯示契約修正。
- **NuGet 與 Docker 前置檢查**：四套各自具有 NuGet sandbox preflight，Analyzer 前驗證 restore 環境；Aspire 另檢查 Docker daemon。沿用既有 NuGet 設定與預設快取，`NUGET_PACKAGES` 維持選用。Unit／TUnit 依工具政策處理必要單次核准，仍保留各自 runner、原始失敗與既定重試上限。
- **保留式安裝**：installer 預設只安裝到目前專案的 `.codex/`，不再無條件覆寫使用者層 `~/.codex/config.toml`；必要設定衝突時在寫入資產前 fail closed，不預設開啟 sandbox 網路。
- **公開資產與依賴**：codex-full 公開資產共 59 支 runtime scripts；Unit runtime 目錄共 16 個零相依 JavaScript 模組。外部技術型 Skills 鎖定 `dotnet-testing-agent-skills v2.4.5`，29 個 Skill 名稱與數量不變。
- **驗收與模型**：四套完整 HTML、GPT-6.1 Sol 換算與絕對路徑交付均完成人工驗收；Aspire 另完成 .NET 10／9／8 指定情境驗收，保留 .NET 8 的已接受警告。正式 profiles 維持 `gpt-5.6-sol／medium`。

---

## v1.3.0 重要變更

v1.3.0 保留四套各自獨立的 **1 Orchestrator Skill + 4 Agent TOML** 架構，主要重整 Unit 工作流程的責任邊界與 deterministic runtime：

- **模型回到測試判斷**：Analyzer、Writer、Executor、Reviewer 分別負責行為分析、測試實作、失敗診斷與語意審查，不再用累加提示規則承擔 machine truth
- **Unit deterministic runtime**：新增 phase state、artifact normalization、coverage decision、build/test evidence、project integrity、run archive 與 final projection，共 9 個零相依 JavaScript 模組
- **自然 artifact shape**：接受精簡或豐富的合理產出，optional prose 不作 gate；客觀矛盾、缺少必要 identity 或 evidence 才 fail closed
- **完整 Unit 多 target 收斂**：Analyzer／Reviewer 可同批派遣，一般與 Coverage repair 的 Writer／Executor 依 target 循序；共同 timing 取最晚完成邊界，最後產生單一 ordered report
- **可稽核 blocked 與 repair**：無法解析的 method selector 走四角色 blocked chain；final report 只從 sealed Executor artifact 投影實際 `repairHistory`
- **上游相容更新**：shared technical Skills 相容基準更新為 `dotnet-testing-agent-skills v2.4.2`（commit `715400f6d64e321d2faa4d8164643b412118f9c8`）
- **單一公開白名單**：兩條公開同步 workflow 共用 `public-release-manifest.json`，公開 snapshot 包含 16 agents、5 Codex-specific Skills 與 22 支 runtime scripts
- **Full runtime 所有權邊界**：22 支正式腳本集中於 `.codex/scripts/dotnet-testing-codex-full/`；安裝與公開同步只替換這個命名空間，保留其他外掛的 scripts
- **Release 覆寫防護**：一般 PR merge 不得刪除既有同版 Release；只有手動執行且明確設定 `replace_existing=true` 才能重建

TUnit、Integration、Aspire 保留各自既有 runner 與工作流程架構；本版只同步 v2.4.2 必要的 AwesomeAssertions API 修正，不把 Unit runtime 結構直接套用到其他三套流程。

## v1.2.0 重要變更

v1.2.0 保留四個 Orchestrator Skill 名稱、每 target 單一 Writer topology 與各 framework runner，主要調整 shared Skill 發布邊界、可重建安裝與 runtime telemetry：

- **Shared Skills 不再內含**：29 個技術型 `dotnet-testing-*` Skills 與可選的 `unit-test-scenarios` 改由 consumer deployment 安裝到 `.agents/skills/`；`.codex/skills/` 只發布 `dotnet-test` 與四個 Orchestrator
- **外部依賴可重建**：正式來源以 tag／commit lock 固定，避免 orchestration repo 內含的 shared Skill 副本與上游版本漂移
- **Analyzer timing fail closed**：四套流程都在 dispatch、接受與 artifact ready 的實際邊界記錄 telemetry；缺少必要時間欄位時停止，不以事後推算補值
- **Unit Reviewer 三值裁決**：Unit reviewer-result 必須明確輸出 `pass`、`fail` 或 `blocked`，且與使用者情境 coverage、issues 與 Executor truth 一致
- **固定 Agent 模型**：16 個 Subagent 預設使用 `gpt-5.6-sol` 與 `medium` reasoning；可依 consumer 需求覆寫
- **完整功能驗證**：Unit、TUnit、Integration、Aspire 共 12 案，289 passed、0 failed、0 skipped；另有 6 個 failure-contract cases 全部通過

升級時應完整替換 `.codex/` workflow assets，移除舊版放在 `.codex/skills/` 的 shared Skill 副本，再由 consumer deployment 將外部 Skills 安裝到 `.agents/skills/`。

完整變更與驗證證據見 [CHANGELOG.md](CHANGELOG.md)。

### v1.1.0 延續契約

v1.1.0 保留四個 Orchestrator Skill 名稱、1 + 4 階段與各 framework runner，主要改進工作流程的 Token Usage、隔離與可稽核性：

- **每個 target 固定一個 Writer**：Unit、TUnit、Integration、Aspire 都不再依 method、scenario、endpoint、Resource 或預估輸出大小 split。多 target 仍是一個 target 對應一個 Writer
- **不限制 Analyzer 案例數**：唯一 Writer 必須承接本次 Analyzer 接受的全部 scenarios；若 context/output limit 無法完成，attempt fail closed，不恢復 split、不靜默刪減
- **Fresh/self-contained roles**：正式角色固定 `fork_turns: "none"`，禁止 prior-attempt artifacts、workspace 外部 memory 與未核准 handoffs
- **更嚴格的 truth chain**：canonical analysis／writer／executor／reviewer artifacts、scenario/endpoint/Resource provenance、Executor runtime evidence、Reviewer acceptance 與 strict `run-state.json` timing 必須一致
- **Runtime validators 隨 `.codex/` 出貨**：Unit／TUnit 各自 runtime 包含本地 gates；`.codex/scripts/dotnet-testing-codex-full/validators/` 保留 Integration／Aspire 的 gates 與中央相容檔
- **不使用 RAG**：正式流程只使用 assigned source/project、repo-local Skills 與本次 run 核准的 canonical handoffs

升級既有安裝時，應完整更新本 repo 的 `.codex/agents/`、4 個 Orchestrator Skills、`.codex/scripts/dotnet-testing-codex-full/` 與 `.codex/config.toml`，不要只複製單一 `SKILL.md`。

Token 改善來自 controlled comparisons；詳細數據、品質結論與比較限制見 [CHANGELOG.md](CHANGELOG.md)。這些歷史數字不是 provider billing truth。

---

## 架構概覽

Orchestrator Skill 接收使用者指令後，透過 Codex 原生 **SpawnAgent** 依序調度四個 Subagent：

```text
Orchestrator Skill（dotnet-testing-orchestrator-{unit,tunit,integration,aspire}）
    ├── Analyzer Subagent  （分析目標類別/端點/AppHost Resource、依賴項、需要的測試技術）
    ├── Writer Subagent    （載入對應 Skills，產生符合最佳實踐的測試程式碼）
    ├── Executor Subagent  （建置並執行測試，處理編譯/失敗的修正迴圈）
    └── Reviewer Subagent  （審查命名、斷言、覆蓋率、框架合規性）
```

四種工作流程各有自己的一套 Orchestrator + 4 Subagent；呼叫對應的 `$dotnet-testing-orchestrator-*` 即進入該流程。

對單一 target 而言，正式 dispatch 恆為 Analyzer 1 + Writer 1 + Executor 1 + Reviewer 1。不同 targets 可依工作流程規則並行或循序，但同一 target 不會再拆成多個 Writers。

Unit 一次處理多個 targets 時，Analyzer／Reviewer 可同批派遣，一般與 Coverage repair 的 Writer／Executor 依 target 順序逐一執行，避免共用 test project 同時寫入或 build/test。`run-state.json` 以所有 targets 的最晚完成時間關閉共同 phase；最後依原始 target 順序產生一份 JSON 與一份固定格式 Markdown。

每個階段依序完成；Reviewer 提出改善建議後，**由使用者確認**才會啟動 Writer + Executor 修改流程。

`run-state.json` 是官方 wall-clock timing truth；Executor artifact 是 build/test runtime truth。Reviewer 必須執行品質審查，但不自行重跑測試取代 Executor evidence。

**Writer 為何需要 Agent Skills**：Writer 撰寫測試時會依 Analyzer 判定的技術需求，載入對應的 Agent Skill（例如 `nsubstitute-mocking`、`datetime-testing-timeprovider`、`filesystem-testing-abstractions`）以確保輸出符合最佳實踐。這些技術型 Skill **不內含於本 repo**，需另行安裝（見步驟 2）。

---

## 系統需求

| 項目 | 版本 | 說明 |
|---|---|---|
| Codex | 支援原生 SpawnAgent / multi-agent | 執行 1+4 工作流程 |
| .NET SDK | 8.0 / 9.0 / 10.0 | 被測試專案的目標框架 |
| Docker | 任一近期版本 | **integration / aspire 工作流程必需**（啟動真實容器；unit / tunit 不需要）。aspire 另以 `Aspire.AppHost.Sdk` NuGet 提供,免安裝 Aspire workload |
| Node.js | 任一近期 LTS | 執行 Unit／TUnit 各自 runtime 內的 run-state 與 validators；Integration／Aspire 使用根共用檔。全部為零相依 scripts，無需 `npm install` |

---

## 安裝與環境設定

本 repo 發佈的是 **Orchestrator 契約本身**（4 個 Orchestrator Skill + 16 個 Subagent + `dotnet-test`）。完整可運作環境 = 本 repo 內容 **＋** 外部 Agent Skills（步驟 2）。

### 步驟 1：安裝本 repo 的 `.codex/` 內容

從 consumer 專案根目錄執行 installer。預設目標固定為目前工作目錄的 `.codex/`；`--repo-root`／`-RepoRoot` 指向下載或 clone 的本 release：

```bash
cd C:/work/MyProject
node C:/tools/dotnet-testing-agent-orchestration-codex/scripts/install-codex-assets.mjs --repo-root C:/tools/dotnet-testing-agent-orchestration-codex
```

```powershell
Set-Location C:/work/MyProject
pwsh -File C:/tools/dotnet-testing-agent-orchestration-codex/scripts/install-codex-assets.ps1 -RepoRoot C:/tools/dotnet-testing-agent-orchestration-codex
```

`--codex-home`／`-CodexHome` 只供明確指定其他目的地；預設安裝絕不寫入 `~/.codex/`。目標 `config.toml` 不存在時建立；存在時只補產品必要鍵，保留其他內容。必要鍵衝突時在寫入任何資產前停止並列出衝突，不靜默覆寫。安裝內容含 **5 個 Codex-specific Skill + 16 個 Subagent**（unit 的 4 個 `dotnet-testing-*` + tunit / integration / aspire 各 4 個 `dotnet-testing-advanced-*-*`）：

```text
.codex/
├── agents/
│   ├── dotnet-testing-analyzer.toml            ← unit
│   ├── dotnet-testing-writer.toml
│   ├── dotnet-testing-executor.toml
│   ├── dotnet-testing-reviewer.toml
│   ├── dotnet-testing-advanced-tunit-*.toml         （analyzer/writer/executor/reviewer）
│   ├── dotnet-testing-advanced-integration-*.toml   （analyzer/writer/executor/reviewer）
│   └── dotnet-testing-advanced-aspire-*.toml        （analyzer/writer/executor/reviewer）
├── config.toml
├── scripts/
│   └── dotnet-testing-codex-full/
│       ├── asset-manifest.json                       （Full runtime 所有權清單）
│       ├── run-state.mjs
│       ├── aspire-runtime/                           （Aspire preflight、獨立用量 HTML 與最終 renderer）
│       ├── integration-runtime/                      （Integration NuGet preflight）
│       ├── tunit-runtime/                            （TUnit result renderer + NuGet preflight）
│       ├── unit-runtime/                             （Unit runtime，16 支）
│       └── validators/                               （Integration／Aspire 原有 runtime gates 與相容檔）
└── skills/
    ├── dotnet-test/
    ├── dotnet-testing-orchestrator-unit/
    ├── dotnet-testing-orchestrator-tunit/
    ├── dotnet-testing-orchestrator-integration/
    └── dotnet-testing-orchestrator-aspire/
```

### 步驟 2：安裝外部 Agent Skills

Writer 需要的各技術 Skill 由獨立 repo [`dotnet-testing-agent-skills`](https://github.com/kevintsengtw/dotnet-testing-agent-skills) 的固定 Release 提供。可選的前置情境 Skill 不內含於本 repo，consumer deployment 必須從公開 repo [`kevintsengtw/unit-test-scenarios`](https://github.com/kevintsengtw/unit-test-scenarios) 抓取。兩者取得後放入 workspace 的 **`.agents/skills/`**。

本 repository 不發布 standalone shared Skills installer。consumer 必須另行從 `dotnet-testing-agent-skills` 的鎖定 Release 安裝 shared Skills；目前鎖定版本為 `v2.4.5`（commit `a4908967ef8fe63ad2fe275df1df3c015ec51a4c`）。

`unit-test-scenarios` 的抓取來源固定為公開 repo 的 `skills/unit-test-scenarios/`，目的地為 consumer workspace 的 `.agents/skills/unit-test-scenarios/`。目前驗證基準 commit 為 `d00501984383dfd0b111c33a091c48af20abec55`；orchestration release 不得攜帶該 Skill 的副本。

安裝後，`.agents/skills/` 下會新增以下 **29 個**技術型 Agent Skill：

```text
dotnet-testing/
dotnet-testing-advanced/
dotnet-testing-advanced-aspire-testing/
dotnet-testing-advanced-aspnet-integration-testing/
dotnet-testing-advanced-testcontainers-database/
dotnet-testing-advanced-testcontainers-nosql/
dotnet-testing-advanced-tunit-advanced/
dotnet-testing-advanced-tunit-fundamentals/
dotnet-testing-advanced-webapi-integration-testing/
dotnet-testing-advanced-xunit-upgrade-guide/
dotnet-testing-autodata-xunit-integration/
dotnet-testing-autofixture-basics/
dotnet-testing-autofixture-bogus-integration/
dotnet-testing-autofixture-customization/
dotnet-testing-autofixture-nsubstitute-integration/
dotnet-testing-awesome-assertions-guide/
dotnet-testing-bogus-fake-data/
dotnet-testing-code-coverage-analysis/
dotnet-testing-complex-object-comparison/
dotnet-testing-datetime-testing-timeprovider/
dotnet-testing-filesystem-testing-abstractions/
dotnet-testing-fluentvalidation-testing/
dotnet-testing-nsubstitute-mocking/
dotnet-testing-private-internal-testing/
dotnet-testing-test-data-builder-pattern/
dotnet-testing-test-naming-conventions/
dotnet-testing-test-output-logging/
dotnet-testing-unit-test-fundamentals/
dotnet-testing-xunit-project-setup/
```

### 步驟 3：確認完整 workspace 目錄結構

完成步驟 1、2 後，workspace 中 `.codex/` 與 `.agents/` 的預期結構（節錄）：

```text
.codex/
├── agents/                       ← 本 repo 內建（16 個 subagent）
│   ├── dotnet-testing-{analyzer,writer,executor,reviewer}.toml            ← unit
│   ├── dotnet-testing-advanced-tunit-{analyzer,writer,executor,reviewer}.toml
│   ├── dotnet-testing-advanced-integration-{analyzer,writer,executor,reviewer}.toml
│   └── dotnet-testing-advanced-aspire-{analyzer,writer,executor,reviewer}.toml
├── config.toml                   ← 本 repo 內建
├── scripts/
│   └── dotnet-testing-codex-full/ ← 本 repo 內建（59 支 Full runtime scripts）
└── skills/
    ├── dotnet-test/                              ← 本 repo 內建
    ├── dotnet-testing-orchestrator-unit/         ← 本 repo 內建
    ├── dotnet-testing-orchestrator-tunit/        ← 本 repo 內建
    ├── dotnet-testing-orchestrator-integration/  ← 本 repo 內建
    └── dotnet-testing-orchestrator-aspire/       ← 本 repo 內建
.agents/
└── skills/
    ├── unit-test-scenarios/                      ← setup 從公開 repo 抓取（非內含資產）
    ├── dotnet-testing/                           ← 步驟 2 安裝
    ├── dotnet-testing-unit-test-fundamentals/     ← 步驟 2 安裝
    └── …（其餘技術型 skill）
```

### 步驟 4：驗證安裝

- `.codex/agents/` 有 16 個 `.toml`（unit 的 4 個 `dotnet-testing-*` + tunit / integration / aspire 各 4 個 `dotnet-testing-advanced-*-*`）
- `.codex/skills/` 含 4 個 orchestrator skill（`dotnet-testing-orchestrator-{unit,tunit,integration,aspire}`）的 `SKILL.md`
- `.codex/skills/` 只含五個 Codex-specific Skills；setup 會從兩個外部來源抓取 `unit-test-scenarios` 與 29 個技術型 skill 到 `.agents/skills/`
- `.codex/scripts/dotnet-testing-codex-full/` 含 `unit-runtime/`、`tunit-runtime/`，以及供 Integration／Aspire 使用的根 `run-state.mjs` 與 `validators/`
- NuGet preflight 不要求 `.codex/config.toml` 含 `NUGET_PACKAGES`；若已指定自訂快取，路徑必須是可讀的絕對目錄
- 四個 Orchestrator 中的 `node .codex/scripts/dotnet-testing-codex-full/...` 路徑全部存在
- 在 Codex 呼叫任一 `$dotnet-testing-orchestrator-{unit,tunit,integration,aspire}` 時能正確 SpawnAgent 四階段

---

## Codex sandbox 與 NuGet restore

Codex 在 `workspace-write` sandbox 中可能無法連到外部 NuGet feed。四套 workflow 會在 Analyzer 前對指定專案執行 `dotnet restore --ignore-failed-sources`。未設定 `NUGET_PACKAGES` 時，直接沿用 NuGet 的設定與預設快取；使用者可以正常啟動 CLI，不需要先修改 `.codex/config.toml` 或額外輸入 NuGet CLI flags。

若已有 `NUGET_PACKAGES`，preflight 會確認該目錄為可讀的絕對路徑，並以 `--packages` 使用指定快取；installer 不加入或覆寫這個選用設定。既有 `NuGet.Config` 的 `globalPackagesFolder` 在未指定變數時維持有效，選擇方式見 [NuGet 快取文件](https://learn.microsoft.com/en-us/nuget/consume-packages/managing-the-global-packages-and-cache-folders)。如果快取與允許的 feeds 無法完成 restore，流程立即停止並保留實際錯誤，不會消耗 Analyzer、Writer、Executor 或 Reviewer。

Unit／TUnit 會依本次工具的權限政策處理必要單次核准；政策允許且使用者核准時，仍執行各自原有命令與 runner，保留失敗紀錄及重試上限。政策不允許或核准遭拒時停止，不自行修改全域設定、建立固定快取或擴大重試。Integration／Aspire 保留各自前置檢查與執行契約，不因共通 NuGet 原則改用 Unit 的 runner。

專案層 `.codex/config.toml` 與 `.codex/agents/` 是 Codex 正式支援的 project-scoped 設定。首次從 consumer 專案根目錄啟動 Codex 時會出現信任提示，必須選擇信任；未信任時專案層 `.codex/` 會被忽略，常見症狀是 workflow Skill 或 agents 找不到，而且目前可能沒有明確錯誤訊息。相關追蹤見 [openai/codex#10389](https://github.com/openai/codex/issues/10389)。

官方 repository Skill discovery 路徑是 `.agents/skills/`。本產品目前將 Orchestrator 放在 `.codex/skills/`；這個布局已有目前 CLI 的實際驗證，但不能視為 OpenAI Docs 明文保證的 Skill 路徑。`.codex/scripts/` 由 Orchestrator 使用明確相對路徑呼叫，不依賴自動 discovery。

如果 global packages cache 沒有必要套件，優先使用企業核准的內部 NuGet feed。只有組織政策允許對外網路時，才在 consumer 專案的 `.codex/config.toml` 選用：

```toml
sandbox_mode = "workspace-write"

[sandbox_workspace_write]
network_access = true
```

產品不會自動加入上述設定，也不會修改使用者層 `~/.codex/config.toml`。企業管理的 `requirements.toml` 或雲端政策仍具約束力。

---

## 快速開始

在 Codex 中提供 workspace root、被測專案目錄或 `.csproj`、target 檔案與 class／method／Controller／endpoint scope，以及既有測試專案的 exact `.csproj`。只有明確沒有測試專案時才要求建立。Skill path 由 Orchestrator 從本次 workspace 解析，不由使用者輸入。

```text
呼叫 $dotnet-testing-orchestrator-unit，為 OrderService 的 CalculateTotal 方法撰寫單元測試。
Workspace root：C:/work/MyProject
Source project：C:/work/MyProject/src/MyProject.Core/MyProject.Core.csproj
Target file：C:/work/MyProject/src/MyProject.Core/Services/OrderService.cs
Target class：MyProject.Core.Services.OrderService
Scope：method CalculateTotal
Test project：C:/work/MyProject/tests/MyProject.Core.Tests/MyProject.Core.Tests.csproj
```

工作流程會：分析 `OrderService` → 載入對應 Skills 撰寫測試 → 建置執行（含修正迴圈）→ 審查並回報；最後呈現固定格式的結果報告（測試總覽、Reviewer 結論、各階段耗時等）。

同一 target 無論 Analyzer 產生多少合理 scenarios，都只派發一個 Writer。若一次指定多個 targets，每個 target 各自有一個 Writer；Unit 的 Writer／Executor 依 target 順序執行並產生單一 ordered final report，Integration/Aspire 在共享測試專案與容器資源時也會採用較保守的循序執行以保護 correctness。

也可以先呼叫 `$unit-test-scenarios` 產生測試情境，或直接在同一段提示詞提供任意格式的情境與資料；unit workflow 會先驗證並保留合理的使用者輸入，再補足必要案例。

---

## 練習專案

本 repo 為四種工作流程各內含一組練習素材（`samples/` 下;各測試專案僅含 csproj scaffold,**不含預先產生的測試碼**——測試由工作流程產生,`src` 為待測範例）：

| 工作流程 | 練習素材 | 待測標的 |
|---|---|---|
| unit | `samples/unit/practice/` | 純邏輯、`TimeProvider`、`IFileSystem`、FluentValidation、介面 mock、legacy 靜態依賴等(net8/net10 變體) |
| tunit | `samples/tunit/practice_tunit/` | `LibraryMemberValidator` 等 TUnit 標的(net8/9/10 變體) |
| integration | `samples/integration/practice_integration/` | `OrdersController`(PostgreSQL)+ `CustomerActivitiesController`(MongoDB)+ FluentValidation(net8/9/10 變體) |
| aspire | `samples/aspire/practice_aspire/` | Aspire AppHost + `BookingsController`(SQL Server + Redis)+ FluentValidation(net8/9/10 變體) |

範例：

```text
# unit
Workspace root：C:/work/dotnet-testing-agent-orchestration-codex-lab
Source project：samples/unit/practice/src/Practice.Core.Net8/Practice.Core.Net8.csproj
Target file：samples/unit/practice/src/Practice.Core.Net8/Services/SubscriptionService.cs
Target class：Practice.Core.Net8.Services.SubscriptionService
Scope：class（全部公開方法）
Test project：samples/unit/practice/tests/Practice.Core.Net8.Tests/Practice.Core.Net8.Tests.csproj

# tunit
Workspace root：C:/work/dotnet-testing-agent-orchestration-codex-lab
Source project：samples/tunit/practice_tunit/src/Practice.TUnit.Core/Practice.TUnit.Core.csproj
Target file：samples/tunit/practice_tunit/src/Practice.TUnit.Core/Services/BookCatalog.cs
Target class：Practice.TUnit.Core.Services.BookCatalog
Scope：class（全部公開方法）
Test project：samples/tunit/practice_tunit/tests/Practice.TUnit.Core.Tests/Practice.TUnit.Core.Tests.csproj

# integration（需 Docker）
Workspace root：C:/work/dotnet-testing-agent-orchestration-codex-lab
API project：samples/integration/practice_integration/src/Practice.Integration.WebApi/Practice.Integration.WebApi.csproj
Target：OrdersController 的全部端點
Test project：samples/integration/practice_integration/tests/Practice.Integration.WebApi.Tests/Practice.Integration.WebApi.Tests.csproj

# aspire（需 Docker）
Workspace root：C:/work/dotnet-testing-agent-orchestration-codex-lab
API project：samples/aspire/practice_aspire/src/Practice.Aspire.WebApi/Practice.Aspire.WebApi.csproj
AppHost project：samples/aspire/practice_aspire/src/Practice.Aspire.AppHost/Practice.Aspire.AppHost.csproj
AppHost service name：bookingapi
Target：BookingsController 的全部端點
Test project：samples/aspire/practice_aspire/tests/Practice.Aspire.AppHost.Tests/Practice.Aspire.AppHost.Tests.csproj
```

---

## 與 Claude 版的差異

- **v1.3.1：實際 token 用量 HTML** — 四套各自收集本次 Codex session 的 runtime 用量，提供完整離線 HTML、絕對路徑及選用 Standard credit 換算，含 `gpt-6.1-sol`。需要可讀的 session 與 state SQLite；優先使用 Node 內建唯讀介面，現有 Python 3 為備援。不支援時明示原因，保留原測試與計時結果；四套功能人工驗收均已完成。
- **Dispatch 機制**：Codex 原生 SpawnAgent（非 Claude Agent tool）；額外產出 `run-state.json` 可稽核狀態檔。
- **角色隔離**：正式 roles 使用 self-contained context，並以 attempt-isolation／role-read-scope gates 拒絕 prior-attempt、外部 memory 與 unrelated orchestration reads。
- **產出非決定性**：同一輸入下，Analyzer scenario 數、測試數、技術型 Skill 選擇與 wall-clock 可能有 run-to-run 波動；Writer topology 固定為每 target 一個，不屬於可波動項目。

---

## 文件

- 版本與變更：[CHANGELOG.md](CHANGELOG.md)
- v1.3.1 更新細節：[docs/guides/v1.3.1-release-notes.md](docs/guides/v1.3.1-release-notes.md)
- 安裝與環境：[docs/SETUP.md](docs/SETUP.md)
- 架構總覽：[docs/architecture/overview.md](docs/architecture/overview.md)
- Token 用量、credit 與歷史估算說明：[docs/guides/token-usage-estimation.md](docs/guides/token-usage-estimation.md)
- 技術型 Skills：[dotnet-testing-agent-skills](https://github.com/kevintsengtw/dotnet-testing-agent-skills)
- Claude 版（上游）：[dotnet-testing-agent-orchestration-claude](https://github.com/kevintsengtw/dotnet-testing-agent-orchestration-claude)
