import unittest
from unittest.mock import patch

from app.analyzer import (
    GenerationResult,
    _answer_evaluation,
    _correct_answer_annotation,
    _has_unverified_grade_claim,
    analyze_process,
    build_local_fallback,
    calculate_pauses,
    calculate_process_metrics,
    extract_process_features,
)
from app.schemas import AIFeedback, AIPraisePoint, AIRecognition, StrokeSchema


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
        self.assertEqual(len(response.praise_points), 4)
        self.assertEqual(response.process_metrics.revision_count, 1)
        self.assertNotIn("Error", response.summary)
        self.assertEqual(len({item.evidence_id for item in response.annotations}), len(response.annotations))
        self.assertTrue(all(item.comment is None for item in response.annotations))
        self.assertTrue(all(item.type == "process_marker" for item in response.annotations))

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

    def test_single_stroke_praise_does_not_invent_revision_or_restart(self):
        response = build_local_fallback(
            [stroke("s1", 1_000, 2_000)],
            "一次方程式",
            "super_praise",
            [],
            "テスト",
        )

        self.assertIn("一画", response.encouragement_message)
        self.assertNotIn("消して", response.encouragement_message)
        self.assertNotIn("止まったあと", response.encouragement_message)
        self.assertNotIn("筆跡を重ねた", " ".join(response.praise_points))

    def test_experiment_fallback_keeps_original_three_points_and_no_grading(self):
        response = build_local_fallback(
            self.strokes,
            "一次方程式",
            "super_praise",
            calculate_pauses(self.strokes),
            "テスト",
            product_mode=False,
        )

        self.assertEqual(len(response.praise_points), 3)
        self.assertIsNone(response.answer_evaluation)

    def test_correct_answer_requires_high_confidence_and_gets_a_circle(self):
        recognition = AIRecognition(
            recognized_question="3x + 5 = 20",
            current_work=["3x=15", "x=5"],
            observed_steps=["両辺から5を引いて3x=15", "両辺を3で割ってx=5"],
            solution_outline=["x=5"],
            progress_quality="mostly_correct",
            confidence=0.95,
            answer_status="correct",
            expected_answer="x=5",
            answer_explanation="最終回答x=5が模範解答と一致する。",
            answer_confidence=0.95,
            answer_box_2d=[700, 650, 820, 850],
        )
        evaluation = _answer_evaluation(recognition, product_mode=True)
        _, evidence = extract_process_features(self.strokes)
        annotation = _correct_answer_annotation(recognition, evaluation, evidence, None)

        self.assertIsNotNone(evaluation)
        self.assertEqual(evaluation.status, "correct")
        self.assertIsNotNone(annotation)
        self.assertEqual(annotation.type, "correct_mark")

    def test_low_confidence_correct_answer_is_not_graded(self):
        recognition = AIRecognition(
            current_work=["x=5?"], confidence=0.6,
            answer_status="correct", expected_answer="x=5",
            answer_confidence=0.7,
        )

        evaluation = _answer_evaluation(recognition, product_mode=True)

        self.assertEqual(evaluation.status, "unknown")

    def test_product_analysis_returns_concrete_steps_praise_and_verified_grade(self):
        recognition = AIRecognition(
            recognized_question="方程式 3x + 5 = 20 を解く",
            current_work=["3x = 15", "x = 5"],
            erased_work=["3x = 25"],
            observed_steps=["両辺から5を引いて3x = 15", "両辺を3で割ってx = 5"],
            solution_outline=["3x = 15", "x = 5"],
            skill_tags=["一次方程式"],
            progress_quality="mostly_correct",
            confidence=0.95,
            answer_status="correct",
            expected_answer="x = 5",
            answer_explanation="最終回答x = 5が、3x + 5 = 20の解と一致する。",
            answer_confidence=0.95,
            answer_box_2d=[650, 600, 790, 850],
        )
        feedback = AIFeedback(
            thought_type_badge="式を直して答えまで確かめた",
            praise_points=[
                AIPraisePoint(evidence_id="first_step", message=f"具体的な過程を見た称賛{i}")
                for i in range(4)
            ],
            encouragement_message="消しても、もう一度答えまで進めたね。",
            summary="3x + 5 = 20からx = 5まで式を進めました。",
        )
        results = [
            GenerationResult(recognition, "model", "vertex_ai"),
            GenerationResult(feedback, "model", "vertex_ai"),
        ]
        with (
            patch("app.analyzer.VERTEX_PROJECT", "test-project"),
            patch("app.analyzer._generate_with_failover", side_effect=results),
        ):
            response = analyze_process(
                self.strokes,
                "q_02",
                "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
                experience_mode="product",
            )

        self.assertEqual(response.answer_evaluation.status, "correct")
        self.assertIn("3x = 15", response.summary)
        self.assertTrue(any("3x = 25" in item for item in response.praise_points))
        self.assertEqual(len(response.praise_points), 4)
        self.assertIn("correct_mark", {item.type for item in response.annotations})

    def test_unverified_correctness_claim_is_rejected(self):
        def feedback(message: str) -> AIFeedback:
            return AIFeedback(
                thought_type_badge="取り組みを振り返った",
                praise_points=[AIPraisePoint(evidence_id=f"e{i}", message=message) for i in range(3)],
                encouragement_message="ここまで書いたね。",
                summary="筆記の過程を見ました。",
            )

        self.assertTrue(_has_unverified_grade_claim(feedback("答えは正解です。")))
        self.assertTrue(_has_unverified_grade_claim(feedback("その式は合っています。")))
        self.assertFalse(_has_unverified_grade_claim(feedback("消したあとに書き直したね。")))

    def test_overnight_gap_is_not_misclassified_as_thinking(self):
        next_day = [
            stroke("s1", 1_000, 2_000),
            stroke("s2", 86_401_000, 86_402_000),
        ]

        self.assertEqual(calculate_pauses(next_day), [])
        self.assertEqual(calculate_process_metrics(next_day).session_seconds, 2.0)


if __name__ == "__main__":
    unittest.main()
