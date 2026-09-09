import unittest

from app.analyzer import build_local_fallback, calculate_pauses, calculate_process_metrics
from app.schemas import StrokeSchema


def stroke(
    stroke_id: str,
    start: int,
    end: int,
    *,
    kind: str = "draw",
    erased: bool = False,
    targets: list[str] | None = None,
) -> StrokeSchema:
    return StrokeSchema(
        strokeId=stroke_id,
        type=kind,
        startTime=start,
        endTime=end,
        points=[],
        boundingBox=(10, 30, 20, 40),
        pointCount=8,
        isErased=erased,
        erasedAt=end if erased else None,
        targetStrokeIds=targets,
    )


class ProcessAnalysisTests(unittest.TestCase):
    def setUp(self):
        self.strokes = [
            stroke("s1", 1_000, 2_000, erased=True),
            stroke("e1", 2_500, 2_700, kind="erase", targets=["s1"]),
            stroke("s2", 9_000, 10_500),
        ]

    def test_detects_six_second_pause_and_location(self):
        pauses = calculate_pauses(self.strokes)

        self.assertEqual(len(pauses), 1)
        self.assertEqual(pauses[0]["duration_seconds"], 6.3)
        self.assertEqual(pauses[0]["location"], "(10, 20)付近")

    def test_metrics_are_deterministic(self):
        metrics = calculate_process_metrics(self.strokes)

        self.assertEqual(metrics.stroke_count, 2)
        self.assertEqual(metrics.erased_stroke_count, 1)
        self.assertEqual(metrics.revision_count, 1)
        self.assertEqual(metrics.successful_revision_count, 1)
        self.assertEqual(metrics.pause_count, 1)
        self.assertEqual(metrics.restart_count, 1)
        self.assertEqual(metrics.active_writing_seconds, 2.5)
        self.assertEqual(metrics.session_seconds, 9.5)

    def test_local_fallback_is_transparent_and_positive(self):
        response = build_local_fallback(
            self.strokes,
            "一次方程式",
            "super_praise",
            calculate_pauses(self.strokes),
            "テスト用フォールバック",
        )

        self.assertEqual(response.source, "local_fallback")
        self.assertEqual(response.notice, "テスト用フォールバック")
        self.assertEqual(len(response.praise_points), 3)
        self.assertEqual(response.process_metrics.revision_count, 1)
        self.assertNotIn("Error", response.summary)
        self.assertEqual(len({item.evidence_id for item in response.annotations}), len(response.annotations))
        self.assertTrue(all(item.comment is None for item in response.annotations))

    def test_local_praise_describes_behavior_without_fixed_ability_label(self):
        response = build_local_fallback(
            self.strokes,
            "一次方程式",
            "support",
            calculate_pauses(self.strokes),
            "テスト",
        )

        text = " ".join(response.praise_points)
        self.assertNotIn("天才", text)
        self.assertNotIn("頭がいい", text)
        self.assertNotIn("タイプ", response.thought_type_badge)
        self.assertIn("書き直", text)

    def test_overnight_gap_is_not_misclassified_as_thinking(self):
        next_day = [
            stroke("s1", 1_000, 2_000),
            stroke("s2", 86_401_000, 86_402_000),
        ]

        self.assertEqual(calculate_pauses(next_day), [])
        self.assertEqual(calculate_process_metrics(next_day).session_seconds, 2.0)


if __name__ == "__main__":
    unittest.main()
