#!/usr/bin/env python3
"""
install-dotnet-testing-agents.py

一鍵安裝 dotnet-testing Agent Orchestration（Codex 版）所需的全部元件到指定的目標專案。

安裝內容（全部裝到目標專案的 .codex/）：
  1. .codex/agents/   — 4 個 Subagent 定義檔（.toml，直接從本 repo 複製）
  2. .codex/config.toml — Codex workspace 設定（直接從本 repo 複製）
  3. .codex/skills/   — 本 repo 內建的 Orchestrator / dotnet-test Skills（直接從本 repo 複製）
  4. .codex/skills/   — 29 個技術型 Agent Skills（從 dotnet-testing-agent-skills GitHub release 下載後複製）

本版說明：
  - 目錄慣例為 Codex 的 .codex/（非 Claude 的 .claude/）
  - agents 為 .toml（非 .md）
  - 不安裝 hooks、不寫 settings.json / config.toml 的 hooks 區段（本版不發佈 hooks）
  - 不安裝任何 token 統計腳本（Codex 版已 de-scope token 用量統計）

用法：
  python scripts/install-dotnet-testing-agents.py                    # 目標為目前工作目錄
  python scripts/install-dotnet-testing-agents.py /path/to/project   # 指定目標專案路徑
"""

import io
import json
import os
import shutil
import sys
import tempfile
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

# Windows 上強制 UTF-8 輸出，避免 CP950 / CP936 編碼錯誤
if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

# ─── 常數 ────────────────────────────────────────────────────────────────────

AGENT_SKILLS_REPO = "kevintsengtw/dotnet-testing-agent-skills"

EXPECTED_AGENTS = 4             # 4 個 subagent .toml（analyzer/writer/executor/reviewer）
EXPECTED_REPO_SKILLS = 2        # 本 repo 內建的 Skill 目錄（dotnet-test + orchestrator-unit）
EXPECTED_AGENT_SKILLS = 29      # 從 dotnet-testing-agent-skills 安裝的技術型 Skills
EXPECTED_TOTAL_SKILLS = EXPECTED_REPO_SKILLS + EXPECTED_AGENT_SKILLS  # 31

# ─── 顏色輸出 ─────────────────────────────────────────────────────────────────

_COLOR = sys.stdout.isatty() and os.environ.get("TERM") != "dumb"


def _c(code: str, text: str) -> str:
    return f"\x1b[{code}m{text}\x1b[0m" if _COLOR else text


def info(msg: str) -> None:
    print(f"{_c('34', '[INFO]')} {msg}")


def ok(msg: str) -> None:
    print(f"{_c('32', '[OK]')} {msg}")


def warn(msg: str) -> None:
    print(f"{_c('33', '[WARN]')} {msg}")


def err(msg: str) -> None:
    print(f"{_c('31', '[ERROR]')} {msg}", file=sys.stderr)


def step(n: int, title: str) -> None:
    print(f"\n{_c('36', f'Step {n}:')} {title}")
    print("─" * 50)


# ─── 輔助函式 ─────────────────────────────────────────────────────────────────

def copy_dir(src: Path, dst: Path) -> int:
    """遞迴複製目錄，覆蓋已存在的檔案，回傳複製的檔案數。"""
    dst.mkdir(parents=True, exist_ok=True)
    count = 0
    for item in src.rglob("*"):
        rel = item.relative_to(src)
        target = dst / rel
        if item.is_dir():
            target.mkdir(parents=True, exist_ok=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(item, target)
            count += 1
    return count


def copy_file(src: Path, dst: Path) -> None:
    """複製單一檔案，確保目標目錄存在。"""
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)


def fetch_latest_release_zipball(repo: str) -> str:
    """取得 GitHub 最新 release 的 zipball_url。"""
    api_url = f"https://api.github.com/repos/{repo}/releases/latest"
    req = urllib.request.Request(
        api_url,
        headers={
            "User-Agent": "dotnet-testing-installer/1.0",
            "Accept": "application/vnd.github+json",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode())
    tag = data.get("tag_name", "unknown")
    zipball_url = data["zipball_url"]
    info(f"最新版本：{tag}")
    return zipball_url


def download_file(url: str, dest: Path) -> None:
    """下載檔案到指定路徑，顯示簡易進度。"""
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "dotnet-testing-installer/1.0"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        total = int(resp.headers.get("Content-Length", 0))
        downloaded = 0
        chunk_size = 8192
        with open(dest, "wb") as f:
            while True:
                chunk = resp.read(chunk_size)
                if not chunk:
                    break
                f.write(chunk)
                downloaded += len(chunk)
                if total:
                    pct = downloaded * 100 // total
                    print(f"\r  下載中... {pct:3d}%", end="", flush=True)
    if total:
        print()  # newline after progress


def find_skill_dirs(extracted_root: Path) -> list:
    """找出解壓後所有包含 SKILL.md 的子目錄（即每個 Skill 的根目錄）。

    支援兩種常見的 zipball 結構：
    - 結構 A：skills 直接在 repo 根目錄下（<repo-root>/<skill-name>/SKILL.md）
    - 結構 B：skills 在 repo 根目錄的子目錄下（<repo-root>/skills/<skill-name>/SKILL.md）
    """
    top_dirs = sorted([d for d in extracted_root.iterdir() if d.is_dir()])
    if not top_dirs:
        return []
    # zipball 解壓後頂層通常只有一個 repo 目錄（如 kevintsengtw-dotnet-testing-agent-skills-abc123/）
    repo_root = top_dirs[0]

    # 結構 A：skill 目錄直接在 repo 根目錄下
    skills = [d for d in repo_root.iterdir() if d.is_dir() and (d / "SKILL.md").exists()]
    if skills:
        return skills

    # 結構 B：skill 目錄在某個子目錄（如 skills/）下
    for subdir in sorted(repo_root.iterdir()):
        if subdir.is_dir():
            nested = [d for d in subdir.iterdir() if d.is_dir() and (d / "SKILL.md").exists()]
            if nested:
                info(f"在子目錄 {subdir.name}/ 下找到 Skills")
                return nested

    return []


# ─── 安裝步驟 ─────────────────────────────────────────────────────────────────

def step1_copy_agents(source_codex: Path, target_codex: Path) -> bool:
    step(1, "複製 .codex/agents/（4 個 Subagent 定義檔，.toml）")
    src = source_codex / "agents"
    dst = target_codex / "agents"
    if not src.exists():
        err(f"來源目錄不存在：{src}")
        return False
    dst.mkdir(parents=True, exist_ok=True)
    copied = 0
    for toml_file in src.glob("*.toml"):
        copy_file(toml_file, dst / toml_file.name)
        copied += 1
        ok(f"  已複製：{toml_file.name}")
    ok(f"已複製 {copied} 個 .toml 檔案到 {dst}")
    return True


def step2_copy_config(source_codex: Path, target_codex: Path) -> bool:
    step(2, "複製 .codex/config.toml（Codex workspace 設定）")
    src = source_codex / "config.toml"
    dst = target_codex / "config.toml"
    if not src.exists():
        err(f"來源檔案不存在：{src}")
        return False
    copy_file(src, dst)
    ok(f"已複製：config.toml 到 {dst}")
    return True


def step3_copy_repo_skills(source_codex: Path, target_codex: Path) -> bool:
    step(3, "複製 .codex/skills/（本 repo 內建的 Skills）")
    src = source_codex / "skills"
    dst = target_codex / "skills"
    if not src.exists():
        err(f"來源目錄不存在：{src}")
        return False
    dst.mkdir(parents=True, exist_ok=True)
    copied_dirs = 0
    for skill_dir in src.iterdir():
        if skill_dir.is_dir() and (skill_dir / "SKILL.md").exists():
            target_skill = dst / skill_dir.name
            count = copy_dir(skill_dir, target_skill)
            ok(f"  已複製：{skill_dir.name}/ （{count} 個檔案）")
            copied_dirs += 1
    ok(f"共複製 {copied_dirs} 個 Skill 目錄")
    return True


def step4_install_agent_skills(target_codex: Path) -> bool:
    step(4, "下載並複製 dotnet-testing-agent-skills（技術型 Skills）")
    skills_dst = target_codex / "skills"
    skills_dst.mkdir(parents=True, exist_ok=True)

    # 4a. 取得 release zipball URL
    try:
        info(f"查詢 GitHub release：{AGENT_SKILLS_REPO}")
        zipball_url = fetch_latest_release_zipball(AGENT_SKILLS_REPO)
    except urllib.error.HTTPError as e:
        err(f"GitHub API 請求失敗（HTTP {e.code}）：{e.reason}")
        return False
    except urllib.error.URLError as e:
        err(f"網路連線失敗：{e.reason}")
        return False

    tmp_dir = Path(tempfile.mkdtemp(prefix="dotnet-skills-"))
    zip_path = tmp_dir / "agent-skills.zip"

    try:
        # 4b. 下載 zipball
        info(f"下載中：{zipball_url}")
        download_file(zipball_url, zip_path)
        ok(f"下載完成：{zip_path.stat().st_size // 1024} KB")

        # 4c. 解壓縮
        extract_dir = tmp_dir / "extracted"
        extract_dir.mkdir()
        info("解壓縮中...")
        with zipfile.ZipFile(zip_path, "r") as zf:
            zf.extractall(extract_dir)

        # 4d. 找出所有 Skill 目錄
        skill_dirs = find_skill_dirs(extract_dir)
        if not skill_dirs:
            err("解壓後找不到任何包含 SKILL.md 的目錄")
            return False
        info(f"找到 {len(skill_dirs)} 個 Skill 目錄")

        # 4e. 直接複製到 .codex/skills/
        for skill_dir in skill_dirs:
            target_skill = skills_dst / skill_dir.name
            copy_dir(skill_dir, target_skill)
        ok(f"已複製 {len(skill_dirs)} 個技術型 Agent Skills 到 {skills_dst}")

    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

    return True


def step5_verify(target_codex: Path) -> dict:
    step(5, "環境驗證")

    results = {}

    # agents/*.toml 數量
    agents_dir = target_codex / "agents"
    agent_files = list(agents_dir.glob("*.toml")) if agents_dir.exists() else []
    results["agents"] = len(agent_files)
    pass_fail = _c("32", "PASS") if len(agent_files) == EXPECTED_AGENTS else _c("31", "FAIL")
    print(f"  [{pass_fail}] agents/*.toml：{len(agent_files)} 個（預期 {EXPECTED_AGENTS}）")

    # config.toml 存在
    config = target_codex / "config.toml"
    results["config"] = config.exists()
    pass_fail = _c("32", "PASS") if config.exists() else _c("31", "FAIL")
    print(f"  [{pass_fail}] .codex/config.toml：{'存在' if config.exists() else '不存在'}")

    # skills/ 目錄數量（含 SKILL.md）
    skills_dir = target_codex / "skills"
    skill_dirs = (
        [d for d in skills_dir.iterdir() if d.is_dir() and (d / "SKILL.md").exists()]
        if skills_dir.exists()
        else []
    )
    results["skills"] = len(skill_dirs)
    pass_fail = _c("32", "PASS") if len(skill_dirs) >= EXPECTED_TOTAL_SKILLS else _c("31", "FAIL")
    print(
        f"  [{pass_fail}] skills/ 目錄（含 SKILL.md）：{len(skill_dirs)} 個"
        f"（預期 >= {EXPECTED_TOTAL_SKILLS} = {EXPECTED_REPO_SKILLS} repo + {EXPECTED_AGENT_SKILLS} agent-skills）"
    )

    return results


# ─── 主程式 ───────────────────────────────────────────────────────────────────

def main() -> int:
    print()
    print("╔══════════════════════════════════════════════════════╗")
    print("║  dotnet-testing Agent Orchestration（Codex）安裝程式  ║")
    print("╚══════════════════════════════════════════════════════╝")
    print()

    # 解析目標路徑
    target_dir = Path(sys.argv[1] if len(sys.argv) > 1 else os.getcwd()).resolve()
    # 指令碼位於 <repo>/scripts/install.py，source_codex 為 <repo>/.codex
    script_dir = Path(__file__).parent
    repo_root = script_dir.parent
    source_codex = repo_root / ".codex"
    target_codex = target_dir / ".codex"

    info(f"來源 repo：{repo_root}")
    info(f"目標專案：{target_dir}")

    # 驗證來源與目標
    if not source_codex.exists():
        err(f"來源 .codex/ 目錄不存在：{source_codex}")
        err("請確認此指令碼是從 dotnet-testing-agent-orchestration-codex-lab repo 執行")
        return 1
    if not target_dir.exists():
        err(f"目標目錄不存在：{target_dir}")
        return 1
    if target_dir == repo_root:
        warn("目標路徑與來源 repo 相同，將直接在本 repo 安裝 Agent Skills")

    step_results = {}

    step_results[1] = step1_copy_agents(source_codex, target_codex)
    step_results[2] = step2_copy_config(source_codex, target_codex)
    step_results[3] = step3_copy_repo_skills(source_codex, target_codex)
    step_results[4] = step4_install_agent_skills(target_codex)
    verify = step5_verify(target_codex)

    # 摘要
    print()
    print("╔══════════════════════════════════════════════════════╗")
    print("║  安裝摘要                                            ║")
    print("╚══════════════════════════════════════════════════════╝")

    step_labels = {
        1: "複製 agents/（.toml）",
        2: "複製 config.toml",
        3: "複製 repo skills/",
        4: "安裝技術型 Agent Skills",
    }
    all_ok = True
    for n, label in step_labels.items():
        status = _c("32", "OK  ") if step_results[n] else _c("31", "FAIL")
        print(f"  [{status}] Step {n}：{label}")
        if not step_results[n]:
            all_ok = False

    print()
    verify_ok = (
        verify.get("agents") == EXPECTED_AGENTS
        and verify.get("config")
        and verify.get("skills", 0) >= EXPECTED_TOTAL_SKILLS
    )
    if all_ok and verify_ok:
        print(_c("32", "  安裝成功！所有驗證項目通過。"))
    else:
        print(_c("31", "  安裝完成，但部分項目未通過驗證，請確認上方錯誤訊息。"))

    print()
    info("後續步驟：在 Codex 中呼叫 Orchestrator Skill：")
    print("  $dotnet-testing-orchestrator-unit")
    print()

    return 0 if (all_ok and verify_ok) else 1


if __name__ == "__main__":
    sys.exit(main())
