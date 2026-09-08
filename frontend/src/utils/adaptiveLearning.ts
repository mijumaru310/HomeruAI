import type { AssistResponseData, LearnerDashboardData, Stroke } from "../types/canvas";

const LEARNER_KEY = "homeruai-pseudonymous-learner-v1";

export function createId(prefix: string): string {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${suffix}`;
}

export function getOrCreateLearnerId(): string {
  const existing = window.localStorage.getItem(LEARNER_KEY);
  if (existing) return existing;
  const learnerId = createId("learner");
  window.localStorage.setItem(LEARNER_KEY, learnerId);
  return learnerId;
}

export function apiUrl(path: string): string {
  if (process.env.NEXT_PUBLIC_API_URL) return `${process.env.NEXT_PUBLIC_API_URL}${path}`;
  return `${window.location.protocol}//${window.location.hostname}:8000${path}`;
}

async function postWithProxyFallback<T>(path: string, payload: unknown): Promise<T> {
  const options: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
  let response: Response;
  try {
    response = await fetch(apiUrl(path), options);
  } catch {
    response = await fetch(path, options);
  }
  if (!response.ok) throw new Error(`API request failed (${response.status})`);
  return response.json() as Promise<T>;
}

async function getWithProxyFallback<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(apiUrl(path), { cache: "no-store" });
  } catch {
    response = await fetch(path, { cache: "no-store" });
  }
  if (!response.ok) throw new Error(`API request failed (${response.status})`);
  return response.json() as Promise<T>;
}

export function requestLearnerDashboard(learnerId: string): Promise<LearnerDashboardData> {
  return getWithProxyFallback(`/api/learners/${encodeURIComponent(learnerId)}/dashboard`);
}

export async function requestPauseAssist(payload: {
  learnerId: string;
  sessionId: string;
  problemId: string;
  questionText?: string;
  strokes: Stroke[];
  idleSeconds: number;
  pageVisible: boolean;
  hintCount: number;
}): Promise<AssistResponseData> {
  return postWithProxyFallback<AssistResponseData>("/api/assist", payload);
}

export function recordStudyEvent(payload: {
  learnerId: string;
  sessionId: string;
  problemId?: string;
  eventType: string;
  data?: Record<string, unknown>;
  interventionProbability?: number;
}): void {
  const body = {
    eventId: createId("event"),
    learnerId: payload.learnerId,
    sessionId: payload.sessionId,
    problemId: payload.problemId,
    eventType: payload.eventType,
    timestamp: Date.now(),
    payload: payload.data ?? {},
    interventionProbability: payload.interventionProbability,
  };
  void postWithProxyFallback<{ accepted: boolean }>("/api/events", body).catch((error) => {
    console.warn("Study event could not be recorded.", error);
  });
}
