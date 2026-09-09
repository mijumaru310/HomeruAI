import os
import tempfile
import unittest

os.environ["GEMINI_API_KEY"] = "your_gemini_api_key_here"
os.environ["HOMERUAI_DATA_DIR"] = tempfile.mkdtemp(prefix="homeruai-tests-")

from fastapi.testclient import TestClient

from app.main import app


ONE_PIXEL_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_health_exposes_capability_without_secrets(self):
        response = self.client.get("/api/health")

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["fallback_available"])
        self.assertEqual(response.json()["provider"]["name"], "gemini")
        self.assertTrue(response.json()["provider"]["structured_output_compatible"])
        self.assertNotIn("api_key", response.text.lower())

    def test_analysis_works_without_external_ai(self):
        response = self.client.post("/api/analyze", json={
            "questionId": "q_02",
            "praiseMode": "support",
            "model": "gemini",
            "image": ONE_PIXEL_PNG,
            "strokes": [{
                "strokeId": "s1",
                "type": "draw",
                "startTime": 1_000,
                "endTime": 2_000,
                "points": [{"x": 10, "y": 20, "p": 0.5, "t": 0}],
            }],
        })

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["source"], "local_fallback")
        self.assertEqual(body["process_metrics"]["stroke_count"], 1)
        self.assertEqual(len(body["praise_points"]), 3)

    def test_neutral_study_condition_has_no_praise_or_intervention(self):
        response = self.client.post("/api/analyze", json={
            "questionId": "q_03",
            "feedbackCondition": "neutral_summary",
            "image": ONE_PIXEL_PNG,
            "strokes": [{
                "strokeId": "s-neutral", "type": "draw", "startTime": 1_000,
                "endTime": 2_000, "points": [], "pointCount": 8,
            }],
        })

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["feedback_condition"], "neutral_summary")
        self.assertEqual(body["thought_type_badge"], "取り組み記録")
        self.assertEqual(body["annotations"], [])
        self.assertEqual(body["intervention"]["action"], "wait")
        combined = " ".join(body["praise_points"])
        self.assertNotIn("すばらしい", combined)
        self.assertNotIn("いいね", combined)

    def test_invalid_stroke_type_is_rejected_without_echoing_body(self):
        response = self.client.post("/api/analyze", json={
            "questionId": "q_02",
            "image": ONE_PIXEL_PNG,
            "strokes": [{
                "strokeId": "s1",
                "type": "unknown",
                "startTime": 1_000,
                "endTime": 2_000,
                "points": [],
            }],
        })

        self.assertEqual(response.status_code, 422)
        self.assertNotIn(ONE_PIXEL_PNG, response.text)

    def test_unsupported_provider_is_not_part_of_the_request_contract(self):
        response = self.client.post("/api/analyze", json={
            "questionId": "q_02",
            "model": "other",
            "image": ONE_PIXEL_PNG,
            "strokes": [{
                "strokeId": "s1", "type": "draw", "startTime": 1_000,
                "endTime": 2_000, "points": [],
            }],
        })
        self.assertEqual(response.status_code, 422)

    def test_pause_assist_uses_no_image_and_returns_explainable_state(self):
        response = self.client.post("/api/assist", json={
            "learnerId": "learner-test",
            "sessionId": "session-test",
            "problemId": "q_02",
            "idleSeconds": 30,
            "pageVisible": True,
            "strokes": [{
                "strokeId": "s1", "type": "draw", "startTime": 1_000,
                "endTime": 2_000, "points": [], "boundingBox": [10, 20, 10, 20],
            }],
        })
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["intervention"]["action"], "offer_hint")
        self.assertEqual(len(body["intervention"]["hint_levels"]), 3)
        self.assertTrue(body["learner_state"]["reasons"])

    def test_research_event_endpoint_accepts_derived_data(self):
        response = self.client.post("/api/events", json={
            "eventId": "event-test",
            "learnerId": "learner-test",
            "sessionId": "session-test",
            "problemId": "q_02",
            "eventType": "hint_opened",
            "timestamp": 1_000,
            "payload": {"level": 1},
        })
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["accepted"])

    def test_dashboard_turns_analysis_process_into_monotonic_growth(self):
        learner_id = "dashboard-learner"
        analysis = self.client.post("/api/analyze", json={
            "questionId": "q_02",
            "learnerId": learner_id,
            "sessionId": "dashboard-session",
            "image": ONE_PIXEL_PNG,
            "strokes": [{
                "strokeId": "s1", "type": "draw", "startTime": 1_000,
                "endTime": 2_000, "points": [], "pointCount": 12,
            }],
        })
        self.assertEqual(analysis.status_code, 200)

        dashboard = self.client.get(f"/api/learners/{learner_id}/dashboard")
        self.assertEqual(dashboard.status_code, 200)
        body = dashboard.json()
        self.assertEqual(body["total_analyses"], 1)
        self.assertGreater(body["total_xp"], 0)
        self.assertEqual(len(body["history"]), 1)
        self.assertIn("最初の一歩", body["achievements"])


if __name__ == "__main__":
    unittest.main()
