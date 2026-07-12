import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.pipeline import run_pipeline


def main() -> None:
    parser = argparse.ArgumentParser(description="Run RAG evaluation bench")
    parser.add_argument("--config", default=str(ROOT / "configs" / "default.yaml"))
    args = parser.parse_args()

    results = run_pipeline(args.config)

    out_dir = ROOT / "results"
    out_dir.mkdir(exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out_path = out_dir / f"run_{stamp}.json"
    out_path.write_text(json.dumps(results, indent=2), encoding="utf-8")

    print(json.dumps(results["metrics"], indent=2))
    print(f"\nSaved: {out_path}")


if __name__ == "__main__":
    main()
