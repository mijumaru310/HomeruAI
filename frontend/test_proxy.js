async function run() {
  const dummy_stroke = {
    strokeId: "s1",
    type: "draw",
    startTime: 0,
    endTime: 100,
    points: [],
    boundingBox: [0, 100, 0, 100],
    pointCount: 5,
    color: "black",
    width: 2,
    isErased: false,
    erasedAt: null,
    targetStrokeIds: null
  };

  const req = {
    questionId: "test",
    strokes: [dummy_stroke],
    image: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA="
  };

  try {
    console.log("Sending request to Next.js proxy...");
    const res = await fetch("http://localhost:3000/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req)
    });
    console.log("Status:", res.status);
    const text = await res.text();
    console.log("Response:", text.substring(0, 500));
  } catch (err) {
    console.error("Fetch Error:", err);
  }
}
run();
