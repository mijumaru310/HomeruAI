import asyncio
from app.main import app
from fastapi.testclient import TestClient
import base64

client = TestClient(app)

dummy_stroke = {
    "strokeId": "s1",
    "type": "draw",
    "startTime": 0,
    "endTime": 100,
    "points": [{"x": 0, "y": 0, "p": 1, "t": 0}]
}

# Test with empty image
req = {
    "questionId": "test",
    "strokes": [dummy_stroke],
    "image": ""
}

try:
    response = client.post("/api/analyze", json=req)
    print("Response status 1:", response.status_code)
    print("Response text 1:", response.text)
except Exception as e:
    import traceback
    traceback.print_exc()

# Test with invalid base64 image
req2 = {
    "questionId": "test",
    "strokes": [dummy_stroke],
    "image": "invalid_base64_data"
}

try:
    response = client.post("/api/analyze", json=req2)
    print("Response status 2:", response.status_code)
    print("Response text 2:", response.text)
except Exception as e:
    import traceback
    traceback.print_exc()

# Test 4: Arbitrary question with free text (questionText)
req4 = {
    "questionId": "input_custom",
    "questionText": "方程式 5x - 8 = 22 を解け。",
    "praiseMode": "super_praise",
    "strokes": [
        {
            "strokeId": "s1",
            "type": "draw",
            "startTime": 100,
            "endTime": 300,
            "points": [{"x": 50, "y": 100, "p": 1, "t": 100}, {"x": 150, "y": 100, "p": 1, "t": 300}]
        },
        {
            "strokeId": "s2",
            "type": "draw",
            "startTime": 1000,
            "endTime": 1500,
            "points": [{"x": 50, "y": 150, "p": 1, "t": 1000}, {"x": 150, "y": 150, "p": 1, "t": 1500}]
        }
    ],
    "image": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
}

try:
    response = client.post("/api/analyze", json=req4)
    print("Response status 4 (Arbitrary Question):", response.status_code)
    data = response.json()
    print("Badge:", data.get("thought_type_badge"))
    print("Recognized Question:", data.get("recognized_content", {}).get("recognized_question"))
    print("Praise points:", data.get("praise_points"))
    print("Encouragement:", data.get("encouragement_message"))
except Exception as e:
    import traceback
    traceback.print_exc()

