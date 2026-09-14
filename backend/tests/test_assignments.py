import unittest
from collections import Counter

from scripts.create_experiment_assignments import build_assignments


class AssignmentTests(unittest.TestCase):
    def test_balances_conditions_within_each_set_and_uses_unique_codes(self):
        rows = build_assignments({"easy": 5, "standard": 6, "challenge": 3}, "http://192.168.0.15:3000/")
        self.assertEqual(len(rows), 14)
        self.assertEqual(len({row["participant_code"] for row in rows}), 14)
        for set_id in ("easy", "standard", "challenge"):
            counts = Counter(row["feedback_condition"] for row in rows if row["study_set"] == set_id)
            self.assertLessEqual(abs(counts["praise"] - counts["neutral"]), 1)
            self.assertTrue(all(f"studySet={set_id}" in row["url"] for row in rows if row["study_set"] == set_id))

    def test_rejects_query_in_base_url(self):
        with self.assertRaises(ValueError):
            build_assignments({"easy": 2}, "http://localhost:3000/?studyFeedback=praise")


if __name__ == "__main__":
    unittest.main()
