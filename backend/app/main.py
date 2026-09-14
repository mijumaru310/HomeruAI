from __future__ import annotations

import logging
import os
import time

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from .analyzer import analyze_process
from .config import (
    ALLOWED_ORIGINS, GEMINI_API_KEY, HOST, MAX_REQUEST_BYTES, PORT, VERTEX_PROJECT,
    TURSO_AUTH_TOKEN, TURSO_DATABASE_URL,
)
from .learner_model import choose_intervention, estimate_learner_state, merge_learner_state
from .process_features import extract_process_features
from .schemas import (
    AIFeedback,
    AIRecognition,
    AnalysisRequest,
    AnalysisResponse,
    AssistRequest,
    AssistResponse,
    LearnerDashboardResponse,
    LearnerProfileResponse,
    StudyEventRequest,
)
from .storage import ResearchStore


logger = logging.getLogger("homeruai")
if os.getenv("VERCEL") and not (TURSO_DATABASE_URL and TURSO_AUTH_TOKEN):
    raise RuntimeError("Vercel requires TURSO_DATABASE_URL and TURSO_AUTH_TOKEN for durable research data.")
store = ResearchStore.from_config()

app = FastAPI(
    title="HomeruAI Backend API",
    description="筆記・消去・停止後の再開を根拠に、適応的な称賛と支援を返す学習研究API",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    logger.info("Request validation failed for %s", request.url.path)
    safe_errors = [
        {"loc": list(error["loc"]), "msg": error["msg"], "type": error["type"]}
        for error in exc.errors()
    ]
    return JSONResponse(status_code=422, content={"detail": safe_errors})


@app.middleware("http")
async def limit_request_size(request: Request, call_next):
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > MAX_REQUEST_BYTES:
                return JSONResponse(
                    status_code=413,
                    content={"detail": "送信画像が大きすぎます。画像を小さくして再度お試しください。"},
                )
        except ValueError:
            return JSONResponse(status_code=400, content={"detail": "Content-Lengthが不正です。"})
    return await call_next(request)


@app.post("/api/analyze", response_model=AnalysisResponse)
async def analyze_strokes(request: AnalysisRequest):
    """Run image recognition, deterministic process analysis, then adaptive praise."""
    started = time.monotonic()
    try:
        previous_state, _, _ = await run_in_threadpool(store.get_profile, request.learnerId)
        result = await run_in_threadpool(
            analyze_process,
            strokes=request.strokes,
            question_id=request.questionId,
            image_b64=request.image,
            model="gemini",
            question_text=request.questionText,
            praise_mode=request.praiseMode,
            feedback_condition=request.feedbackCondition,
            source_image_b64=request.sourceImage,
            source_type=request.sourceType,
            analysis_bounds=request.analysisBounds,
            previous_state=previous_state,
            problem_difficulty=request.problemDifficulty,
            hint_count=request.hintCount,
        )
        assert result.learner_state is not None
        merged_state = merge_learner_state(previous_state, result.learner_state)
        result = result.model_copy(update={"learner_state": merged_state})
        await run_in_threadpool(store.save_profile, request.learnerId, merged_state)
        latency_ms = round((time.monotonic() - started) * 1000)
        await run_in_threadpool(
            store.log_analysis,
            analysis_id=result.analysis_id or "unknown",
            learner_id=request.learnerId,
            session_id=request.sessionId,
            provider=result.ai_provider,
            status=result.source,
            error_category=result.provider_error_category,
            latency_ms=latency_ms,
            recognition_confidence=result.recognition_confidence,
            state=merged_state,
            metrics=result.process_metrics.model_dump() if result.process_metrics else {},
        )
        return result
    except Exception:
        logger.exception("Unexpected analysis failure")
        raise HTTPException(
            status_code=500,
            detail="分析処理を完了できませんでした。少し待ってからもう一度お試しください。",
        ) from None


@app.post("/api/assist", response_model=AssistResponse)
async def assist_during_pause(request: AssistRequest):
    """Fast, image-free intervention decision for a live pause."""
    previous_state, _, _ = await run_in_threadpool(store.get_profile, request.learnerId)
    metrics, evidence = extract_process_features(request.strokes)
    state = estimate_learner_state(
        metrics,
        previous=previous_state,
        idle_seconds=request.idleSeconds,
        hint_count=request.hintCount,
        page_visible=request.pageVisible,
    )
    intervention = choose_intervention(
        state,
        metrics,
        evidence,
        idle_seconds=request.idleSeconds,
        page_visible=request.pageVisible,
    )
    return AssistResponse(
        learner_state=state,
        intervention=intervention,
        process_metrics=metrics,
    )


@app.post("/api/events")
async def append_study_event(event: StudyEventRequest):
    accepted = await run_in_threadpool(store.append_event, event)
    return {"accepted": accepted}


@app.get("/api/learners/{learner_id}/state", response_model=LearnerProfileResponse)
async def learner_profile(learner_id: str):
    state, sample_count, updated_at = await run_in_threadpool(store.get_profile, learner_id)
    if state is None:
        # A neutral cold-start state; not persisted until an analysis is completed.
        metrics, _ = extract_process_features([])
        state = estimate_learner_state(metrics)
    return LearnerProfileResponse(
        learner_id=learner_id,
        state=state,
        sample_count=sample_count,
        updated_at=updated_at,
    )


@app.get("/api/learners/{learner_id}/dashboard", response_model=LearnerDashboardResponse)
async def learner_dashboard(learner_id: str):
    state, sample_count, updated_at = await run_in_threadpool(store.get_profile, learner_id)
    if state is None:
        metrics, _ = extract_process_features([])
        state = estimate_learner_state(metrics)
    dashboard = await run_in_threadpool(store.get_dashboard_data, learner_id)
    return LearnerDashboardResponse(
        learner_id=learner_id,
        state=state,
        sample_count=sample_count,
        updated_at=updated_at,
        **dashboard,
    )


@app.get("/api/health")
async def health():
    schemas = [AIRecognition.model_json_schema(), AIFeedback.model_json_schema()]
    schema_text = str(schemas)
    return {
        "status": "healthy",
        "message": "HomeruAI Backend is ready",
        "provider": {
            "name": "vertex_ai" if VERTEX_PROJECT else "gemini_api",
            "configured": bool(VERTEX_PROJECT or (GEMINI_API_KEY and GEMINI_API_KEY != "your_gemini_api_key_here")),
            "vertex_configured": bool(VERTEX_PROJECT),
            "api_key_fallback_configured": bool(GEMINI_API_KEY and GEMINI_API_KEY != "your_gemini_api_key_here"),
            "structured_output_compatible": "prefixItems" not in schema_text,
        },
        "research_store": {"configured": True, "stores_raw_images": False},
        "fallback_available": True,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host=HOST, port=PORT, reload=True)
