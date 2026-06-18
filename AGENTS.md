# AGENTS.md

## 專案概述

dotnet-testing Agent Orchestration for Codex。
提供完整的 Codex 原生 Subagent 測試工作流程範例。**目前涵蓋 Unit 一種測試類型**；Integration / Aspire / TUnit 為後續釋出 🚧。

本版由上游 [`dotnet-testing-agent-orchestration-claude`](https://github.com/kevintsengtw/dotnet-testing-agent-orchestration-claude) 經 migrate-to-codex 轉換，並在 Codex 平台多輪實驗優化驗證而成。

## 語言與風格

- 對話、文件、commit message 使用繁體中文
- commit message 格式：`動詞: 描述`（如 `更新:`, `重構:`, `修正:`）
- 測試方法命名：中文三段式 `方法名_情境描述_預期結果`
- 語氣直接，不用敬語（不用「請」「麻煩」）
- Markdown fenced code block 必須加語言標記（`text`、`bash`、`csharp`、`toml`）

## 關鍵目錄

- `.codex/agents/` — 4 個自訂 Subagent 定義檔（`.toml`）：analyzer / writer / executor / reviewer
- `.codex/skills/` — Orchestrator Skill（`dotnet-testing-orchestrator-unit`）+ 測試執行器 Skill（`dotnet-test`）
- `.codex/config.toml` — Codex workspace 設定（啟用 `multi_agent`、設定 agent thread 上限與 runtime 上限）

> 技術型 Agent Skills（`dotnet-testing-*`）由外部 repo [`dotnet-testing-agent-skills`](https://github.com/kevintsengtw/dotnet-testing-agent-skills) 提供，需另行安裝（直接複製到 `.codex/skills/`）。

## Dispatch 機制

Orchestrator Skill 載入主對話後，透過 Codex 原生 **SpawnAgent** 依序調度 4 個 Subagent。
工作流程額外產出 `run-state.json`（可稽核的狀態檔），記錄各階段 wall-clock 時間與結果，為官方階段耗時與整體耗時的唯一真實來源。

## 專案結構

練習專案提供 net8.0 / net9.0 / net10.0 三個版本（以子專案形式存在於同一目錄內）。

| 目錄 | 類型 | 說明 |
| --- | --- | --- |
| `samples/unit/practice/` | 單元測試 | xUnit + NSubstitute + AutoFixture |

## 常用指令

- `dotnet build samples/unit/practice/tests/Practice.Core.Net8.Tests/` — 建置單元測試
- `dotnet test samples/unit/practice/tests/Practice.Core.Net8.Tests/` — 執行單元測試

## 測試技術棧

xUnit 2.9 + NSubstitute + AutoFixture + AwesomeAssertions + Bogus + FakeTimeProvider + MockFileSystem

## Skill Boundary（重要）

本 repo 的 Codex workflow **可以修改的 skill，僅限**：

- `.codex/skills/dotnet-testing-orchestrator-unit/SKILL.md`

以下 skill 視為外部既定基準與不可動搖的正式規則來源，**不得修改**：

- `.codex/skills/dotnet-test/**`
- `.codex/skills/dotnet-testing*/**`（技術型 Agent Skills）

規則：

1. `dotnet-test` 與所有 `dotnet-testing*` 技術型 skills 不得修改。
2. `dotnet-testing-orchestrator-unit` 雖然名稱以 `dotnet-testing-` 開頭，但它隸屬於本 repo 的 Codex orchestration workflow，屬唯一可修改例外。
3. 若需要調整 workflow 行為，應優先修改：`.codex/agents/*.toml`、`docs/**`、`scripts/**`、`.codex/skills/dotnet-testing-orchestrator-unit/SKILL.md`。
4. 若 workflow 與上述 skills 之間出現落差，應調整 workflow 的轉譯、decision mapping、驗證方式或提示設計；不得回頭修改 skill 本體。

## 重要：測試專案必須保持初始狀態

所有 `samples/*/tests/` 下的測試專案是供練習用的空白起點。
工作流程執行時產生的測試類別檔案、`.orchestrator/` artifacts（含 `run-state.json`）、以及 `.csproj` 修改皆為 **byproduct**，**不得簽入或推送到遠端**（已由 `.gitignore` 排除）。

## 與 Claude 版的差異

- **未提供 Token 用量統計** — Codex native SpawnAgent subagent 的全流程 token 無可靠 truth source（實證確認），故本版完全移除 token 引擎/報表，不回報 token 數字。
- **Dispatch 機制**：Codex 原生 SpawnAgent（非 Claude Agent tool）；額外產出 `run-state.json` 可稽核狀態檔。
- **產出非決定性**：同一輸入下，測試數 / 分割分組 / skill 選擇有 run-to-run 波動，屬 Codex 多 subagent dispatch 的已知限制。
