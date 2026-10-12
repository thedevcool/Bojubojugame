"""The changelog hard gate (run by CI on every pull request).

    python scripts/changelog_gate.py origin/main

Fails (exit 1) when the pull request:
  1. changes game code without adding a new release section at the top of CHANGELOG.md;
  2. has a top CHANGELOG.md version that differs from the newest version in frontend/src/lib/changelog.ts;
  3. removes or rewrites a Protected features line (`Pxx`) without "Removes `Pxx`" / "Changes `Pxx`"
     in its new release section.
See CHANGELOG.md and ENGINEERING_STANDARDS.md §1.8.
"""

from __future__ import annotations

import re
import subprocess
import sys

CODE = ("backend/app/", "frontend/src/", "frontend/app/", "frontend/public/")
RELEASE = re.compile(r"^## (\d+\.\d+\.\d+)\b", re.M)
PROTECTED = re.compile(r"^- `(P\d+)` (.+)$", re.M)


def git(*args: str) -> str:
    return subprocess.run(["git", *args], check=True, capture_output=True, text=True).stdout


def show(ref: str, path: str) -> str:
    try:
        return git("show", f"{ref}:{path}")
    except subprocess.CalledProcessError:
        return ""


def releases(text: str) -> list[str]:
    return RELEASE.findall(text)


def section(text: str, version: str) -> str:
    """The body of one release section (up to the next level-2 heading)."""
    m = re.search(rf"^## {re.escape(version)}\b.*?$(.*?)(?=^## |\Z)", text, re.M | re.S)
    return m.group(1) if m else ""


def protected(text: str) -> dict[str, str]:
    return {pid: line.strip() for pid, line in PROTECTED.findall(text)}


def main(base: str) -> int:
    changed = [f for f in git("diff", "--name-only", f"{base}...HEAD").splitlines() if f]
    head_log = open("CHANGELOG.md", encoding="utf-8").read()
    base_log = show(base, "CHANGELOG.md")
    errors: list[str] = []

    head_versions, base_versions = releases(head_log), releases(base_log)
    top = head_versions[0] if head_versions else None
    new = [v for v in head_versions if v not in base_versions]
    touches_code = any(f.startswith(CODE) for f in changed)

    # 1. code changes need a new, non-empty release section at the top
    if touches_code:
        if not new:
            errors.append("Game code changed but CHANGELOG.md has no new release section (## X.Y.Z — date) at the top.")
        elif top not in new:
            errors.append(f"The new release section must be the top one (top is {top}).")
        elif not re.search(r"^- ", section(head_log, top), re.M):
            errors.append(f"Release {top} in CHANGELOG.md is empty: say what changed.")

    # 2. the player-facing What's New and this file agree on the current version
    ts = open("frontend/src/lib/changelog.ts", encoding="utf-8").read()
    m = re.search(r'version: "(\d+\.\d+\.\d+)"', ts)
    if top and m and m.group(1) != top:
        errors.append(f"CHANGELOG.md is at {top} but frontend/src/lib/changelog.ts (What's New) is at {m.group(1)}.")

    # 3. approved features never vanish or change quietly
    before, after = protected(base_log), protected(head_log)
    notes = "".join(section(head_log, v) for v in new)
    for pid, line in before.items():
        if pid not in after and f"Removes `{pid}`" not in notes:
            errors.append(f"Protected feature {pid} was removed without 'Removes `{pid}`' in the release notes: {line}")
        elif pid in after and after[pid] != line and f"Changes `{pid}`" not in notes and f"Removes `{pid}`" not in notes:
            errors.append(f"Protected feature {pid} was rewritten without 'Changes `{pid}`' in the release notes.")

    if errors:
        print("Changelog gate FAILED:\n" + "\n".join(f"  ✗ {e}" for e in errors))
        print("\nSee CHANGELOG.md (top) and ENGINEERING_STANDARDS.md §1.8.")
        return 1
    print(f"Changelog gate passed (release {top}; {len(after)} protected features).")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "origin/main"))
