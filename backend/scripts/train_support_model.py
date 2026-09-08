from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path


BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app.adaptive_model import FEATURE_NAMES
from app.config import DATABASE_PATH, SUPPORT_MODEL_PATH


def load_samples(database: str) -> tuple[list[list[float]], list[int], list[str]]:
    connection = sqlite3.connect(database)
    connection.row_factory = sqlite3.Row
    events = connection.execute("""
        SELECT learner_hash, session_hash, event_type, occurred_at_ms, payload_json
        FROM study_events ORDER BY session_hash, occurred_at_ms
    """).fetchall()
    connection.close()
    samples: list[list[float]] = []
    labels: list[int] = []
    groups: list[str] = []
    for index, event in enumerate(events):
        if event["event_type"] != "intervention_offered":
            continue
        payload = json.loads(event["payload_json"])
        state = payload.get("state") or {}
        if not all(name in state for name in ("mastery", "autonomous_engagement", "persistence")):
            continue
        later = [
            candidate for candidate in events[index + 1:]
            if candidate["session_hash"] == event["session_hash"]
            and candidate["occurred_at_ms"] - event["occurred_at_ms"] <= 300_000
        ]
        positive = any(
            candidate["event_type"] in {"hint_opened", "writing_resumed", "next_problem_started"}
            or (
                candidate["event_type"] == "feedback_rating"
                and json.loads(candidate["payload_json"]).get("rating") == "helpful"
            )
            for candidate in later
        )
        explicit_negative = any(
            candidate["event_type"] == "intervention_dismissed"
            or (
                candidate["event_type"] == "feedback_rating"
                and json.loads(candidate["payload_json"]).get("rating") == "not_for_me"
            )
            for candidate in later
        )
        # Do not turn a missing follow-up into a negative label. The learner may
        # simply have closed the browser before the five-minute window elapsed.
        if not positive and not explicit_negative:
            continue
        label = int(positive)
        samples.append([
            float(state["mastery"]),
            float(state["autonomous_engagement"]),
            float(state["persistence"]),
            float(payload.get("idle_seconds", 0)),
            float(payload.get("unresolved_pause_ratio", 0)),
            float(payload.get("repeated_region_signal", 0)),
            float(payload.get("difficulty_gap", 0)),
            float(payload.get("hint_count", 0)),
        ])
        labels.append(label)
        groups.append(event["learner_hash"])
    return samples, labels, groups


def main() -> None:
    parser = argparse.ArgumentParser(description="Train an explainable support-need boundary model.")
    parser.add_argument("--database", default=DATABASE_PATH)
    parser.add_argument("--output", default=SUPPORT_MODEL_PATH)
    parser.add_argument("--minimum-samples", type=int, default=30)
    args = parser.parse_args()
    try:
        from sklearn.linear_model import LogisticRegression
        from sklearn.metrics import balanced_accuracy_score, log_loss
        from sklearn.model_selection import GroupKFold, cross_val_predict
        from sklearn.preprocessing import StandardScaler
    except ImportError as error:
        raise SystemExit("Install optional ML dependencies: pip install -r requirements-ml.txt") from error

    samples, labels, groups = load_samples(args.database)
    if len(samples) < args.minimum_samples or len(set(labels)) < 2:
        raise SystemExit(
            f"Not enough balanced data: samples={len(samples)} classes={sorted(set(labels))}. "
            "Keep using rules-v1 and collect more consented sessions."
        )
    scaler = StandardScaler().fit(samples)
    normalized = scaler.transform(samples)
    model = LogisticRegression(class_weight="balanced", max_iter=2_000)
    unique_groups = len(set(groups))
    metrics: dict[str, float | int] = {
        "sample_count": len(samples), "learner_count": unique_groups
    }
    if unique_groups >= 3:
        folds = min(5, unique_groups)
        probabilities = cross_val_predict(
            model, normalized, labels, groups=groups, cv=GroupKFold(folds), method="predict_proba"
        )[:, 1]
        predictions = [int(value >= 0.5) for value in probabilities]
        metrics.update({
            "group_cv_folds": folds,
            "balanced_accuracy": round(float(balanced_accuracy_score(labels, predictions)), 4),
            "log_loss": round(float(log_loss(labels, probabilities)), 4),
        })
    model.fit(normalized, labels)
    created_at = datetime.now(timezone.utc)
    output = {
        "model_version": f"support-logistic-{created_at.strftime('%Y%m%d%H%M%S')}",
        "created_at": created_at.isoformat(),
        "feature_names": FEATURE_NAMES,
        "feature_means": scaler.mean_.tolist(),
        "feature_scales": scaler.scale_.tolist(),
        "coefficients": model.coef_[0].tolist(),
        "intercept": float(model.intercept_[0]),
        "metrics": metrics,
        "label_definition": "explicit engagement (hint, writing resume, next problem, or helpful rating) versus explicit dismissal/not-for-me within five minutes",
        "limitations": "Predictive observational model; randomized safe interventions are required for causal claims.",
    }
    destination = Path(args.output)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"output": str(destination.resolve()), "metrics": metrics}, ensure_ascii=False))


if __name__ == "__main__":
    main()
