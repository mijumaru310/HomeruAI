import json
import unittest

from app.schemas import AIFeedback, AIRecognition, AnalysisResponse, StrokeSchema


class StructuredSchemaTests(unittest.TestCase):
    def test_input_metadata_is_optional_and_preserved(self):
        payload = {"strokeId": "s1", "type": "draw", "startTime": 1, "endTime": 2}
        self.assertIsNone(StrokeSchema(**payload).inputType)
        for pointer_type in ("pen", "touch", "mouse", "unknown"):
            stroke = StrokeSchema(**payload, inputType=pointer_type, inputMode="finger")
            self.assertEqual(stroke.model_dump()["inputType"], pointer_type)
            self.assertEqual(stroke.model_dump()["inputMode"], "finger")

    def test_gemini_schemas_do_not_emit_unsupported_prefix_items(self):
        schema_text = json.dumps([
            AIRecognition.model_json_schema(),
            AIFeedback.model_json_schema(),
            AnalysisResponse.model_json_schema(),
        ])
        self.assertNotIn("prefixItems", schema_text)


if __name__ == "__main__":
    unittest.main()
