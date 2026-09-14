import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.schemas import LearnerState, StudyEventRequest
from app.storage import ResearchStore
from scripts.withdraw_participant import withdraw_participant


class LibsqlStoreTests(unittest.TestCase):
    def test_libsql_backend_preserves_research_data_across_connections(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "remote-shaped.db"
            store = ResearchStore(database, remote_url=str(database), auth_token="test-token")
            state = LearnerState(
                mastery=0.4, autonomous_engagement=0.5, support_need=0.3,
                persistence=0.6, confidence=0.7,
            )
            sample_count, _ = store.save_profile("study_TEST123", state)
            self.assertEqual(sample_count, 1)
            event = StudyEventRequest(
                eventId="event-one", learnerId="study_TEST123", sessionId="session-one",
                problemId="q_03", eventType="experiment_started", timestamp=123456,
                payload={"study_set": "easy"},
            )
            self.assertTrue(store.append_event(event))
            self.assertFalse(store.append_event(event))
            store.log_analysis(
                analysis_id="analysis-one", learner_id="study_TEST123", session_id="session-one",
                provider="local_fallback", status="ok", error_category=None, latency_ms=12,
                recognition_confidence=None, state=state,
                metrics={"stroke_count": 2, "revision_count": 1, "restart_count": 0},
            )
            reopened = ResearchStore(database, remote_url=str(database), auth_token="test-token")
            saved, count, _ = reopened.get_profile("study_TEST123")
            self.assertEqual(count, 1)
            self.assertEqual(saved.mastery, 0.4)
            dashboard = reopened.get_dashboard_data("study_TEST123")
            self.assertEqual(dashboard["total_analyses"], 1)
            self.assertEqual(dashboard["total_strokes"], 2)
            export = Path(directory) / "events.csv"
            self.assertEqual(reopened.export_study_events_csv(export), 1)
            self.assertIn("experiment_started", export.read_text(encoding="utf-8-sig"))
            expected = {"learner_profiles": 1, "study_events": 1, "analysis_runs": 1}
            self.assertEqual(withdraw_participant(None, "TEST123", store=reopened), expected)
            self.assertEqual(withdraw_participant(None, "TEST123", execute=True, store=reopened), expected)
            self.assertEqual(withdraw_participant(None, "TEST123", store=reopened), {key: 0 for key in expected})

    def test_remote_credentials_must_be_complete(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                ResearchStore(Path(directory) / "db", remote_url="libsql://example.turso.io")

    def test_configured_store_uses_remote_and_explicit_path_uses_sqlite(self):
        with tempfile.TemporaryDirectory() as directory:
            remote = Path(directory) / "configured.db"
            local = Path(directory) / "explicit.db"
            with patch("app.config.TURSO_DATABASE_URL", str(remote)), patch("app.config.TURSO_AUTH_TOKEN", "test-token"):
                self.assertEqual(ResearchStore.from_config().remote_url, str(remote))
                self.assertIsNone(ResearchStore.from_config(local).remote_url)
                self.assertTrue(local.is_file())


if __name__ == "__main__":
    unittest.main()
