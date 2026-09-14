"""Audit completeness of one adult-math study without exporting raw writing."""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from collections import Counter
from contextlib import closing
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from scripts.create_experiment_assignments import PROTOCOL_VERSION, SETS
from app.config import DATABASE_PATH, TURSO_DATABASE_URL
from app.storage import ResearchStore


def summarize_events(events: list[dict], assigned_set: str, assigned_condition: str) -> dict[str, str | int]:
    types = Counter(event["event_type"] for event in events)
    analyses = [event for event in events if event["event_type"] == "analysis_completed"]
    feedback = [event for event in events if event["event_type"] == "feedback_displayed"]
    skipped = [event for event in events if event["event_type"] == "trial_skipped"]
    choices = [event for event in events if event["event_type"] == "experiment_optional_choice"]
    sources = Counter(event.get("payload", {}).get("source", "unknown") for event in analyses)
    versions = {event.get("payload", {}).get("protocol_version") for event in events}
    mismatched = sum(
        1 for event in events
        if event.get("payload", {}).get("study_set") not in (None, assigned_set)
        or event.get("payload", {}).get("feedback_condition") not in (None, assigned_condition)
    )
    flags = []
    if not types["experiment_started"]: flags.append("not_started")
    if types["experiment_started"] > 1: flags.append("repeated_start")
    analysis_trials = Counter(event.get("payload", {}).get("trial") for event in analyses)
    feedback_trials = Counter(event.get("payload", {}).get("trial") for event in feedback)
    skipped_trials = Counter(event.get("payload", {}).get("trial") for event in skipped)
    if any(not feedback_trials[trial] for trial in analysis_trials): flags.append("missing_feedback_exposure")
    if any(count > 1 for count in analysis_trials.values()): flags.append("duplicate_analysis_trial")
    if any(trial in skipped_trials for trial in analysis_trials): flags.append("analysis_and_skip_same_trial")
    if types["experiment_finished"] and any(not analysis_trials[trial] and not skipped_trials[trial] for trial in (1, 2, 3)):
        flags.append("missing_required_trial_outcome")
    if len(choices) != 1: flags.append("missing_or_duplicate_choice")
    if types["experiment_finished"] != 1: flags.append("missing_or_duplicate_finish")
    if mismatched: flags.append("assignment_mismatch")
    if len(sources) > 1: flags.append("mixed_analysis_source")
    if versions and versions != {PROTOCOL_VERSION}: flags.append("protocol_version_mismatch")
    return {
        "analysis_count": len(analyses),
        "feedback_displayed_count": len(feedback),
        "feedback_closed_count": types["feedback_closed"],
        "first_stroke_count": types["first_stroke"],
        "skipped_trial_count": types["trial_skipped"],
        "local_fallback_count": sources["local_fallback"],
        "ai_or_hybrid_count": sources["ai"] + sources["hybrid"],
        "protocol_versions": ";".join(sorted(str(value) for value in versions)),
        "optional_choice": (
            str(choices[-1].get("payload", {}).get("chose_optional", "unknown")).lower()
            if choices else "missing"
        ),
        "completed": int(bool(types["experiment_finished"])),
        "flags": ";".join(flags),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Audit assigned participants and event completeness.")
    parser.add_argument("--assignments", type=Path, required=True, help="Private CSV from create_experiment_assignments.py")
    parser.add_argument("--database", type=Path, help="Explicit local SQLite file (otherwise use configured Turso or local DB).")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.resolve() == args.assignments.resolve():
        raise SystemExit("audit output must not overwrite the assignment sheet")
    if args.output.exists():
        raise SystemExit(f"refusing to overwrite existing audit: {args.output}")
    local_database = args.database or Path(DATABASE_PATH)
    if (args.database or not TURSO_DATABASE_URL) and not local_database.is_file():
        raise SystemExit(f"database not found: {local_database}")

    with args.assignments.open(newline="", encoding="utf-8-sig") as handle:
        assignments = list(csv.DictReader(handle))
    if not assignments:
        raise SystemExit("assignment sheet is empty")
    for row in assignments:
        if not re.fullmatch(r"[A-Za-z0-9_-]{3,32}", row.get("participant_code", "")):
            raise SystemExit("assignment sheet has an invalid participant code")
        if row.get("study_set") not in SETS or row.get("feedback_condition") not in {"praise", "neutral"}:
            raise SystemExit("assignment sheet has an invalid set or condition")
        if row.get("protocol_version") != PROTOCOL_VERSION:
            raise SystemExit("assignment sheet has an unexpected protocol version")

    output_rows = []
    with closing(ResearchStore.from_config(args.database).connect()) as connection:
        for assignment in assignments:
            code = assignment["participant_code"]
            learner_hash = ResearchStore.hash_id(f"study_{code}")
            rows = connection.execute(
                "SELECT event_type, payload_json FROM study_events WHERE learner_hash=? ORDER BY occurred_at_ms, created_at",
                (learner_hash,),
            ).fetchall()
            events = [{"event_type": row["event_type"], "payload": json.loads(row["payload_json"])} for row in rows]
            condition = "neutral_summary" if assignment["feedback_condition"] == "neutral" else "process_praise"
            summary = summarize_events(events, assignment["study_set"], condition)
            output_rows.append({
                "participant_code": code, "learner_hash": learner_hash,
                "assigned_protocol_version": assignment["protocol_version"],
                "study_set": assignment["study_set"],
                "feedback_condition": assignment["feedback_condition"],
                **summary,
            })
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, fieldnames=output_rows[0].keys())
        writer.writeheader()
        writer.writerows(output_rows)
    flagged = sum(bool(row["flags"]) for row in output_rows)
    print(f"audited={len(output_rows)} flagged={flagged} output={args.output.resolve()}")
    print("This audit detects missing server events, not unsent events remaining on a participant's device.")


if __name__ == "__main__":
    main()
