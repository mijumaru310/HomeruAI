import threading
import time
import requests
import uvicorn
from app.main import app
import base64

def run_server():
    uvicorn.run(app, host="127.0.0.1", port=8002, log_level="error")

t = threading.Thread(target=run_server, daemon=True)
t.start()
time.sleep(2)

dummy_stroke = {
    "strokeId": "s1",
    "type": "draw",
    "startTime": 0,
    "endTime": 100,
    "points": [],
    "boundingBox": [0, 100, 0, 100],
    "pointCount": 5
}

# Create a small valid 1x1 JPEG in base64
jpeg_b64 = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA="

req = {
    "questionId": "test",
    "strokes": [dummy_stroke],
    "image": jpeg_b64
}

try:
    print("Sending request with image...")
    res = requests.post("http://127.0.0.1:8002/api/analyze", json=req)
    print("Response Status:", res.status_code)
    print("Response text:", res.text)
except Exception as e:
    import traceback
    traceback.print_exc()

