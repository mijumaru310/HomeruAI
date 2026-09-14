import sqlite3
import tempfile
import unittest
from pathlib import Path

from app.storage import ResearchStore
from scripts.withdraw_participant import withdraw_participant


class WithdrawalTests(unittest.TestCase):
    def test_preview_and_exact_participant_deletion(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "research.db"
            store = ResearchStore(database)
            first = ResearchStore.hash_id("study_ABC123")
            second = ResearchStore.hash_id("study_DEF456")
            connection = store.connect()
            try:
                for learner in (first, second):
                    connection.execute("INSERT INTO learner_profiles VALUES (?, '{}', 1, 'now', 1)", (learner,))
                    connection.execute("INSERT INTO study_events VALUES (?, ?, 'session', NULL, 'experiment_started', 1, '{}', NULL, 'v1', 'now')", (f"event_{learner}", learner))
                    connection.execute("INSERT INTO analysis_runs VALUES (?, ?, 'session', 'gemini', 'ok', NULL, 1, NULL, '{}', '{}', 'v1', 'now')", (f"analysis_{learner}", learner))
                connection.commit()
            finally:
                connection.close()
            expected = {"learner_profiles": 1, "study_events": 1, "analysis_runs": 1}
            self.assertEqual(withdraw_participant(database, "ABC123"), expected)
            connection = sqlite3.connect(database)
            try:
                self.assertEqual(connection.execute("SELECT count(*) FROM study_events").fetchone()[0], 2)
            finally:
                connection.close()
            self.assertEqual(withdraw_participant(database, "ABC123", execute=True), expected)
            self.assertEqual(withdraw_participant(database, "ABC123"), {key: 0 for key in expected})
            self.assertEqual(withdraw_participant(database, "DEF456"), expected)

    def test_invalid_code_cannot_target_data(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "research.db"
            ResearchStore(database)
            with self.assertRaises(ValueError):
                withdraw_participant(database, "../../data", execute=True)


if __name__ == "__main__":
    unittest.main()
