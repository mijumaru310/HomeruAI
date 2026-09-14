"""Create a balanced, pseudonymous URL allocation sheet before recruitment.

The output is a researcher's private assignment list. It contains no names or
contact information and must not be committed to the repository.
"""

from __future__ import annotations

import argparse
import csv
import secrets
from pathlib import Path
from urllib.parse import urlencode, urlparse, urlunparse


SETS = ("easy", "standard", "challenge")
PROTOCOL_VERSION = "adult-pilot-v1.2"


def build_assignments(counts: dict[str, int], base_url: str) -> list[dict[str, str]]:
    parsed = urlparse(base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.query or parsed.fragment:
        raise ValueError("base URL must be an http(s) origin or path without query/fragment")
    rng = secrets.SystemRandom()
    rows: list[dict[str, str]] = []
    for set_id in SETS:
        count = counts.get(set_id, 0)
        if count < 0:
            raise ValueError("counts cannot be negative")
        conditions = ["praise", "neutral"] * (count // 2)
        if count % 2:
            conditions.append(rng.choice(("praise", "neutral")))
        rng.shuffle(conditions)
        for condition in conditions:
            code = f"P{secrets.token_hex(5).upper()}"
            query = urlencode({
                "experiment": "1", "participant": code,
                "studySet": set_id, "studyFeedback": condition,
            })
            rows.append({
                "participant_code": code,
                "protocol_version": PROTOCOL_VERSION,
                "study_set": set_id,
                "feedback_condition": condition,
                "url": urlunparse(parsed._replace(query=query)),
            })
    rng.shuffle(rows)
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate balanced adult-math experiment URLs.")
    parser.add_argument("--base-url", required=True, help="Example: http://192.168.0.15:3000/")
    for set_id in SETS:
        parser.add_argument(f"--{set_id}", type=int, default=0)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    if output.exists():
        raise SystemExit(f"refusing to overwrite existing assignment sheet: {output}")
    rows = build_assignments({set_id: getattr(args, set_id) for set_id in SETS}, args.base_url)
    if not rows:
        raise SystemExit("specify at least one participant")
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, fieldnames=("participant_code", "protocol_version", "study_set", "feedback_condition", "url"))
        writer.writeheader()
        writer.writerows(rows)
    print(f"created {len(rows)} assignments at {output}")
    print("Keep this file private; do not add names or commit it to Git.")


if __name__ == "__main__":
    main()
