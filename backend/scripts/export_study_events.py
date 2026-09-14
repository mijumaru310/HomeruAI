from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app.storage import ResearchStore


def main() -> None:
    parser = argparse.ArgumentParser(description="Export pseudonymous study events without raw writing data.")
    parser.add_argument("--database", help="Explicit local SQLite file (otherwise use configured Turso or local DB).")
    parser.add_argument("--output", default=str(BACKEND / "exports" / "study_events.csv"))
    parser.add_argument(
        "--participant-code",
        action="append",
        default=[],
        help="Also print the learner hash for an external-survey code such as P001.",
    )
    args = parser.parse_args()
    store = ResearchStore.from_config(args.database)
    count = store.export_study_events_csv(args.output)
    print(f"exported_rows={count} output={Path(args.output).resolve()}")
    for code in args.participant_code:
        if not re.fullmatch(r"[A-Za-z0-9_-]{3,32}", code):
            raise SystemExit(f"invalid participant code: {code!r}")
        print(f"participant_code={code} learner_hash={store.hash_id(f'study_{code}')}")


if __name__ == "__main__":
    main()
