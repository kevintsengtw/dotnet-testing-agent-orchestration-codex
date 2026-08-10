# Changelog

所有重要變更都記錄於此。格式參考 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.0.0/)。

> 版本規則：四種測試工作流程（unit / integration / aspire / tunit）全部完成才升至 `v1.0.0`；在此之前為 `v0.0.x` 預覽版。文件類修改不更新版本號，僅測試工作流程的變更才升版。

## [v1.2.0] - 2026-08-10

本版將 shared Agent Skills 從 orchestration repository 拆出，建立 lock-pinned 的外部安裝模型，並完成 Unit、TUnit、Integration、Aspire 四套工作流程的功能驗證、dispatch telemetry 與 Reviewer acceptance 契約強化。四個 Orchestrator Skill 名稱、Analyzer → Writer → Executor → Reviewer 四階段、每 target 單一 Writer topology 與各 framework runner 均維持不變。

### 重大變更

- **Shared Skills 改為外部 canonical location**：29 個 `dotnet-testing-*` 技術型 Skills 與可選的 `unit-test-scenarios` 不再內含於 `.codex/skills/`，改由 setup／consumer deployment 安裝至 `.agents/skills/`；lab 中的該目錄維持 ignored
- **可重建的版本鎖定**：新增 `lab-shared-skills-lock.json` 與 `unit-test-scenarios-lock.json`，分別固定 `dotnet-testing-agent-skills` v2.4.1／`ff31b1a...` 與 `unit-test-scenarios`／`d005019...`
- **Lab bootstrap 與驗證**：新增跨平台 `setup-lab-skills`、`verify-lab-workflow`、skill path contract 與安裝回歸測試；local source override 只供開發，CI 與正式 release validation fail closed
- **Analyzer dispatch telemetry**：四個 Orchestrator 必須在 dispatch、接受與 artifact ready 的實際操作邊界記錄 `dispatchIssuedAt`、`dispatchAcceptedAt`、`artifactReadyAt` 與 phase completion；缺漏時不得進入下一階段或事後回填
- **Unit Reviewer acceptance**：Unit reviewer-result 必須提供三值 `gateDecision`（`pass`／`fail`／`blocked`），並與 user scenario coverage、missing/data mismatch、issues 與 Executor truth 一致
- **Token estimator 修正**：逾時／失敗 assignment 與 redispatch 共用 canonical path 時，不再把後續 attempt artifact 錯誤歸因到先前失敗 attempt
- **Agent 預設模型**：16 個 Subagent TOML 統一明確指定 `gpt-5.6-sol`、`reasoning_effort = "medium"`；新增模型計費與選型說明

### 正式工作流程契約

- 保留 v1.1.0 的每 target 單一 Writer、scenario 數不設上限、fresh/self-contained dispatch、canonical artifact truth chain、attempt isolation、role read scope、Executor runtime truth 與 strict timing gates
- Unit／TUnit 的共用 scenario validator 不再假設 `unit-test-scenarios` 是 public bundle 內建資產；shared Skill 安裝完整性由 setup、lock 與 lab preflight 負責
- Public bundle 固定為 16 個 Agents、5 個 Codex-specific Skills 與 13 個 runtime scripts；外部 shared Skills 不得混入 orchestration release

### 驗證

- 四工作流程功能驗證共 12 案：**289 passed、0 failed、0 skipped**；Unit 97、TUnit 141、Integration 28、Aspire 23
- Failure Contracts F-01～F-06 全部通過，涵蓋缺 Skill fail closed、artifact schema gate、首次成功 accounting、Docker unavailable、Reviewer read scope 與 approval gate
- 合併 v1.1.0 正式契約後 Node regression **190/190 passed**
- 16 個 Agent TOML 全部保留明確模型設定；tracked samples、production、AppHost 與 test csproj 無發布 byproduct

### 相容性與升級

- 使用者仍以原本四個 `$dotnet-testing-orchestrator-*` Skill 啟動流程，版本升為向下相容的 minor release `v1.2.0`
- 升級時必須完整更新 `.codex/agents/`、4 個 Orchestrator Skills、`.codex/scripts/`、`.codex/config.toml`，並透過 consumer deployment 安裝外部 `.agents/skills/`
- 舊版將 shared Skills 放在 `.codex/skills/` 的安裝不能與本版混用；先移除 legacy shared Skill 副本，再依新 setup／deployment 流程重建
- `samples/*/tests/` 仍是空白練習起點；生成測試、`.orchestrator/`、`bin/obj/TestResults` 與 csproj 修改不屬於發布內容

## [v1.1.0] - 2026-07-19

本版在不改變 Analyzer → Writer → Executor → Reviewer 四階段入口與主要功能的前提下，完成 Unit、TUnit、Integration、Aspire 四套工作流程的 Token Usage 最佳化、Single Writer 統一與 correctness contract 強化。

### 重大變更

- **四工作流程統一 Single Writer topology**：每個 target 固定一個 `single`／`full` Writer；不再依 public method、scenario、endpoint、Resource 或預估輸出大小 split。多 target 仍可各有一個 Writer，但同一 target 不再拆成多個 Writer assignments
- **Analyzer 案例數不設上限**：取消 split 不代表限制案例數。Writer 必須承接本次 Analyzer 接受的全部 scenarios；若遇到 context／output limit，attempt 必須 fail closed，不得恢復 split 或刪減案例
- **Fresh/self-contained dispatch**：四角色固定 `fork_turns: "none"`、`contextForkPolicy=none`、`externalMemoryPolicy=forbid`，並以 attempt-isolation 與 role-read-scope validators 拒絕 prior-attempt、archive、外部 memory、未核准 handoff 與 unrelated orchestration reads
- **Canonical artifact truth chain**：Analyzer、Writer、Executor、Reviewer 必須產生可解析的 canonical JSON；scenario／endpoint／Resource provenance、runtime evidence、Reviewer acceptance 與 `run-state.json` timing 需跨 artifact 對得起來
- **Reviewer 不重跑 runtime**：Executor artifact 是 build/test truth；Reviewer 審查完整性、品質與契約一致性，不以自行重跑測試覆蓋 Executor evidence
- **正式流程不使用 RAG**：角色只讀 prompt 指定的 source/project、repo-local Skills 與本次核准 handoffs；過去 RAG/MCP 探索只保留在歷史研究文件

### 各工作流程差異

- **Unit**：每 target 一個 Writer；保留使用者提供 scenarios／test data 的優先權、constructor guards、完整 scenario mapping 與多 target correctness gate
- **TUnit**：每 target 一個 Writer；Executor 仍使用 SourceGenerated / Microsoft.Testing.Platform 的 `dotnet run`，不改成 `dotnet test`；Validator 與 data-driven cases 的完整度由 TUnit-specific contract 驗證
- **Integration**：每個 Controller／target 一個 Writer，同一測試專案的多 target Writers 為避免 shared infrastructure ownership 衝突而循序執行；Executor 仍使用 xUnit `dotnet test`、Docker／Testcontainers 與 project-level regression
- **Aspire**：每個 Controller／endpoint slice 一個 `single/full` Writer；保留 AppHost Resource graph、`DistributedApplicationTestingBuilder`、Resource readiness、Docker hard prerequisite 與版本對應的 blame hang timeout

### Estimated Token Usage 實驗結果

| 工作流程 | 正式比較範圍 | End-to-end estimate | Writer estimate／input | 品質結論 |
| --- | --- | ---: | ---: | --- |
| Unit | Net10 multi-target valid-pair median | **-16.58%** | Writer **-32.75%** | Candidate scenario median 與 executed-test median 均在 attribution 門檻內；Reviewer missing 0 |
| TUnit | Net10 `ReservationService` Split B1 vs Single Writer S1 | **-15.7%** | Writer **-26.4%** | 53/53 passed；Reviewer A；missing 0 |
| Integration | Net9 `OrdersController` two-step B1 vs single S1 | **-28.568%** | Writer **-49.153%** | endpoints/scenarios/methods 相同；49/49 passed；missing 0 |
| Aspire | Net9 `BookingsController` B1 vs S1 | raw total **-24.91%** | Writer **-45.05%**；Writer input **-49.86%** | 所有 accepted scenarios 均實作；Reviewer A/97；scenario breadth 不同，raw total 不全部歸因於 topology |

以上數字均為 `.codex/scripts/estimate-token-usage.mjs` 對 subagent **visible context** 的相對估算，不含 hidden framing、internal reasoning、cached input accounting 或 provider billing usage；不可作為帳務用量、固定節省承諾或 correctness gate。

### Correctness 與品質

- 四工作流程的正式 candidate、multi-target／scale 與 net8/net9/net10 portability gates 均保留真實 build/run evidence、Reviewer acceptance、strict timing、attempt isolation 與 production mutation 檢查
- 沒有觀察到因移除 split 而造成 Analyzer 已接受 scenario 遺漏、runtime 測試縮減或 Reviewer 品質退化
- Analyzer scenario 數與技術型 Skill 選擇仍可能因 target 實作與模型非決定性變動；正式 acceptance 檢查本次有效 scenario 的完整承接，不以固定案例數判定成功
- `run-state.json` 仍是官方 wall-clock timing 的唯一 truth source；Estimated Token Usage 只作 optional telemetry

### 公開執行資產

- 將 10 個正式 runtime validators 移入 `.codex/scripts/validators/`，與 `run-state.mjs`、`estimate-token-usage.mjs` 一起隨 `.codex/` 發布
- 四個 Orchestrator 不再引用 public repo 未發布的根目錄 `scripts/`；修正 v1.0.4 public bundle 中 unit scenario validator 路徑缺檔問題
- 新增 public release asset validator，檢查 16 個 Agents、6 個內建 Skills、runtime scripts、Orchestrator `node` references 與 sample byproducts

### 相容性與升級

- 四個 Orchestrator Skill 名稱、使用者呼叫方式、Analyzer → Writer → Executor → Reviewer 四階段與各 framework runner 均維持不變，故版本升為向下相容的 minor release `v1.1.0`
- 升級時應完整更新本 repo 發布的 `.codex/agents/`、4 個 Orchestrator Skills、`.codex/scripts/` 與 `.codex/config.toml`；不要只替換單一 `SKILL.md`，否則會缺少新的 runtime validators 與 isolation contract
- 外部 `dotnet-testing-agent-skills` 仍需另行安裝；本版未修改其正式規則來源
- `samples/*/tests/` 仍是空白練習起點；工作流程生成的測試、`.orchestrator/`、`bin/obj/TestResults` 與 csproj 修改不屬於發布內容

### 驗證

- Node regression **149/149**、目前工作樹 `.mjs` syntax **40/40**、16 個 Agent TOML parse 全數通過
- strict public-sync preview 驗證 16 agents、6 built-in skills、12 runtime scripts、80 個 Orchestrator runtime reference occurrences（22 unique）與 34 個 public Markdown links 全部可解析
- fresh public-preview smoke：Unit Net10 `SubscriptionService` **50/50**、TUnit Net10 `ReservationService` **55/55**、Integration Net9 `OrdersController` **37/37**、Aspire Net9 `BookingsController` **60/60**，合計 **202/202 passed、0 failed、0 skipped**
- 四套均為每 target 唯一 `single/full` Writer，canonical missing scenarios 為 0；Integration／Aspire production source hash 零漂移
- Aspire 首個 60/60 Executor attempt 因讀取 workspace 外 memory 被 isolation gate 拒絕；fresh self-contained Executor 完整重跑後仍為 60/60、0 fix，證明 gate 不以 runtime 綠燈取代執行邊界
- 所有 smoke byproducts 均留在 ignored fresh workspaces，正式 `samples/*/tests/` 維持初始 scaffold

## [v1.0.4] - 2026-07-13

新增:單元測試工作流程支援使用者以任意格式提供測試情境與測試資料，並整合固定版本的 `unit-test-scenarios` Skill 作為無輸入時的情境產生來源。

### 新增
- **`unit-test-scenarios` Skill**:將 [`kevintsengtw/unit-test-scenarios`](https://github.com/kevintsengtw/unit-test-scenarios) 的固定版本納入 repo，讓使用者可先產生經分析的測試情境，再交給 unit workflow 使用；版本來源與更新方式記錄於 `docs/dependencies/unit-test-scenarios.md`
- **使用者情境契約 validator**:`.codex/scripts/validators/validate-unit-scenario-contract.mjs` 驗證 Analyzer catalog、Writer scenario coverage、Reviewer coverage consistency 與正式 acceptance gate；搭配正反向 fixture 測試
- **run-state 回歸測試**:補上巢狀 duration、缺失端點與 Executor fix rounds 的測試，防止 workflow 稽核欄位退化

### 變更
- **使用者輸入優先**:Analyzer 接受 Markdown、free text、表格、JSON 或混合格式的測試情境與資料；合理內容必須優先保留，只能逐項拒絕不合理或不正確的情境，不得整批棄用
- **跨階段可追溯**:Writer 必須逐一回報情境與資料使用方式；Reviewer 必須與 Writer artifact 對帳，`blocked` / `limitation` 不得偽報為 `implemented`
- **資料保護**:使用者提供明確 `testData` 時，不得以自動產生資料取代後仍宣稱完成；沒有明確資料而使用 generated data 時也必須記錄原因
- **移除過時 smoke validator**:刪除實驗階段的 `validate-orchestrator-smoke.mjs`，正式靜態驗收改由 scenario contract 與 run-state 測試負責；歷史實驗文件保留原始紀錄
- **public 發布同步**:同步 `unit-test-scenarios` Skill、固定版本說明與 consumer 文件，確保 public repo 具備完整執行資產

### 驗證
- scenario contract 與 run-state 測試共 **23 項全數通過**
- 完成 structured split、free-text non-split、部分情境與額外目標等完整 workflow 驗證；確認使用者情境先進入 Analyzer catalog，再由 Writer、Executor、Reviewer 持續追蹤
- 簽入範圍不含 `samples/*/tests/` 產生的測試檔、`.orchestrator/` artifacts 或 `.csproj` byproduct

## [v1.0.3] - 2026-07-07

修正:Estimated Token Usage 估算器在 Writer canonical artifact 偶為 `.cs` 時崩潰、導致 token 表間歇 unavailable;並移除 Claude 版移植遺留的 `.codex/hooks.json` 死碼。

### 變更
- **estimator `readJsonIfFile` 包 try/catch**:`estimate-token-usage.mjs` 逐 assignment 對 `artifact` 路徑 `JSON.parse`,但 Writer 的 canonical artifact 偶爾被 stamp 成生成的 `.cs`(而非 `writer-result.json`),`JSON.parse("namespace ...")` 拋未捕捉例外 → 整個估算器崩潰、`token-usage-estimate.json` 不產生,故 token 表**間歇** unavailable。改為 parse 失敗回 `null`,呼叫端已能處理(該 `.cs` 的 raw token 仍由 `countFile` 計入,僅該 assignment confidence 降級,不再整份崩潰);`run-state.json` 損毀時也一併受惠(改回報 unreadable 而非崩潰)
- **移除 `.codex/hooks.json`**:此檔為 Claude 版移植遺留(matcher `"Agent"` 是 Claude Code 工具名、command 指向 `.claude/hooks/*.sh`),Codex 不觸發此 hook(全歷史 session log 中對應 timer-hook fire 次數為 0),對 Codex 工作流程無作用。正式 phase 時序本就只認 `run-state.json`,契約明訂不得依賴 hook 輸出

### 驗證
- estimator 修正:重現測試(`artifact` 指向 `.cs` → 修正前崩潰、修正後正常產出且 `.cs` raw token 仍計入)+ 正常 JSON artifact 回歸皆通過
- **四工作流程全矩陣遙測**:unit / tunit / integration / aspire × Win/mac × CLI/Ext = **16 格,遙測全數通過**(`$` 啟用式喚起 → `<skill>` 注入、`run-state.json` 四階段時間戳、`token-usage-estimate.json` 產出、estimator 零 `.cs` 例外;Windows 8 格以 session log 逐項採證,macOS 8 格以報告耗時表 + token 表佐證)
- **功能面**:unit / tunit 全 8 格測試實跑通過;integration / aspire 在 **Windows**(Docker 就緒)兩格皆完整跑綠(integration OrdersController 24/21 passed、aspire Net10 BookingsController 19/23 passed、`src/**` 與 AppHost 零改動),**macOS** 因 Docker daemon 未啟動,Executor 依契約停在環境 gate、測試未實跑(環境限制,非退化;run-state / token 遙測仍完整)
- hooks.json 移除:全矩陣移除後照常運作,再次證實 hooks.json 與 run-state / token 遙測無因果

## [v1.0.2] - 2026-07-05

修正:四工作流程(unit / tunit / integration / aspire)`run-state.json` 在 **VSCode Codex Extension** 下全空的問題,並針對 aspire 測試韌性與 readiness 跨版本相容性做精修。

### 變更
- **`run-state.mjs` 確定性寫入**:契約原要求 orchestrator 用「Write 工具 + `date -u`」維護 `{testProjectDir}/.orchestrator/run-state.json`。但 Codex 沒有「Write」工具——Codex CLI 的 model 會腦補成 shell read-modify-write(能動),**VS Code Codex Extension 的 model 不腦補、整段略過 run-state 維護**,導致 run-state.json 從不產生、各階段耗時與 Estimated Token Usage 全空。新增 `.codex/scripts/run-state.mjs`(純量參數 API:`init`/`set`/`append`,值寫 `@now` 由腳本內部取系統時鐘 ISO、`--derive` 推毫秒差,不傳 JSON blob 以避開 PowerShell 引號問題),四個 orchestrator 的 run-state 段落改為確定性呼叫此腳本,CLI 與 Extension 行為一致
- **測試檔輸出路徑鏡射修正**:tunit/integration/aspire 的測試檔輸出路徑原本未在 SKILL 明訂推導規則,導致落點漂移。修法為「鏡射被測類別的 src 子目錄」:tunit → `Services/`、integration → `Controllers/`、aspire → `Integration/`
- **aspire AppHost 改用拋棄式容器**:base/Net8/Net10 三個 AppHost 的 SQL Server / Redis 移除 `WithDataVolume` 持久資料卷與 `ContainerLifetime.Session`。根因是 Aspire 每次重跑會自動輪替 SA 密碼,持久卷掛載舊密碼導致「新容器新密碼、掛舊卷舊密碼」造成 SQL readiness 卡死 15 分鐘以上(所有 Aspire 版本皆會發生,`ContainerLifetime.Session` 無法規避)
- **aspire 測試韌性設計轉向**:Executor / Writer **永不修改 production / AppHost 碼**(含但不限於 `AddHealthChecks()`、`WithoutHttpsCertificate()`、`WithDataVolume`、`ContainerLifetime`),Reviewer 見改動一律 Blocker。韌性改由測試框架端 fixture 三段式承擔:(B) 通用持久化 sanitizer(annotation 層級剝持久卷 + 強制 ephemeral,與服務無關)→ (C) 已知框架 quirk 中和器(僅 Aspire 13.1+ 有 Redis 時於 fixture 端 `WithoutHttpsCertificate()` 中和預設 TLS)→ (A) 有界就緒安全網(只等測試實際使用的資源,逾時拋點名例外,取代無上限 hang)
- **aspire fixture 有界就緒改用跨版本通用 API**:(A) 改用 `Services.GetRequiredService<ResourceNotificationService>().WaitForResourceAsync(name, KnownResourceStates.Running, ct)`(Aspire 8.2.x / 9.x / 13.x 皆可用),取代原本 net10-only 的 `WaitForResourceHealthyAsync`,降低 net8/net9 因 API 版本不相容導致的 readiness 相關修正輪次

### 驗證
- run-state.mjs:unit / tunit / integration 三工作流程,Win/mac × CLI/Ext × 單/多目標共 8 格全數驗證通過
- aspire run-state + 拋棄式容器 + 測試框架端韌性轉向:3 版本(base 9.0.0 / Net8 8.2.2 / Net10 13.1.2)× 2 系統 × 2 環境全矩陣驗證通過,`src/**` / production / AppHost 零改動
- aspire readiness 跨版本精修:3 版本 × 2 系統 × 2 環境 = 12 格全綠,readiness 相關修正輪次全數歸零(net8/net9),net10 回歸測試 4/4 全綠且 fixRounds 皆為 0;Windows Net8 CLI Executor 耗時由精修前 29 分 40 秒降至 3 分 28 秒

## [v1.0.1] - 2026-06-24

修正:Estimated Token Usage 估算器**位置調整 + 改為零相依自含**,與「安裝只部署 `.codex/`」產品模型對齊。

### 變更
- **`scripts/estimate-token-usage.mjs` → `.codex/scripts/estimate-token-usage.mjs`**:v1.0.0 時估算器置於 repo root `scripts/` 並隨 `package.json` 鏡射到 public root,但安裝腳本只部署 `.codex/`,導致照安裝腳本安裝的消費者**拿不到估算器**。移入 `.codex/scripts/` 後隨 `.codex/` 一起出貨
- **4 個 orchestrator SKILL** 的估算器引用路徑(8 處)、aspire-analyzer 提及、`install-dotnet-testing-agents.py`(新增 step 3b 複製 `.codex/scripts/`)、`sync-to-public.yml`(改同步 `.codex/scripts/`、清除 public root 殘留、不再發佈 `package.json`/`package-lock.json`)、README / token-usage 指南 / architecture 文件路徑一併更新
- **估算器改為零相依、自含**:**移除 `gpt-tokenizer` / `js-tiktoken` 外部 tokenizer**,一律用內建 `chars-heuristic`(`字元數 / 3.6`)估算;**刪除 `package.json` / `package-lock.json`**(估算器不再需要任何 npm 相依,有 Node.js 即可 `node` 執行)。理由:此功能定位為「相對成本比較的 optional telemetry、非 billing」,粗估即可,換零相依 + 隨 `.codex/` 乾淨出貨;消除「裝不裝 tokenizer」的曖昧與 `o200k_base` 是否符 Codex 的 proxy 疑慮
- 輸出標記隨之更新:`estimator.method = "chars-heuristic"` + `charsPerToken`(取代舊 `tokenizer`/`fallback`);`confidence` 上限為 `medium`(chars 粗估永不 `high`);`ESTIMATOR_VERSION` → 2。四工作流程經情境驗證確認從新路徑正常產生估算;estimator 邏輯(phase/assignment 聚合、shared-artifact 去重、unavailable 降級)不變
- **已知偏差新增一條**:`chars-heuristic` 非真實 BPE,粗估,中文等非拉丁文字偏差較大(已列入 `knownMissing` 與指南)
- **停止發佈一鍵安裝腳本到 public**:`scripts/install-dotnet-testing-agents.py` + `scripts/README.md` 內容停在 unit-only 年代(腳本 `EXPECTED_AGENTS=4` 對不上現況 16、README 過時)、且 public README 安裝走手動步驟未引用此腳本(孤兒);改為 lab-internal,`sync-to-public.yml` 不再發佈並清除 public 殘留(lab 端常數同步修正為 16 agents / 5 內建 skill)

## [v1.0.0] - 2026-06-23

**正式版里程碑**:四種測試工作流程(unit / tunit / integration / aspire)的 Codex 版轉換全部完成(v0.0.2~v0.0.5),並完成 **Estimated Token Usage(估算式 token 用量)** 跨四工作流程整合。依版本規則(四工作流程齊備)升至 `v1.0.0`。

### 新增
- **`scripts/estimate-token-usage.mjs`**:共用的 visible-context token 估算器。讀 `{testProjectDir}/.orchestrator/run-state.json`,逐 phase / assignment 對各 subagent 的可觀測材料(讀取的 source/skill/交接檔、寫出的測試與 artifact、spawn payload、agent 定義)以 `gpt-tokenizer`(`o200k_base`)估算,輸出 `.orchestrator/token-usage-estimate.json`
- **`package.json` / `package-lock.json`**:estimator 的 `gpt-tokenizer` devDependency(未安裝則自動降級 `chars/3.6`)
- **per-type 文件**:`docs/guides/token-usage-estimation.md`(估算原理、執行方式、限制與已知偏差)

### 特性(Estimated Token Usage)
- **四工作流程一致接入**:16 個 subagent 在自己的交接 artifact 寫入頂層 `tokenEstimateInputs`(`schemaVersion`/`estimateKind`/`readFiles`/`writtenFiles`/`toolOutputRefs`);agent 本身**不計算 token**,只登記可觀測材料,由 estimator 事後估算
- **明確標示為估算、非 billing**:固定附免責(排除 Codex hidden framing / internal reasoning / cached input / provider billing);四 SKILL 最終輸出新增 `Estimated Token Usage` 區塊,**不得命名為 `Token Usage`**、**不得作為任何 correctness gate**
- **best-effort 不阻塞**:`tokenEstimateInputs` 缺漏、estimator 失敗、run-state 缺失或 artifact 不足時,輸出 `unavailable` 並繼續,**絕不讓工作流程失敗 / 觸發 re-dispatch**
- **去重與正規化**:run-state phase key 大小寫不敏感;同 phase 多 assignment 共用同一交接 artifact 時做 shared-artifact 去重(避免 two-step Writer 過計)
- **已知系統性偏差(文件明載)**:Orchestrator 主執行緒未估、analysis 內嵌 `sourceCodeContext` 重複計、aspire two-step 去重數字目前為投影

### 驗證
- 13+ 真實/合成情境(unit 7 種 + tunit + integration + aspire),真實 dispatch、非 0 估算;兩個估算 bug(phase key 大小寫致全 0、two-step 共用 artifact 過計)均抓到+修+複驗
- reviewer 端 verify-then-fix:對「integration executor toolOutputRefs 疑似估成 0」**先實跑驗證**(estimator 實測 `toolOutputTokens=70`、三 ref 全 counted)→ 推翻疑似 → 未誤改;analyzer 的 token gate 一律改 best-effort(不污染 correctness);reviewer schema 對齊

## [v0.0.5] - 2026-06-23

Codex 版第四個(也是最後一個)工作流程預覽:**.NET Aspire 整合測試 Agent Orchestration**(由 `dotnet-testing-agent-orchestration-claude` 經 migrate-to-codex 轉換,並經 Claude-vs-Codex 對照驗證)。四種測試工作流程(unit / integration / aspire / tunit)至此功能齊備。

### 新增
- **`dotnet-testing-orchestrator-aspire` Skill**:.NET Aspire 整合測試指揮中心,1 Skill + 4 Subagent(`dotnet-testing-advanced-aspire-{analyzer,writer,executor,reviewer}`),Codex 原生 SpawnAgent dispatch
- **4 個 aspire Codex 原生 subagent**(`.codex/agents/dotnet-testing-advanced-aspire-*.toml`)
- **aspire 練習 sample**(`samples/aspire/practice_aspire/`),含 `BookingsController`(SQL Server + Redis)+ FluentValidation,net8(Aspire 8.2.2)/ net9(Aspire 9.0)/ net10(Aspire 13.1.2)三版變體
- **per-type 文件**:`docs/architecture/aspire-orchestrator.md`、`docs/guides/aspire-testing.md`

### 特性(Aspire 專屬)
- **執行模型 = AppHost / `DistributedApplicationTestingBuilder`**(Aspire.Hosting.Testing,**非** `WebApplicationFactory`)+ xUnit **`dotnet test --blame-hang-timeout`**(8.x/9.x=`10m`、13.x=`15m`;**絕不用** `dotnet run`、**不可用** `--timeout`);csproj 含 `Microsoft.NET.Test.Sdk`+`xunit`+`Aspire.Hosting.Testing`、**無** `OutputType=Exe`
- **環境雙檢**:Executor Step 0 `docker info`(**Docker 為硬前置,無 InMemory 退路**)+ Step 0.5 `dotnet workload list`(含 `Aspire.AppHost.Sdk` 9.0+ NuGet **免 workload 例外**)
- **`app.CreateHttpClient("name")` 名稱對齊** AppHost `AddProject("name")`;容器由 Aspire AppHost 宣告式管理(**非**程式化 Testcontainers);DB 連線用 `App.GetConnectionStringAsync("resourceName")`
- **Analyzer 以 AppHost Resource graph 為核心**:`resources[]` / `projectReferences[]` / `dependencyGraph` / `containerLifetime` / `dataVolumes`;`aspireVersion` 雙格式擷取(8.x 分離 SDK 以 `Aspire.Hosting.AppHost` 套件為準、13.x Project-SDK 以 SDK 屬性為準);`requiredSkills` 固定 `["aspire-testing"]`
- **Writer 單一技術技能 `aspire-testing`**(不載 unit 20 技能 / tunit / integration 4 技能);AspireAppFixture(`IAsyncLifetime`)+ CollectionDefinition + `ContainerLifetime.Session` + Respawn
- **多目標並行度**:Analyzer / Writer / Reviewer 平行,**Executor 循序**(AppHost 啟動不可並行互搶)
- **Production 窄例外**(Executor 唯一可改 production 三類、須標記):Health Checks 缺失(`/health` 404)、容器重啟超時(`ContainerLifetime.Session`)、Redis TLS(Aspire 13.1+ → `WithoutHttpsCertificate()`);其餘走 `requiresUserApproval` 批准閘門
- **使用者最終輸出**「結果整合與呈現」8 項(測試檔連結 / 執行摘要 / Docker+Aspire 環境 / 品質摘要 / 改善建議 / Skills / 修正紀錄 / 各階段耗時+Timing Evidence)+ 環境vs品質區分,對齊 unit/tunit/integration 兄弟
- 沿用 unit/tunit/integration 的 Codex 強化:`run-state.json` timing、Writer artifact gate + bounded re-dispatch、phase-boundary agent release、Reviewer 強制執行、post-review approval gate、production-code 邊界、Phase 5 保留 artifacts、token de-scoped

### 驗證(Claude-vs-Codex 對照,exp-01~03 三版矩陣)
- net9(exp-01)/ net10·Aspire 13.x(exp-02)/ net8·Aspire 8.2.2(exp-03)三 TFM 版本全部 **PASS**;另含轉換驗收 net9 18/18
- 每個 Codex run 由 reviewer **親跑 `dotnet test --blame-hang-timeout` 驗證為真**(21 / 24 / 25 全綠)、**零假綠**、零 restart/redispatch;完整度與 Claude 基準 parity(差 1~4 案例,9/9 端點覆蓋齊);**零 Codex 專屬硬性 fix**(僅 bounded NU1605 套件對齊)
- **關鍵發現**:Claude 與 Codex 在**獨立**的 net10 run 各自收斂到**同一 Redis TLS + `ContainerLifetime.Session` 窄例外**,net8/net9 兩版皆 0 production 改動 → 實證 production 窄例外授權正確;stale Docker named volume 為三版共通環境前置
- 6 軸停損判定:Codex aspire **good-enough**(與基準實質等價)

## [v0.0.4] - 2026-06-22

Codex 版第三個工作流程預覽:**整合測試 Agent Orchestration**(由 `dotnet-testing-agent-orchestration-claude` 經 migrate-to-codex 轉換,並經 Claude-vs-Codex 對照驗證)。

### 新增
- **`dotnet-testing-orchestrator-integration` Skill**:.NET WebAPI 整合測試指揮中心,1 Skill + 4 Subagent(`dotnet-testing-advanced-integration-{analyzer,writer,executor,reviewer}`),Codex 原生 SpawnAgent dispatch
- **4 個 integration Codex 原生 subagent**(`.codex/agents/dotnet-testing-advanced-integration-*.toml`)
- **integration 練習 sample**(`samples/integration/practice_integration/`),含 `OrdersController`(PostgreSQL)+ `CustomerActivitiesController`(MongoDB)+ FluentValidation,net8/net9/net10 三版變體
- **per-type 文件**:`docs/architecture/integration-orchestrator.md`、`docs/guides/integration-testing.md`

### 特性(整合測試專屬)
- **執行模型 = `dotnet test`**(xUnit,含 `Microsoft.NET.Test.Sdk`、**無** `OutputType=Exe`)+ **Docker / Testcontainers**(Executor Step 0 先 `docker info`,純 InMemory 才略過)
- **測試粒度 = HTTP endpoint**;透過 `WebApplicationFactory<Program>` 發真實 HTTP 請求
- HTTP 斷言用 **AwesomeAssertions.Web**(`Be200Ok`/`Be201Created`/`Be400BadRequest`/`Be404NotFound`/`Be409Conflict`/`Be204NoContent`);錯誤格式以 `.And.Satisfy<T>()` 驗證 **`ProblemDetails` / `ValidationProblemDetails`**
- 容器化資料庫:Testcontainers(PostgreSQL / SQL Server / MongoDB / Redis)+ **Respawn** 資料隔離 + Collection Fixture 容器共享
- **DbContext 置換策略**依 Analyzer `dbRegistrationAnalysis`(hardcoded-unconditional / conditional / no-registration)決定;DB Provider 衝突的 Program.cs 環境條件修改為唯一 production 窄例外
- **分階段啟動**:`scenarioCount > 15` 時 Writer 分兩批(先基礎設施、後測試案例)
- 沿用 unit/tunit 的 Codex 強化:`run-state.json` timing、Writer artifact gate + bounded re-dispatch、phase-boundary agent release、post-review approval gate、production-code 邊界、token de-scoped

### 驗證(Claude-vs-Codex 對照,exp-01~04)
- 單 Controller + PostgreSQL 容器 / 多 Controller 多容器(PG+Mongo)+ 多目標調度 / net10 變體 / net8 變體 四軸全部 **PASS**;net8/net9/net10 三 TFM 版本齊全
- 每個 Codex run 由 reviewer 親跑 `dotnet test` 驗證為真、**零假綠**;完整度與 Claude 基準大致 parity(差 1~10 案例,核心端點覆蓋齊);**零 Codex 專屬硬性 fix**(僅 bounded NU1605 套件版本對齊)
- 6 軸停損判定:Codex integration **good-enough**(與基準實質等價);容器 scope 兩版皆非決定性、net10 confound 在對齊提示詞後解除

## [v0.0.3] - 2026-06-22

Codex 版第二個工作流程預覽:**TUnit 測試 Agent Orchestration**(由 `dotnet-testing-agent-orchestration-claude` 經 migrate-to-codex 轉換,並經 Claude-vs-Codex 對照驗證)。

### 新增
- **`dotnet-testing-orchestrator-tunit` Skill**:TUnit 測試指揮中心,1 Skill + 4 Subagent(`dotnet-testing-advanced-tunit-{analyzer,writer,executor,reviewer}`),Codex 原生 SpawnAgent dispatch
- **4 個 tunit Codex 原生 subagent**(`.codex/agents/dotnet-testing-advanced-tunit-*.toml`)
- **tunit 練習 sample**(`samples/tunit/practice_tunit/`),含 `LibraryMemberValidator` fixture
- **per-type 文件**:`docs/architecture/tunit-orchestrator.md`、`docs/guides/tunit-testing.md`

### 特性(TUnit 專屬)
- **執行模型 = `dotnet run`**(Microsoft.Testing.Platform / Source Generator,`engineMode=SourceGenerated`),**絕不用 `dotnet test`**;產出 `OutputType=Exe`、不含 `Microsoft.NET.Test.Sdk`
- TUnit 屬性 `[Test]`/`[Arguments]`/`[MethodDataSource]`/`[Before(Test)]`,測試方法 `async Task`
- **`.slnx` 版本感知選擇**(net8 / net9 / net10)
- **xUnit→TUnit 遷移**軸(`[Fact]`→`[Test]`、`[Theory]`+`[InlineData]`→`[Arguments]`、`[MemberData]`→`[MethodDataSource]`、`IDisposable`→`[After(Test)]`,零 xUnit 殘留)
- Matrix:TUnit 0.6.123 無 `[MatrixDataSource]` → 以 nested-loop `[MethodDataSource]` 模擬
- Validator(`AbstractValidator<T>`)`forbidWriterSplit` 永不分割 + FluentValidation TestHelper
- 沿用 unit 的 Codex 強化:`run-state.json` timing、Writer artifact gate + bounded re-dispatch、phase-boundary agent release、post-review approval gate、production-code 邊界、token de-scoped

### 驗證(Claude-vs-Codex 對照,exp-01~06)
- 基本 / Writer 分割 / xUnit→TUnit 遷移 / net10 框架變體+.slnx / 資料驅動+Matrix / Validator 六軸全部 **PASS**
- 每個 Codex run 由 reviewer 親跑 `dotnet run` 驗證為真、**零假綠**;完整度與 Claude 基準 **parity**;**零 Codex 專屬硬性 fix**
- 6 軸停損判定:Codex tunit **good-enough**(與基準實質等價)

## [v0.0.2] - 2026-06-19

Reviewer 跨檔 fixture 一致檢查補強(工作流程契約變更)。

### 變更
- **Reviewer §3g 跨檔 fixture-setup 一致檢查補強**:`dotnet-testing-reviewer.toml` §3g 新增 fixture-setup 跨檔一致叢集——時間錨同名同值具名常數、AutoFixture 遞迴行為、共用欄位命名(`_fixture`/`_sut`)、per-test 時間區域變數命名、SUT 建構模式;讓 SKILL「Reviewer 逐檔比對 fixture setup」的宣稱真有 Reviewer 後盾(原僅 Writer 生成端 + Orchestrator gate 撐)
- **§3d 程式碼品質**擴充:未使用 `using` 之外,一併檢查宣告但未使用的 fixture 欄位(dead field)

### 驗證
- 注入式實證(非僅靜態文字):於 split 目標注入 fixture 漂移後重跑 Reviewer,`reviewer-result.json` 在 runtime 逐項觸發實質四項(時間錨值 / AutoFixture 遞迴 / 欄位命名 / SUT 建構模式),每條 finding 對應真實漂移;舊 §3g 無法涵蓋這些,屬本次新增項
- 連帶實證:Writer 生成端在同一輸入下確會漂移(同名 `InitialNow` 不同值),新 Reviewer 後盾抓到此真實漏失

## [v0.0.1] - 2026-06-18

Codex 版首個 unit 工作流程預覽：**.NET 單元測試 Agent Orchestration**（由 `dotnet-testing-agent-orchestration-claude` 經 migrate-to-codex 轉換並優化驗證）。

### 新增
- **`dotnet-testing-orchestrator-unit` Skill**：單元測試指揮中心，1 Skill + 4 Subagent（Analyzer → Writer → Executor → Reviewer），透過 Codex 原生 SpawnAgent dispatch
- **4 個 Codex 原生 subagent**（`.codex/agents/dotnet-testing-{analyzer,writer,executor,reviewer}.toml`）
- **`dotnet-test` Skill**：build-first、test-targeted 的選擇性測試執行

### 特性
- 大型類別 per-class Writer 分割、多目標支援
- setup 親和分組 + 跨檔 fixture 一致契約（時間錨具名常數 / AutoFixture 遞迴 / 命名 / SUT 建構一致）
- 建構子 null-guard 測試覆蓋（每個 guarded 依賴一個 `ArgumentNullException` 測試）
- Production-code 邊界：需 seam 即停報 `requiresUserApproval`、不硬測；裸 `DateTime.*` 比照裸 `File.IO`
- 修改流程 post-review approval gate
- 固定最終回覆契約（8 區塊，不可散文化）
- `run-state.json` 階段 timing 證據（逐 assignment、誠實不造假）+ thread-ceiling redispatch 自癒

### 與 Claude 版的差異（平台/設計）
- **Token 用量統計：de-scoped** — Codex native SpawnAgent subagent 的全流程 token 無可靠 truth source（實證確認），故不回報，避免誤導數字
- Dispatch 經 Codex SpawnAgent（非 Claude Agent tool）；多 `run-state.json` 可稽核狀態檔（Codex-only）

### 已知限制
- 同輸入產出有 run-to-run 非決定性（測試數、分割分組、skill 選擇）——Codex native 多 subagent dispatch 的本質，非阻斷
- 階段耗時不對齊 Claude（平台/模型本質不同；耗時優化經實證在「不變更 agent 數」約束下不可行）
