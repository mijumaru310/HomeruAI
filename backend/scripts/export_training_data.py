from __future__ import annotations

import argparse
import sys
from pathlib import Path


BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app.storage import ResearchStore


def main() -> None:
    parser = argparse.ArgumentParser(description="Export derived research features without raw images.")
    parser.add_argument("--database", help="Explicit local SQLite file (otherwise use configured Turso or local DB).")
    parser.add_argument("--output", default=str(BACKEND / "exports" / "analysis_features.csv"))
    args = parser.parse_args()
    count = ResearchStore.from_config(args.database).export_training_csv(args.output)
    print(f"exported_rows={count} output={Path(args.output).resolve()}")


if __name__ == "__main__":
    main()
