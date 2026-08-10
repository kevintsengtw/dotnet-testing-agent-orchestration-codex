# unit-test-scenarios 上游來源

`.agents/skills/unit-test-scenarios/SKILL.md` 是 lab setup 從公開 repository 抓取後建立的本機 Agent Skill，不是本 repo 內含、追蹤或發行的資產。

## 來源

- Repository: `https://github.com/kevintsengtw/unit-test-scenarios`
- Path: `skills/unit-test-scenarios/SKILL.md`
- Commit: `d00501984383dfd0b111c33a091c48af20abec55`
- SHA-256: `148c9dcdfa74446ab837542d5b978479501f091d5b31008b41d0edc9bf4d98fb`
- Lab lock: `unit-test-scenarios-lock.json`（不隨 public orchestration assets 發佈）

## 維護規則

1. 不直接修改 `.agents/skills/unit-test-scenarios/SKILL.md`。
2. 更新時修改 `unit-test-scenarios-lock.json` 的 exact commit 與 SHA-256。
3. 執行 `scripts/setup-lab-skills.mjs`，從公開 repo 重新抓取並安裝。
4. 通過 scenario contract 與完整 lab workflow 驗證後才可提交 lock 更新。
5. 不得把抓取後的 `.agents/skills/unit-test-scenarios` 加入 orchestration repository 或 public release。

## Workflow 關係

此 skill 是可選的前置情境產生器，不是 Analyzer → Writer → Executor → Reviewer 四階段中的第五個角色。

- 使用者已提供情境或測試資料：直接交給 unit orchestrator 的 Analyzer 逐項檢視。
- 使用者只想先取得情境：使用 `unit-test-scenarios`，不建立測試程式碼。
- 使用者要以 skill 產出作為測試依據：先取得該 skill 的 Markdown 產出，再在後續 unit orchestrator 提示詞中完整帶入。
