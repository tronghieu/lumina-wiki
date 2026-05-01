"""
_env.py — dotenv loader for Lumina research-pack tools.

Reads ~/.env first, then <project>/.env. Project-level values override
global ones. Returns a merged dict; does NOT mutate os.environ.

Usage (as a module):
    from _env import load_env
    env = load_env()
    api_key = env.get("SEMANTIC_SCHOLAR_API_KEY", "")

No CLI surface — this module is imported as a side-effect by other tools.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional


def _parse_dotenv(path: Path) -> dict[str, str]:
    """Parse a .env file into a dict. Ignores comments and blank lines.

    Supports:
      KEY=VALUE
      KEY="VALUE"
      KEY='VALUE'
      # comment lines
      blank lines

    Does not support multi-line values.
    """
    result: dict[str, str] = {}
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return result
    except OSError:
        return result

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        # Strip surrounding quotes
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
            value = value[1:-1]
        if key:
            result[key] = value
    return result


def load_env(project_root: Optional[Path] = None) -> dict[str, str]:
    """Load environment variables from ~/.env then <project_root>/.env.

    Project-level values override global ones. The returned dict contains
    the merged result; os.environ is never mutated.

    Args:
        project_root: Path to the project root. Defaults to the current
                      working directory if not provided.

    Returns:
        A dict[str, str] of merged env vars. Keys are upper-case by
        convention but case is preserved as written in the file.
    """
    if project_root is None:
        project_root = Path.cwd()

    global_env_path = Path.home() / ".env"
    project_env_path = project_root / ".env"

    merged: dict[str, str] = {}
    merged.update(_parse_dotenv(global_env_path))
    merged.update(_parse_dotenv(project_env_path))
    return merged
