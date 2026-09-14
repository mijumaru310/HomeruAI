import type { AssistResponseData, LearnerDashboardData, Stroke } from "../types/canvas";
import { EXPERIMENT_PROTOCOL_VERSION } from "./experimentMode";

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
}): Promise<boolean> {
  const body = {
    eventId: createId("event"),
    learnerId: payload.learnerId,
    sessionId: payload.sessionId,
    problemId: payload.problemId,
    eventType: payload.eventType,
    timestamp: Date.now(),
    payload: new URLSearchParams(window.location.search).get("experiment") === "1"
      ? { ...payload.data, protocol_version: EXPERIMENT_PROTOCOL_VERSION }
      : payload.data ?? {},
    interventionProbability: payload.interventionProbability,
  };
  try {
    const pending = readPendingStudyEvents();
    if (pending.length >= 500) throw new Error("Research event queue is full.");
    writePendingStudyEvents([...pending, body]);
  } catch (error) {
    console.warn("Study event could not be queued.", error);
    return Promise.resolve(false);
  }
  return flushPendingStudyEvents().then(() =>
    !readPendingStudyEvents().some(event => event.eventId === body.eventId)
  ).catch(error => {
    console.warn("Study event remains queued for retry.", error);
    return false;
  });
}

type PendingStudyEvent = {
  eventId: string;
  learnerId: string;
  sessionId: string;
  problemId?: string;
  eventType: string;
  timestamp: number;
  payload: Record<string, unknown>;
  interventionProbability?: number;
};

const STUDY_EVENT_QUEUE_KEY = "homeruai-pending-study-events-v1";
let activeFlush: Promise<void> | null = null;

function readPendingStudyEvents(): PendingStudyEvent[] {
  const raw = window.localStorage.getItem(STUDY_EVENT_QUEUE_KEY);
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed.every(event => event && typeof event === "object" && typeof event.eventId === "string")) {
    throw new Error("Research event queue is unreadable.");
  }
  return parsed as PendingStudyEvent[];
}

function writePendingStudyEvents(events: PendingStudyEvent[]): void {
  if (events.length === 0) window.localStorage.removeItem(STUDY_EVENT_QUEUE_KEY);
  else window.localStorage.setItem(STUDY_EVENT_QUEUE_KEY, JSON.stringify(events));
}

export function pendingStudyEventCount(): number {
  try { return readPendingStudyEvents().length; }
  catch { return -1; }
}

export function discardPendingStudyEventsForLearner(learnerId: string): number {
  const pending = readPendingStudyEvents();
  const remaining = pending.filter(event => event.learnerId !== learnerId);
  writePendingStudyEvents(remaining);
  return pending.length - remaining.length;
}

async function sendStudyEvent(event: PendingStudyEvent): Promise<void> {
  const options: RequestInit = {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event), keepalive: true,
  };
  let response: Response;
  try { response = await fetch("/api/events", options); }
  catch { response = await fetch(apiUrl("/api/events"), options); }
  if (!response.ok) throw new Error(`Study event API failed (${response.status})`);
}

export async function flushPendingStudyEvents(): Promise<number> {
  if (!activeFlush) {
    activeFlush = (async () => {
      while (true) {
        const pending = readPendingStudyEvents();
        if (pending.length === 0) return;
        try { await sendStudyEvent(pending[0]); }
        catch { return; }
        writePendingStudyEvents(readPendingStudyEvents().filter(event => event.eventId !== pending[0].eventId));
      }
    })().finally(() => { activeFlush = null; });
  }
  try { await activeFlush; }
  catch (error) { console.warn("Study event sync failed.", error); }
  return pendingStudyEventCount();
}
