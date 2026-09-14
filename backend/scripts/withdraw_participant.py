"""Preview or delete one experiment participant's server-side research records."""

from __future__ import annotations

import argparse
import re
import sqlite3
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app.storage import ResearchStore
from app.config import DATABASE_PATH, TURSO_DATABASE_URL


def withdraw_participant(
    database: Path | None, participant_code: str, *, execute: bool = False,
    store: ResearchStore | None = None,
) -> dict[str, int]:
    if not re.fullmatch(r"[A-Za-z0-9_-]{3,32}", participant_code):
        raise ValueError("participant code must be 3-32 letters, digits, underscores, or hyphens")
    local_database = database or Path(DATABASE_PATH)
    if store is None and (database or not TURSO_DATABASE_URL) and not local_database.is_file():
        raise FileNotFoundError(local_database)
    learner_hash = ResearchStore.hash_id(f"study_{participant_code}")
    connection = (store or ResearchStore.from_config(database)).connect()
    try:
        if execute:
            connection.execute("BEGIN IMMEDIATE")
        targets = {
            "learner_profiles": ("learner_id", learner_hash),
            "study_events": ("learner_hash", learner_hash),
            "analysis_runs": ("learner_hash", learner_hash),
        }
        counts = {
            table: connection.execute(f"SELECT count(*) AS total FROM {table} WHERE {column} = ?", (value,)).fetchone()["total"]
            for table, (column, value) in targets.items()
        }
        if execute:
            for table, (column, value) in targets.items():
                connection.execute(f"DELETE FROM {table} WHERE {column} = ?", (value,))
            connection.commit()
        return counts
    except Exception:
        if execute:
            connection.rollback()
        raise
    finally:
        connection.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Preview then delete one participant's server-side records.")
    parser.add_argument("--participant-code", required=True)
    parser.add_argument("--database", type=Path, help="Explicit local SQLite file (otherwise use configured Turso or local DB).")
    parser.add_argument("--execute", action="store_true", help="Actually delete, rather than show matching row counts.")
    parser.add_argument("--confirm-code", help="Must exactly match participant code when --execute is used.")
    args = parser.parse_args()
    if args.execute and args.confirm_code != args.participant_code:
        parser.error("--confirm-code must exactly match --participant-code")
    try:
        counts = withdraw_participant(args.database, args.participant_code, execute=args.execute)
    except (ValueError, FileNotFoundError, sqlite3.Error) as error:
        parser.error(str(error))
    action = "deleted" if args.execute else "would delete"
    print(f"{action} for {args.participant_code}: " + ", ".join(f"{table}={count}" for table, count in counts.items()))
    if not args.execute:
        print("This was a preview. Add --execute --confirm-code CODE after checking the counts.")
    else:
        print("Also clear the participant's browser workspace and any exported CSVs, backups, and external survey rows.")


if __name__ == "__main__":
    main()
