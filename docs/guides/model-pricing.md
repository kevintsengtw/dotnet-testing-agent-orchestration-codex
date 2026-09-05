# Agent 預設模型與模型計費

## Agent TOML 預設值

`.codex/agents/` 內的 16 個 agent 定義檔統一明確指定：

```toml
model = "gpt-5.6-sol"
model_reasoning_effort = "medium"
```

因此 Analyzer、Writer、Executor、Reviewer，以及 Unit、TUnit、Integration、Aspire 四種工作流程，預設都使用 GPT-5.6 Sol 與 `medium` 推理強度。單一執行環境或 Codex 版本若不支援該模型，應在執行前改用該環境可用的模型設定。

## API 計費比較

下表以 2026-08-07 查詢到的 OpenAI 官方 API 標準價格為準，單位是美元／每 1M tokens。`Cached input` 指 prompt cache read；不包含 Batch、Flex、Priority、長上下文加價、區域處理加價或工具呼叫費用。

| 模型 | Model ID | Input | Cached input | Output | 相對 GPT-5.4 input / output |
|---|---|---:|---:|---:|---:|
| GPT-5.4 | `gpt-5.4` | $2.50 | $0.25 | $15.00 | 1.0× / 1.0× |
| GPT-5.5 | `gpt-5.5` | $5.00 | $0.50 | $30.00 | 2.0× / 2.0× |
| GPT-5.6 Sol | `gpt-5.6-sol` | $5.00 | $0.50 | $30.00 | 2.0× / 2.0× |
| GPT-5.6 Terra | `gpt-5.6-terra` | $2.50 | $0.25 | $15.00 | 1.0× / 1.0× |
| GPT-5.6 Luna | `gpt-5.6-luna` | $1.00 | $0.10 | $6.00 | 0.4× / 0.4× |

GPT-5.5 與 GPT-5.6 Sol 的標準 input／output 單位費率相同，因此本 repo 將 agent 預設切換至能力較高的 GPT-5.6 Sol，並固定使用 `medium` 推理強度。費率相同不代表每次執行的總成本相同；實際成本仍取決於輸入、快取輸入、推理與輸出 token 數。

### 官方來源

- [GPT-5.4 Model — OpenAI API](https://developers.openai.com/api/docs/models/gpt-5.4)
- [GPT-5.5 Model — OpenAI API](https://developers.openai.com/api/docs/models/gpt-5.5)
- [GPT-5.6 模型預覽與費率 — OpenAI Help Center](https://help.openai.com/en/articles/20001325-a-preview-of-gpt-56-sol-terra-and-luna)
- [GPT-5.6 — OpenAI](https://openai.com/index/gpt-5-6/)

價格可能變更；正式部署或成本核算應再次查閱官方價格頁。
