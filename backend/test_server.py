import threading
import time
import requests
import uvicorn
from app.main import app

def run_server():
    uvicorn.run(app, host="127.0.0.1", port=8001, log_level="debug")

t = threading.Thread(target=run_server, daemon=True)
t.start()

time.sleep(3) # Wait for server to start

dummy_stroke = {
    "strokeId": "s1",
    "type": "draw",
    "startTime": 0,
    "endTime": 100,
    "points": [],
    "boundingBox": [0, 100, 0, 100],
    "pointCount": 5
}

req = {
    "questionId": "test",
    "strokes": [dummy_stroke],
    "image": ""
}

try:
    print("Sending request...")
    res = requests.post("http://127.0.0.1:8001/api/analyze", json=req)
    print("Response Status:", res.status_code)
    print("Response JSON:", res.json())
except Exception as e:
    import traceback
    traceback.print_exc()

