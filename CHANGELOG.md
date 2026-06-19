# Changelog

所有重要變更都記錄於此。格式參考 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.0.0/)。

> 版本規則：四種測試工作流程（unit / integration / aspire / tunit）全部完成才升至 `v1.0.0`；在此之前為 `v0.0.x` 預覽版。文件類修改不更新版本號，僅測試工作流程的變更才升版。

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
