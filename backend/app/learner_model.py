from __future__ import annotations

from .adaptive_model import predict_support_need
from .schemas import AIRecognition, Intervention, LearnerState, ProcessEvidence, ProcessMetrics


def _clamp(value: float) -> float:
    return round(max(0.0, min(1.0, value)), 3)


def estimate_learner_state(
    metrics: ProcessMetrics,
    recognition: AIRecognition | None = None,
    previous: LearnerState | None = None,
    *,
    idle_seconds: float = 0,
    hint_count: int = 0,
    page_visible: bool = True,
    problem_difficulty: float | None = None,
) -> LearnerState:
    """Interpretable cold-start model; every score is grounded in logged behavior.

    These are estimates of observable learning behavior, not personality labels.
    They are intentionally versioned so research data can later replace the
    coefficients with a trained and calibrated model.
    """
    prior_mastery = previous.mastery if previous else 0.42
    prior_autonomy = previous.autonomous_engagement if previous else 0.50
    prior_persistence = previous.persistence if previous else 0.48
    quality = recognition.progress_quality if recognition else "unknown"
    quality_signal = (
        {"unknown": 0.0, "starting": 0.02, "partial": 0.12, "mostly_correct": 0.24}[quality]
        * (recognition.confidence if recognition else 0)
    )
    difficulty = problem_difficulty if problem_difficulty is not None else 0.5

    revision_ratio = metrics.successful_revision_count / max(1, metrics.revision_count)
    restart_ratio = metrics.restart_count / max(1, metrics.pause_count)
    writing_signal = min(1.0, metrics.stroke_count / 18)
    mastery = _clamp(
        prior_mastery * 0.72
        + 0.10
        + quality_signal
        + revision_ratio * 0.10
        - max(0, difficulty - 0.5) * 0.10
    )
    persistence = _clamp(
        prior_persistence * 0.55
        + writing_signal * 0.20
        + restart_ratio * 0.15
        + min(1.0, metrics.revision_count / 3) * 0.10
    )
    autonomous = _clamp(
        prior_autonomy * 0.72
        + writing_signal * 0.13
        + persistence * 0.10
        - min(0.15, hint_count * 0.025)
    )

    idle_relative = max(0.0, idle_seconds - 8) / 35 if page_visible else 0
    unresolved_ratio = metrics.unresolved_pause_count / max(1, metrics.pause_count)
    repetition_signal = min(1.0, metrics.repeated_region_count / 5)
    rule_support_need = _clamp(
        0.10
        + min(0.55, idle_relative)
        + unresolved_ratio * 0.16
        + repetition_signal * 0.18
        + max(0, difficulty - mastery) * 0.18
        - restart_ratio * 0.10
    )
    learned = predict_support_need({
        "mastery": mastery,
        "autonomous_engagement": autonomous,
        "persistence": persistence,
        "idle_seconds": idle_seconds,
        "unresolved_pause_ratio": unresolved_ratio,
        "repeated_region_signal": repetition_signal,
        "difficulty_gap": max(0, difficulty - mastery),
        "hint_count": float(hint_count),
    })
    support_need = _clamp(rule_support_need if not learned else rule_support_need * 0.35 + learned[0] * 0.65)
    model_version = "rules-v1" if not learned else f"rules-v1+{learned[1]}"

    reasons: list[str] = []
    if metrics.successful_revision_count:
        reasons.append(f"消去後の書き直しを{metrics.successful_revision_count}回確認")
    if metrics.restart_count:
        reasons.append(f"考えたあとに{metrics.restart_count}回筆記を再開")
    if metrics.repeated_region_count >= 3:
        reasons.append("同じ領域で試行を重ねている")
    if idle_seconds >= 15 and page_visible:
        reasons.append(f"表示中のページで{idle_seconds:.0f}秒間筆記が停止")
    if hint_count:
        reasons.append(f"この問題でヒントを{hint_count}回利用")
    if recognition and recognition.confidence < 0.55:
        reasons.append("問題・筆記の画像認識に不確実性がある")
    if not reasons:
        reasons.append("現在までの筆記量と継続時間から初期推定")

    confidence = _clamp(0.25 + min(0.45, metrics.stroke_count / 40) + (0.12 if previous else 0))
    return LearnerState(
        mastery=mastery,
        autonomous_engagement=autonomous,
        support_need=support_need,
        persistence=persistence,
        confidence=confidence,
        reasons=reasons[:8],
        model_version=model_version,
    )


def choose_intervention(
    state: LearnerState,
    metrics: ProcessMetrics,
    evidence: list[ProcessEvidence],
    *,
    idle_seconds: float = 0,
    page_visible: bool = True,
    hint_levels: list[str] | None = None,
) -> Intervention:
    latest_evidence = evidence[-1].evidence_id if evidence else None
    hints = (hint_levels or [])[:3]
    if not hints:
        hints = [
            "問題で分かっている数や条件を一つ囲んでみよう。",
            "求めたいものと、今分かっているものを別々に書いてみよう。",
            "最初の一手だけ先生と確認して、続きは自分で進めてみよう。",
        ]

    if not page_visible:
        return Intervention(
            action="wait",
            message="ページを離れているため、戻るまで静かに待ちます。",
            trigger_after_seconds=30,
            evidence_id=latest_evidence,
        )
    if idle_seconds >= 15 and state.support_need >= 0.30 and state.mastery < 0.48:
        return Intervention(
            action="offer_hint",
            message="じっくり考えているところかな？ このまま考えても、小さなヒントを見ても大丈夫だよ。",
            hint_levels=hints,
            trigger_after_seconds=max(15, round(28 - state.support_need * 13)),
            evidence_id=latest_evidence,
        )
    if idle_seconds >= 22 and state.support_need >= 0.48:
        return Intervention(
            action="metacognitive_question",
            message="ここまでで分かっていることを一つ選ぶとしたら、どれかな？",
            hint_levels=hints[:1],
            trigger_after_seconds=22,
            evidence_id=latest_evidence,
        )
    if state.autonomous_engagement < 0.42 or metrics.stroke_count <= 2:
        return Intervention(
            action="micro_praise",
            message="まずペンを動かして考えを形にした、その一歩がとてもいいね。",
            trigger_after_seconds=12,
            evidence_id="first_step" if metrics.stroke_count else latest_evidence,
        )
    if state.mastery >= 0.72 and state.autonomous_engagement >= 0.62:
        return Intervention(
            action="challenge",
            message="自分の力で進められているね。別の解き方がないか考える挑戦もできそう！",
            trigger_after_seconds=35,
            evidence_id=latest_evidence,
        )
    return Intervention(
        action="wait",
        message="自分のペースで考えられているので、今は見守ります。",
        trigger_after_seconds=30,
        evidence_id=latest_evidence,
    )


def merge_learner_state(previous: LearnerState | None, current: LearnerState) -> LearnerState:
    if not previous:
        return current
    # Long-term dimensions change slowly. Momentary support need remains current.
    return current.model_copy(update={
        "mastery": _clamp(previous.mastery * 0.65 + current.mastery * 0.35),
        "autonomous_engagement": _clamp(
            previous.autonomous_engagement * 0.70 + current.autonomous_engagement * 0.30
        ),
        "persistence": _clamp(previous.persistence * 0.65 + current.persistence * 0.35),
        "confidence": _clamp(previous.confidence + 0.05),
    })
