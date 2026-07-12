"""Root entrypoint — regenerate adversarial failure_analysis.json."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
script = ROOT / "eval" / "scripts" / "run_failure_analysis.py"
raise SystemExit(subprocess.call([sys.executable, str(script), "--both"], cwd=ROOT))