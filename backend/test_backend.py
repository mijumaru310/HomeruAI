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

# Test with valid image
valid_b64 = base64.b64encode(b"dummy image").decode('utf-8')
req3 = {
    "questionId": "test",
    "strokes": [dummy_stroke],
    "image": valid_b64
}

try:
    response = client.post("/api/analyze", json=req3)
    print("Response status 3:", response.status_code)
    print("Response text 3:", response.text)
except Exception as e:
    import traceback
    traceback.print_exc()
