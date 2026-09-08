import json
import unittest

from app.schemas import AIFeedback, AIRecognition, AnalysisResponse


class StructuredSchemaTests(unittest.TestCase):
    def test_gemini_schemas_do_not_emit_unsupported_prefix_items(self):
        schema_text = json.dumps([
            AIRecognition.model_json_schema(),
            AIFeedback.model_json_schema(),
            AnalysisResponse.model_json_schema(),
        ])
        self.assertNotIn("prefixItems", schema_text)


if __name__ == "__main__":
    unittest.main()
