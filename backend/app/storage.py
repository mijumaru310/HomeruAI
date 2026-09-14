from __future__ import annotations

import csv
import hashlib
import json
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .schemas import LearnerState, StudyEventRequest


SCHEMA_VERSION = 1
FEATURE_VERSION = "process-v1"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class ResearchStore:
    """Append-only research events and versioned learner state.

    Raw worksheet images and stroke point arrays are deliberately not stored.
    """

    def __init__(self, database_path: str | Path):
        self.path = Path(database_path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.initialize()

    def connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=15)
        connection.row_factory = sqlite3.Row
        return connection

    def initialize(self) -> None:
        with closing(self.connect()) as connection, connection:
            connection.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS learner_profiles (
                    learner_id TEXT PRIMARY KEY,
                    state_json TEXT NOT NULL,
                    sample_count INTEGER NOT NULL DEFAULT 0,
                    updated_at TEXT NOT NULL,
                    schema_version INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS study_events (
                    event_id TEXT PRIMARY KEY,
                    learner_hash TEXT NOT NULL,
                    session_hash TEXT NOT NULL,
                    problem_id TEXT,
                    event_type TEXT NOT NULL,
                    occurred_at_ms INTEGER NOT NULL,
                    payload_json TEXT NOT NULL,
                    intervention_probability REAL,
                    feature_version TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_events_learner_time
                    ON study_events(learner_hash, occurred_at_ms);
                CREATE INDEX IF NOT EXISTS idx_events_session
                    ON study_events(session_hash, occurred_at_ms);
                CREATE TABLE IF NOT EXISTS analysis_runs (
                    analysis_id TEXT PRIMARY KEY,
                    learner_hash TEXT NOT NULL,
                    session_hash TEXT NOT NULL,
                    provider TEXT NOT NULL,
                    status TEXT NOT NULL,
                    error_category TEXT,
                    latency_ms INTEGER NOT NULL,
                    recognition_confidence REAL,
                    state_json TEXT NOT NULL,
                    metrics_json TEXT NOT NULL,
                    model_version TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
            """)

    @staticmethod
    def hash_id(value: str) -> str:
        return hashlib.sha256(value.encode("utf-8")).hexdigest()[:24]

    @staticmethod
    def _safe_payload(payload: dict[str, Any]) -> dict[str, Any]:
        forbidden_fragments = ("image", "base64", "stroke", "points", "api_key", "token")
        safe: dict[str, Any] = {}
        for key, value in payload.items():
            if any(fragment in key.lower() for fragment in forbidden_fragments):
                continue
            safe[key[:80]] = value
        serialized = json.dumps(safe, ensure_ascii=False, default=str)
        if len(serialized.encode("utf-8")) > 16_000:
            return {"discarded": "payload exceeded 16KB"}
        return safe

    def append_event(self, event: StudyEventRequest) -> bool:
        payload = self._safe_payload(event.payload)
        with closing(self.connect()) as connection, connection:
            cursor = connection.execute(
                """
                INSERT OR IGNORE INTO study_events (
                    event_id, learner_hash, session_hash, problem_id, event_type,
                    occurred_at_ms, payload_json, intervention_probability,
                    feature_version, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    event.eventId,
                    self.hash_id(event.learnerId),
                    self.hash_id(event.sessionId),
                    event.problemId,
                    event.eventType,
                    event.timestamp,
                    json.dumps(payload, ensure_ascii=False, default=str),
                    event.interventionProbability,
                    FEATURE_VERSION,
                    _now(),
                ),
            )
            return cursor.rowcount > 0

    def get_profile(self, learner_id: str) -> tuple[LearnerState | None, int, str]:
        with closing(self.connect()) as connection, connection:
            row = connection.execute(
                "SELECT state_json, sample_count, updated_at FROM learner_profiles WHERE learner_id = ?",
                (self.hash_id(learner_id),),
            ).fetchone()
        if not row:
            return None, 0, _now()
        return LearnerState.model_validate_json(row["state_json"]), row["sample_count"], row["updated_at"]

    def save_profile(self, learner_id: str, state: LearnerState) -> tuple[int, str]:
        learner_hash = self.hash_id(learner_id)
        updated_at = _now()
        with closing(self.connect()) as connection, connection:
            existing = connection.execute(
                "SELECT sample_count FROM learner_profiles WHERE learner_id = ?",
                (learner_hash,),
            ).fetchone()
            sample_count = (existing["sample_count"] if existing else 0) + 1
            connection.execute(
                """
                INSERT INTO learner_profiles (
                    learner_id, state_json, sample_count, updated_at, schema_version
                ) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(learner_id) DO UPDATE SET
                    state_json=excluded.state_json,
                    sample_count=excluded.sample_count,
                    updated_at=excluded.updated_at,
                    schema_version=excluded.schema_version
                """,
                (learner_hash, state.model_dump_json(), sample_count, updated_at, SCHEMA_VERSION),
            )
        return sample_count, updated_at

    def log_analysis(
        self,
        *,
        analysis_id: str,
        learner_id: str,
        session_id: str,
        provider: str,
        status: str,
        error_category: str | None,
        latency_ms: int,
        recognition_confidence: float | None,
        state: LearnerState,
        metrics: dict[str, Any],
    ) -> None:
        with closing(self.connect()) as connection, connection:
            connection.execute(
                """
                INSERT OR REPLACE INTO analysis_runs (
                    analysis_id, learner_hash, session_hash, provider, status,
                    error_category, latency_ms, recognition_confidence, state_json,
                    metrics_json, model_version, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    analysis_id,
                    self.hash_id(learner_id),
                    self.hash_id(session_id),
                    provider,
                    status,
                    error_category,
                    latency_ms,
                    recognition_confidence,
                    state.model_dump_json(),
                    json.dumps(metrics, ensure_ascii=False),
                    state.model_version,
                    _now(),
                ),
            )

    def get_dashboard_data(self, learner_id: str, history_limit: int = 40) -> dict[str, Any]:
        learner_hash = self.hash_id(learner_id)
        with closing(self.connect()) as connection, connection:
            rows = connection.execute(
                """
                SELECT session_hash, state_json, metrics_json, model_version, created_at
                FROM analysis_runs
                WHERE learner_hash = ?
                ORDER BY created_at ASC
                """,
                (learner_hash,),
            ).fetchall()
            event_days = connection.execute(
                """
                SELECT DISTINCT substr(datetime(occurred_at_ms / 1000, 'unixepoch'), 1, 10) AS day
                FROM study_events
                WHERE learner_hash = ? AND event_type IN ('analysis_completed', 'next_problem_started')
                ORDER BY day DESC
                """,
                (learner_hash,),
            ).fetchall()

        total_strokes = total_revisions = total_restarts = 0
        history: list[dict[str, Any]] = []
        for row in rows:
            state = json.loads(row["state_json"])
            metrics = json.loads(row["metrics_json"])
            total_strokes += int(metrics.get("stroke_count", 0))
            total_revisions += int(metrics.get("revision_count", 0))
            total_restarts += int(metrics.get("restart_count", 0))
            history.append({
                "timestamp": row["created_at"],
                "mastery": state["mastery"],
                "autonomous_engagement": state["autonomous_engagement"],
                "support_need": state["support_need"],
                "persistence": state["persistence"],
                "confidence": state["confidence"],
                "model_version": row["model_version"],
            })

        # XP is deliberately monotonic. State estimates may move down when the
        # problem becomes harder, which must not make effort look "lost".
        total_xp = (
            len(rows) * 40
            + min(total_strokes, len(rows) * 30) * 2
            + total_revisions * 8
            + total_restarts * 12
        )
        xp_to_next = 240
        level = total_xp // xp_to_next + 1
        days = [row["day"] for row in event_days if row["day"]]
        streak_days = 0
        if days:
            from datetime import date, timedelta

            parsed = {date.fromisoformat(day) for day in days}
            cursor = max(parsed)
            while cursor in parsed:
                streak_days += 1
                cursor -= timedelta(days=1)

        achievements: list[str] = []
        if rows:
            achievements.append("最初の一歩")
        if total_revisions:
            achievements.append("見直し名人")
        if total_restarts:
            achievements.append("もう一度進める力")
        if len(rows) >= 5:
            achievements.append("学びの連続記録 5")
        if len(rows) >= 10:
            achievements.append("学びの連続記録 10")
        if streak_days >= 3:
            achievements.append("3日間の学習習慣")

        return {
            "level": level,
            "total_xp": total_xp,
            "level_xp": total_xp % xp_to_next,
            "xp_to_next_level": xp_to_next,
            "total_analyses": len(rows),
            "total_sessions": len({row["session_hash"] for row in rows}),
            "total_strokes": total_strokes,
            "total_revisions": total_revisions,
            "total_restarts": total_restarts,
            "streak_days": streak_days,
            "achievements": achievements,
            "history": history[-max(1, min(history_limit, 60)):],
        }

    def export_training_csv(self, destination: str | Path) -> int:
        """Export derived data only. Outcomes are joined later by session/event ID."""
        destination = Path(destination)
        destination.parent.mkdir(parents=True, exist_ok=True)
        with closing(self.connect()) as connection, connection:
            rows = connection.execute("""
                SELECT analysis_id, learner_hash, session_hash, status, latency_ms,
                       recognition_confidence, state_json, metrics_json,
                       model_version, created_at
                FROM analysis_runs ORDER BY created_at
            """).fetchall()
        fields = [
            "analysis_id", "learner_hash", "session_hash", "status", "latency_ms",
            "recognition_confidence", "mastery", "autonomous_engagement",
            "support_need", "persistence", "state_confidence", "state_model_version",
            "metrics_json", "created_at",
        ]
        with destination.open("w", newline="", encoding="utf-8-sig") as handle:
            writer = csv.DictWriter(handle, fieldnames=fields)
            writer.writeheader()
            for row in rows:
                state = json.loads(row["state_json"])
                writer.writerow({
                    "analysis_id": row["analysis_id"],
                    "learner_hash": row["learner_hash"],
                    "session_hash": row["session_hash"],
                    "status": row["status"],
                    "latency_ms": row["latency_ms"],
                    "recognition_confidence": row["recognition_confidence"],
                    "mastery": state["mastery"],
                    "autonomous_engagement": state["autonomous_engagement"],
                    "support_need": state["support_need"],
                    "persistence": state["persistence"],
                    "state_confidence": state["confidence"],
                    "state_model_version": row["model_version"],
                    "metrics_json": row["metrics_json"],
                    "created_at": row["created_at"],
                })
        return len(rows)

    def export_study_events_csv(self, destination: str | Path) -> int:
        """Export pseudonymous behavioral events for joining to an external survey."""
        destination = Path(destination)
        destination.parent.mkdir(parents=True, exist_ok=True)
        with closing(self.connect()) as connection, connection:
            rows = connection.execute("""
                SELECT event_id, learner_hash, session_hash, problem_id, event_type,
                       occurred_at_ms, payload_json, intervention_probability,
                       feature_version, created_at
                FROM study_events ORDER BY occurred_at_ms
            """).fetchall()
        fields = [
            "event_id", "learner_hash", "session_hash", "problem_id", "event_type",
            "occurred_at_ms", "feedback_condition", "analysis_id", "analysis_source",
            "intervention_action", "intervention_probability", "feature_version",
            "payload_json", "created_at",
        ]
        with destination.open("w", newline="", encoding="utf-8-sig") as handle:
            writer = csv.DictWriter(handle, fieldnames=fields)
            writer.writeheader()
            for row in rows:
                payload = json.loads(row["payload_json"])
                writer.writerow({
                    "event_id": row["event_id"],
                    "learner_hash": row["learner_hash"],
                    "session_hash": row["session_hash"],
                    "problem_id": row["problem_id"],
                    "event_type": row["event_type"],
                    "occurred_at_ms": row["occurred_at_ms"],
                    "feedback_condition": payload.get("feedback_condition"),
                    "analysis_id": payload.get("analysis_id"),
                    "analysis_source": payload.get("source"),
                    "intervention_action": payload.get("intervention_action") or payload.get("action"),
                    "intervention_probability": row["intervention_probability"],
                    "feature_version": row["feature_version"],
                    "payload_json": row["payload_json"],
                    "created_at": row["created_at"],
                })
        return len(rows)
