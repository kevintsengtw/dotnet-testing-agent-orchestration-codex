# 文件導覽

本 repo 為 **Codex 原生 Subagent** 的 .NET 測試工作流程。目前涵蓋 **Unit 測試**；Integration / Aspire / TUnit 為後續釋出 🚧。

## 快速導航

| 文件         | 說明                             | 連結                                                 |
| ------------ | -------------------------------- | ---------------------------------------------------- |
| 安裝與環境設定 | 完整安裝步驟、系統需求、常見問題 | [SETUP.md](SETUP.md)                                 |
| 架構總覽     | 整體架構、Mermaid 圖、設計決策   | [architecture/overview.md](architecture/overview.md) |
| 單元測試指南 | 指令範例、練習專案、工作流程細節 | [guides/unit-testing.md](guides/unit-testing.md)     |

## 架構文件

給想深入了解 Orchestrator 實作細節的讀者。

| 文件                                                      | 說明                                                         |
| --------------------------------------------------------- | ------------------------------------------------------------ |
| [overview.md](architecture/overview.md)                   | 整體架構圖（系統架構、SpawnAgent 流水線、工作流程、循序圖）   |
| [unit-orchestrator.md](architecture/unit-orchestrator.md) | 單元測試 Orchestrator：Agent Skills、工作流程細節、分割策略  |

> Integration / Aspire / TUnit 的 Orchestrator 架構文件待後續釋出。

## 使用指南

每份指南包含：前提條件、指令範例、練習專案說明、常見問題排查、工作流程細節。

| 文件                                      | 觸發方式                              | 必要環境 |
| ----------------------------------------- | ------------------------------------- | -------- |
| [unit-testing.md](guides/unit-testing.md) | `$dotnet-testing-orchestrator-unit`   | .NET SDK |

> Integration / Aspire / TUnit 的使用指南待後續釋出。

## 從哪裡開始？

- **第一次使用** → 先看 [SETUP.md](SETUP.md) 完成安裝，再看 [guides/unit-testing.md](guides/unit-testing.md) 試跑第一個工作流程
- **想了解架構** → 看 [architecture/overview.md](architecture/overview.md) 的 Mermaid 圖
- **想了解單元 Orchestrator 細節** → 看 [architecture/unit-orchestrator.md](architecture/unit-orchestrator.md)
