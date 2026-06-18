# install-dotnet-testing-agents.py 使用說明

## 功能與用途

`install-dotnet-testing-agents.py` 是一個一鍵安裝指令碼，用於將 **dotnet-testing Agent Orchestration（Codex 版）** 工作流程所需的全部元件安裝到指定的目標專案。

不需要手動執行多個安裝步驟——執行這支指令碼後，目標專案的 `.codex/` 目錄會自動完成以下所有設定：

| 安裝項目              | 說明                                       | 數量           |
| --------------------- | ------------------------------------------ | -------------- |
| `.codex/agents/`      | Unit 工作流程的 4 個 Subagent 定義檔       | 4 個 .toml 檔  |
| `.codex/config.toml`  | Codex workspace 設定（啟用 multi_agent）   | 1 個檔案       |
| `.codex/skills/`      | Orchestrator / dotnet-test Skills（內建）  | 2 個目錄       |
| `.codex/skills/`      | 技術型 Agent Skills（從 GitHub 下載複製）  | 29 個目錄      |

安裝完成後，在 Codex 中即可呼叫以下 Orchestrator Skill 啟動測試工作流程：

```text
$dotnet-testing-orchestrator-unit
```

> 本版聚焦 Unit 測試；Integration / Aspire / TUnit 為後續釋出 🚧。本版**不安裝 hooks，也不安裝任何 token 統計腳本**（Codex 版已 de-scope token 用量統計）。

---

## 執行前的必要環境與條件

### 必要條件

| 條件                     | 說明                                                            | 驗證指令           |
| ------------------------ | --------------------------------------------------------------- | ------------------ |
| **Python 3.8 以上**      | 指令碼使用 `pathlib` 與標準函式庫                               | `python --version` |
| **網路連線**             | Step 4 需要連線至 GitHub API 與 GitHub CDN 下載 Agent Skills    | —                  |
| **磁碟空間（約 200MB）** | Agent Skills 的 zipball 約 100MB，解壓後約 200MB（含 PDF 文件） | —                  |

### 執行環境

此指令碼必須從 `dotnet-testing-agent-orchestration-codex-lab` repo 內執行，因為 Step 1~3 是直接從本 repo 的 `.codex/` 目錄複製檔案到目標專案。

- **正確方式**：從 repo 根目錄執行，或將完整 repo Clone 後執行
- **不支援的方式**：僅複製單一 `install-dotnet-testing-agents.py` 檔案到目標專案後執行（缺少 `.codex/` 來源目錄）

### 不需要的項目

- 不需要安裝任何 Python 套件（指令碼只使用標準函式庫）
- 不需要 Node.js（本版不安裝 hooks，無需 `node`）
- 不需要 Docker（單元測試不使用容器；安裝過程本身也不涉及容器）
- 不需要 .NET SDK（安裝過程本身不建置任何 .NET 專案）

---

## 使用方式

### 基本執行（目標為目前工作目錄）

```bash
cd /your-dotnet-project
python /path/to/dotnet-testing-agent-orchestration-codex-lab/scripts/install-dotnet-testing-agents.py
```

### 指定目標專案路徑

```bash
python scripts/install-dotnet-testing-agents.py /path/to/your-dotnet-project
```

### Windows 範例

```bash
# 從 repo 根目錄執行，目標為另一個專案
python scripts\install-dotnet-testing-agents.py C:\Projects\MyDotNetApp

# 目標為目前工作目錄
cd C:\Projects\MyDotNetApp
python C:\github\dotnet-testing-agent-orchestration-codex-lab\scripts\install-dotnet-testing-agents.py
```

### macOS / Linux 範例

```bash
# 從 repo 根目錄執行，目標為另一個專案
python scripts/install-dotnet-testing-agents.py ~/projects/my-dotnet-app

# 目標為目前工作目錄
cd ~/projects/my-dotnet-app
python ~/repos/dotnet-testing-agent-orchestration-codex-lab/scripts/install-dotnet-testing-agents.py
```

---

## 安裝流程說明

指令碼依序執行以下步驟：

### Step 1：複製 `.codex/agents/`

將本 repo 的 4 個 Subagent 定義檔（`.toml`）複製到目標專案的 `.codex/agents/`：

- `dotnet-testing-analyzer.toml`
- `dotnet-testing-writer.toml`
- `dotnet-testing-executor.toml`
- `dotnet-testing-reviewer.toml`

### Step 2：複製 `.codex/config.toml`

將本 repo 的 `config.toml` 複製到目標專案的 `.codex/config.toml`。此檔啟用 `multi_agent`，並設定 agent thread 上限與 runtime 上限，是 SpawnAgent 調度 subagent 的必要設定。

### Step 3：複製 `.codex/skills/`（本 repo 內建）

將本 repo 內建的 Skills 複製到目標專案的 `.codex/skills/`：

- `dotnet-test/` — .NET 測試執行器 Skill
- `dotnet-testing-orchestrator-unit/` — 單元測試 Orchestrator

### Step 4：下載並複製技術型 Agent Skills（從 GitHub）

從 [`kevintsengtw/dotnet-testing-agent-skills`](https://github.com/kevintsengtw/dotnet-testing-agent-skills) 抓取最新 release 的 zipball，解壓後將所有 Skill 目錄**直接複製**到目標專案的 `.codex/skills/`。

下載大小約 100MB（包含 PDF 說明文件），實際複製的 Skills 為 29 個目錄。

### Step 5：環境驗證

安裝完成後自動驗證：

| 驗證項目                          | 預期值    |
| --------------------------------- | --------- |
| `agents/*.toml` 檔案數            | 4 個      |
| `.codex/config.toml` 存在         | 是        |
| `skills/` 目錄數（含 SKILL.md）   | 31 個以上 |

---

## 安裝輸出範例

```text
╔══════════════════════════════════════════════════════╗
║  dotnet-testing Agent Orchestration（Codex）安裝程式  ║
╚══════════════════════════════════════════════════════╝

[INFO] 來源 repo：/path/to/dotnet-testing-agent-orchestration-codex-lab
[INFO] 目標專案：/path/to/your-project

Step 1: 複製 .codex/agents/（4 個 Subagent 定義檔，.toml）
──────────────────────────────────────────────────
[OK]   已複製：dotnet-testing-analyzer.toml
[OK]   已複製：dotnet-testing-writer.toml
[OK]   已複製：dotnet-testing-executor.toml
[OK]   已複製：dotnet-testing-reviewer.toml
[OK] 已複製 4 個 .toml 檔案到 /path/to/your-project/.codex/agents

Step 2: 複製 .codex/config.toml（Codex workspace 設定）
──────────────────────────────────────────────────
[OK] 已複製：config.toml 到 /path/to/your-project/.codex/config.toml

Step 3: 複製 .codex/skills/（本 repo 內建的 Skills）
──────────────────────────────────────────────────
[OK]   已複製：dotnet-test/ （1 個檔案）
[OK]   已複製：dotnet-testing-orchestrator-unit/ （1 個檔案）

Step 4: 下載並複製 dotnet-testing-agent-skills（技術型 Skills）
──────────────────────────────────────────────────
[INFO] 查詢 GitHub release：kevintsengtw/dotnet-testing-agent-skills
[INFO] 最新版本：v2.4.1
[INFO] 下載中：https://...
[OK] 下載完成：102800 KB
[INFO] 解壓縮中...
[OK] 已複製 29 個技術型 Agent Skills

Step 5: 環境驗證
──────────────────────────────────────────────────
  [PASS] agents/*.toml：4 個（預期 4）
  [PASS] .codex/config.toml：存在
  [PASS] skills/ 目錄（含 SKILL.md）：31 個（預期 >= 31）

  安裝成功！所有驗證項目通過。
```

---

## 冪等設計

指令碼可安全重複執行，不會破壞已有設定：

- 檔案複製採覆蓋方式，確保目標與來源同步
- 不會修改目標專案的其他既有檔案

---

## 常見問題

**Q：Step 4 下載速度很慢或失敗**

Agent Skills 的 zipball 約 100MB（含 PDF 說明文件），下載時間取決於網路速度。若失敗，重新執行指令碼即可（Steps 1~3 為本地複製，不受影響）。

**Q：驗證顯示 skills 數量不符（FAIL）**

若 `dotnet-testing-agent-skills` repo 新增了更多 Skills，驗證的預期下限仍為 31，不會因為數量變多而 FAIL。若數量低於 31，可能是 Step 4 下載或解壓失敗，重新執行指令碼即可。

**Q：可以只重新安裝 Agent Skills 而不重複複製其他檔案嗎**

目前指令碼沒有選擇性執行的選項，完整重新執行即可（整個過程採覆蓋設計，不會造成損壞）。
