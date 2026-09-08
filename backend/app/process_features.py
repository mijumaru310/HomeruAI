from __future__ import annotations

from math import hypot
from typing import Iterable

from .schemas import ProcessEvidence, ProcessMetrics, StrokeSchema


BASE_PAUSE_SECONDS = 6.0
SESSION_BREAK_SECONDS = 15 * 60


def _bbox(stroke: StrokeSchema) -> list[float] | None:
    if stroke.boundingBox:
        return [float(value) for value in stroke.boundingBox]
    if not stroke.points:
        return None
    xs = [point.x for point in stroke.points]
    ys = [point.y for point in stroke.points]
    return [min(xs), max(xs), min(ys), max(ys)]


def _bbox_center(box: list[float] | None) -> tuple[float, float] | None:
    if not box:
        return None
    return ((box[0] + box[1]) / 2, (box[2] + box[3]) / 2)


def _near(first: list[float] | None, second: list[float] | None) -> bool:
    a = _bbox_center(first)
    b = _bbox_center(second)
    if not a or not b:
        return False
    span = max(
        50.0,
        (first[1] - first[0]) + (first[3] - first[2]),
        (second[1] - second[0]) + (second[3] - second[2]),
    )
    return hypot(a[0] - b[0], a[1] - b[1]) <= span * 1.5


def calculate_pauses(strokes: list[StrokeSchema]) -> list[dict]:
    """Return observable pauses without claiming that every pause means confusion."""
    ordered = sorted(strokes, key=lambda stroke: stroke.startTime)
    pauses: list[dict] = []
    for previous, current in zip(ordered, ordered[1:]):
        gap_seconds = max(0, current.startTime - previous.endTime) / 1000
        if BASE_PAUSE_SECONDS <= gap_seconds <= SESSION_BREAK_SECONDS:
            box = _bbox(previous)
            location = f"({int(box[0])}, {int(box[2])})付近" if box else "位置不明"
            pauses.append({
                "after_stroke_id": previous.strokeId,
                "before_stroke_id": current.strokeId,
                "duration_seconds": round(gap_seconds, 1),
                "location": location,
                "bounding_box": box,
            })
    return pauses


def extract_process_features(strokes: list[StrokeSchema]) -> tuple[ProcessMetrics, list[ProcessEvidence]]:
    ordered = sorted(strokes, key=lambda stroke: stroke.startTime)
    if not ordered:
        return ProcessMetrics(
            stroke_count=0,
            erased_stroke_count=0,
            revision_count=0,
            pause_count=0,
            longest_pause_seconds=0,
            active_writing_seconds=0,
            session_seconds=0,
        ), []

    draws = [stroke for stroke in ordered if stroke.type == "draw"]
    erased_draws = [stroke for stroke in draws if stroke.isErased]
    erasers = [stroke for stroke in ordered if stroke.type in {"erase", "pixel-erase"}]
    pauses = calculate_pauses(ordered)
    evidence: list[ProcessEvidence] = []

    if draws:
        first = draws[0]
        evidence.append(ProcessEvidence(
            evidence_id="first_step",
            kind="first_step",
            description="自分から最初の一画を書き始めた",
            start_time=first.startTime,
            end_time=first.endTime,
            duration_seconds=round((first.endTime - first.startTime) / 1000, 1),
            bounding_box=_bbox(first),
            stroke_ids=[first.strokeId],
        ))

    productive_pause_count = 0
    restart_count = 0
    for index, pause in enumerate(pauses, start=1):
        before = next((item for item in ordered if item.strokeId == pause["before_stroke_id"]), None)
        resumed = bool(before and before.type == "draw")
        kind = "restart" if resumed else "pause"
        if resumed:
            restart_count += 1
        evidence.append(ProcessEvidence(
            evidence_id=f"pause_{index}",
            kind=kind,
            description=(
                f"{pause['duration_seconds']:g}秒ペンを止めたあと、筆記を再開した"
                if resumed else f"{pause['duration_seconds']:g}秒間ペンを止めて検討した"
            ),
            start_time=next(
                item.endTime for item in ordered if item.strokeId == pause["after_stroke_id"]
            ),
            end_time=before.startTime if before else ordered[-1].endTime,
            duration_seconds=pause["duration_seconds"],
            bounding_box=pause["bounding_box"],
            stroke_ids=[pause["after_stroke_id"], pause["before_stroke_id"]],
        ))

    successful_revision_count = 0
    for index, eraser in enumerate(erasers, start=1):
        target_ids = set(eraser.targetStrokeIds or [])
        target_draws = [stroke for stroke in draws if stroke.strokeId in target_ids]
        target_box = _bbox(target_draws[0]) if target_draws else _bbox(eraser)
        replacement = next(
            (
                stroke for stroke in draws
                if stroke.startTime >= eraser.endTime and not stroke.isErased
                and _near(target_box, _bbox(stroke))
            ),
            None,
        )
        successful = replacement is not None
        if successful:
            successful_revision_count += 1
        stroke_ids = [eraser.strokeId, *target_ids]
        if replacement:
            stroke_ids.append(replacement.strokeId)
        evidence.append(ProcessEvidence(
            evidence_id=f"revision_{index}",
            kind="successful_revision" if successful else "revision",
            description=(
                "一度書いた内容を消し、同じ場所で新しい考えを書き直した"
                if successful else "一度書いた内容を見直して消去した"
            ),
            start_time=min((item.startTime for item in target_draws), default=eraser.startTime),
            end_time=replacement.endTime if replacement else eraser.endTime,
            duration_seconds=round(
                (replacement.endTime - eraser.startTime) / 1000 if replacement else
                (eraser.endTime - eraser.startTime) / 1000,
                1,
            ),
            bounding_box=target_box,
            stroke_ids=stroke_ids,
        ))

    # Repeated ordinary handwriting in a nearby area is not confusion. Only
    # repeated erase operations in the same region are counted here.
    repeated_region_count = 0
    for index, eraser in enumerate(erasers):
        if any(_near(_bbox(eraser), _bbox(previous)) for previous in erasers[max(0, index - 3):index]):
            repeated_region_count += 1
    if repeated_region_count >= 2 and erasers:
        last = erasers[-1]
        evidence.append(ProcessEvidence(
            evidence_id="repeated_region",
            kind="repeated_region",
            description="同じ場所で何度も考えを重ねた",
            start_time=erasers[max(0, len(erasers) - 3)].startTime,
            end_time=last.endTime,
            duration_seconds=round((last.endTime - erasers[max(0, len(erasers) - 3)].startTime) / 1000, 1),
            bounding_box=_bbox(last),
            stroke_ids=[item.strokeId for item in erasers[-4:]],
        ))

    active_ms = sum(max(0, stroke.endTime - stroke.startTime) for stroke in draws)
    session_ms = sum(max(0, stroke.endTime - stroke.startTime) for stroke in ordered)
    for previous, current in zip(ordered, ordered[1:]):
        gap_ms = max(0, current.startTime - previous.endTime)
        if gap_ms <= SESSION_BREAK_SECONDS * 1000:
            session_ms += gap_ms

    revision_count = len(erasers) if erasers else len(erased_draws)
    metrics = ProcessMetrics(
        stroke_count=len(draws),
        erased_stroke_count=len(erased_draws),
        revision_count=revision_count,
        pause_count=len(pauses),
        longest_pause_seconds=max((item["duration_seconds"] for item in pauses), default=0),
        active_writing_seconds=round(active_ms / 1000, 1),
        session_seconds=round(session_ms / 1000, 1),
        productive_pause_count=productive_pause_count,
        unresolved_pause_count=max(0, len(pauses) - restart_count),
        restart_count=restart_count,
        successful_revision_count=successful_revision_count,
        repeated_region_count=repeated_region_count,
    )
    if len(draws) >= 5:
        evidence.append(ProcessEvidence(
            evidence_id="persistence",
            kind="persistence",
            description=f"{len(draws)}本の筆跡を重ねて最後まで取り組みを続けた",
            start_time=draws[0].startTime,
            end_time=draws[-1].endTime,
            duration_seconds=metrics.session_seconds,
            bounding_box=_bbox(draws[-1]),
            stroke_ids=[item.strokeId for item in draws[-20:]],
        ))
    return metrics, evidence


def calculate_process_metrics(
    strokes: list[StrokeSchema], _pauses: Iterable[dict] | None = None
) -> ProcessMetrics:
    # `_pauses` remains accepted for backwards-compatible unit tests/callers.
    return extract_process_features(strokes)[0]
