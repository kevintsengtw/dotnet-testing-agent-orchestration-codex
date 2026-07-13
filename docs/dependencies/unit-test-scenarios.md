# unit-test-scenarios 上游來源

`.codex/skills/unit-test-scenarios/SKILL.md` 是外部 Agent Skill 的固定版本副本，不屬於本 repo 可自由修改的 orchestrator skills。

## 來源

- Repository: `https://github.com/kevintsengtw/unit-test-scenarios`
- Path: `skills/unit-test-scenarios/SKILL.md`
- Ref: `main`
- Commit: `d00501984383dfd0b111c33a091c48af20abec55`
- SHA-256: `148c9dcdfa74446ab837542d5b978479501f091d5b31008b41d0edc9bf4d98fb`

## 維護規則

1. 不直接修改 workspace 內的 `SKILL.md`。
2. 更新時重新從上游指定 commit 匯入完整檔案。
3. 更新本文件的 commit 與 SHA-256。
4. 比對匯入檔案與上游 raw content 完全一致後，才可提交。

## Workflow 關係

此 skill 是可選的前置情境產生器，不是 Analyzer → Writer → Executor → Reviewer 四階段中的第五個角色。

- 使用者已提供情境或測試資料：直接交給 unit orchestrator 的 Analyzer 逐項檢視。
- 使用者只想先取得情境：使用 `unit-test-scenarios`，不建立測試程式碼。
- 使用者要以 skill 產出作為測試依據：先取得該 skill 的 Markdown 產出，再在後續 unit orchestrator 提示詞中完整帶入。
