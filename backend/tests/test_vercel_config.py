import json
import unittest
from pathlib import Path


class VercelConfigTests(unittest.TestCase):
    def test_services_route_api_before_frontend(self):
        root = Path(__file__).resolve().parents[2]
        config = json.loads((root / "vercel.json").read_text(encoding="utf-8"))
        self.assertEqual(config["services"]["frontend"]["root"], "frontend/")
        self.assertEqual(config["services"]["backend"]["root"], "backend/")
        self.assertEqual(config["services"]["backend"]["entrypoint"], "main:app")
        self.assertEqual(config["rewrites"][0], {"source": "/api/(.*)", "destination": {"service": "backend"}})
        self.assertEqual(config["rewrites"][1], {"source": "/(.*)", "destination": {"service": "frontend"}})


if __name__ == "__main__":
    unittest.main()
