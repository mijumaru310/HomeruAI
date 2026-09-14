import unittest

from scripts.audit_experiment import summarize_events
from scripts.create_experiment_assignments import PROTOCOL_VERSION


class ExperimentAuditTests(unittest.TestCase):
    def test_flags_missing_exposure_and_choice(self):
        result = summarize_events([
            {"event_type": "experiment_started", "payload": {"study_set": "easy"}},
            {"event_type": "analysis_completed", "payload": {"source": "local_fallback", "trial": 1}},
        ], "easy", "process_praise")
        self.assertIn("missing_feedback_exposure", result["flags"])
        self.assertIn("missing_or_duplicate_choice", result["flags"])
        self.assertEqual(result["local_fallback_count"], 1)

    def test_complete_session_has_no_flags(self):
        result = summarize_events([
            {"event_type": "experiment_started", "payload": {"study_set": "easy", "protocol_version": PROTOCOL_VERSION}},
            {"event_type": "analysis_completed", "payload": {"source": "ai", "trial": 1, "protocol_version": PROTOCOL_VERSION}},
            {"event_type": "feedback_displayed", "payload": {"trial": 1, "protocol_version": PROTOCOL_VERSION}},
            {"event_type": "trial_skipped", "payload": {"trial": 2, "protocol_version": PROTOCOL_VERSION}},
            {"event_type": "trial_skipped", "payload": {"trial": 3, "protocol_version": PROTOCOL_VERSION}},
            {"event_type": "experiment_optional_choice", "payload": {"chose_optional": False, "protocol_version": PROTOCOL_VERSION}},
            {"event_type": "experiment_finished", "payload": {"protocol_version": PROTOCOL_VERSION}},
        ], "easy", "process_praise")
        self.assertEqual(result["flags"], "")
        self.assertEqual(result["optional_choice"], "false")

    def test_duplicate_exposure_cannot_hide_an_unseen_trial(self):
        version = {"protocol_version": PROTOCOL_VERSION}
        result = summarize_events([
            {"event_type": "analysis_completed", "payload": {"trial": 1, **version}},
            {"event_type": "feedback_displayed", "payload": {"trial": 1, **version}},
            {"event_type": "feedback_displayed", "payload": {"trial": 1, **version}},
            {"event_type": "analysis_completed", "payload": {"trial": 2, **version}},
        ], "easy", "process_praise")
        self.assertIn("missing_feedback_exposure", result["flags"])


if __name__ == "__main__":
    unittest.main()
