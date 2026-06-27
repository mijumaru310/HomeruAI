import requests
import json
import traceback

dummy_stroke = {
    "strokeId": "s1",
    "type": "draw",
    "startTime": 0,
    "endTime": 100,
    "points": [],
    "boundingBox": [0, 100, 0, 100],
    "pointCount": 5,
    "color": "black",
    "width": 2,
    "isErased": False,
    "erasedAt": None,
    "targetStrokeIds": None
}

req = {
    "questionId": "test",
    "strokes": [dummy_stroke],
    "image": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA="
}

try:
    print("Sending request to 127.0.0.1:8000...")
    res = requests.post("http://127.0.0.1:8000/api/analyze", json=req, timeout=10)
    print("Response Status:", res.status_code)
    print("Response JSON:", res.json())
except requests.exceptions.Timeout:
    print("Request TIMED OUT after 10 seconds.")
except requests.exceptions.ConnectionError:
    print("Connection Error - Server is not listening or dropped the connection.")
except Exception as e:
    print(f"Exception: {e}")
