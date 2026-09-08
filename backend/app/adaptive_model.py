from __future__ import annotations

import json
import math
from functools import lru_cache
from pathlib import Path

from .config import SUPPORT_MODEL_PATH


FEATURE_NAMES = [
    "mastery",
    "autonomous_engagement",
    "persistence",
    "idle_seconds",
    "unresolved_pause_ratio",
    "repeated_region_signal",
    "difficulty_gap",
    "hint_count",
]


@lru_cache(maxsize=1)
def load_support_model() -> dict | None:
    path = Path(SUPPORT_MODEL_PATH)
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        if payload.get("feature_names") != FEATURE_NAMES:
            return None
        if len(payload.get("coefficients", [])) != len(FEATURE_NAMES):
            return None
        return payload
    except (OSError, ValueError, TypeError):
        return None


def predict_support_need(features: dict[str, float]) -> tuple[float, str] | None:
    model = load_support_model()
    if not model:
        return None
    means = model.get("feature_means", [0.0] * len(FEATURE_NAMES))
    scales = model.get("feature_scales", [1.0] * len(FEATURE_NAMES))
    normalized = [
        (float(features[name]) - float(means[index])) / max(1e-9, float(scales[index]))
        for index, name in enumerate(FEATURE_NAMES)
    ]
    logit = float(model["intercept"]) + sum(
        float(coefficient) * value
        for coefficient, value in zip(model["coefficients"], normalized)
    )
    probability = 1 / (1 + math.exp(-max(-30, min(30, logit))))
    return probability, str(model.get("model_version", "logistic-unknown"))
