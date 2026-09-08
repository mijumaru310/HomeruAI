"use client";

import React from "react";
import { Bug, X } from "lucide-react";
import type { LearnerDashboardData, LearnerState, PointerDiagnostics, ProcessMetrics } from "../types/canvas";

interface Props {
  learnerState?: LearnerState;
  dashboard: LearnerDashboardData | null;
  metrics?: ProcessMetrics;
  pointer: PointerDiagnostics;
  analysisSource?: string;
  providerError?: string;
  recognitionConfidence?: number;
  strokeCount: number;
  imageCount: number;
  problemRegion?: { x: number; y: number; width: number; height: number };
  onClose: () => void;
}

export default function DebugPanel(props: Props) {
  const state = props.learnerState ?? props.dashboard?.state;
  return (
    <aside className="debug-panel" aria-label="研究デバッグパネル">
      <header><span><Bug size={17} />研究デバッグ</span><button onClick={props.onClose} aria-label="閉じる"><X size={18} /></button></header>
      <p className="debug-warning">学習者向け評価ではなく、推定と入力状態を検証する開発表示です。</p>
      <section>
        <h3>学習状態 X1–X4</h3>
        <dl>
          <dt>X1 習得度</dt><dd>{state ? state.mastery.toFixed(3) : "—"}</dd>
          <dt>X2 自主性</dt><dd>{state ? state.autonomous_engagement.toFixed(3) : "—"}</dd>
          <dt>X3 支援必要度</dt><dd>{state ? state.support_need.toFixed(3) : "—"}</dd>
          <dt>X4 粘り強さ</dt><dd>{state ? state.persistence.toFixed(3) : "—"}</dd>
          <dt>推定信頼度</dt><dd>{state ? state.confidence.toFixed(3) : "—"}</dd>
          <dt>状態モデル</dt><dd>{state?.model_version ?? "rules-v1"}</dd>
          <dt>累積サンプル</dt><dd>{props.dashboard?.sample_count ?? 0}</dd>
        </dl>
      </section>
      <section>
        <h3>Apple Pencil / Pointer</h3>
        <dl>
          <dt>入力種別</dt><dd>{props.pointer.pointerType}</dd>
          <dt>筆圧</dt><dd>{props.pointer.pressure.toFixed(3)}</dd>
          <dt>傾き X / Y</dt><dd>{props.pointer.tiltX}° / {props.pointer.tiltY}°</dd>
          <dt>接触サイズ</dt><dd>{props.pointer.width.toFixed(1)} × {props.pointer.height.toFixed(1)}</dd>
          <dt>共同サンプル</dt><dd>{props.pointer.coalescedSamples}</dd>
          <dt>無視した手のひら</dt><dd>{props.pointer.palmTouchesIgnored}</dd>
        </dl>
        <div className={`pencil-status ${props.pointer.pointerType === "pen" ? "ok" : ""}`}>
          {props.pointer.pointerType === "pen" ? "Apple Pencil互換のペン入力を検出" : "ペンで一画書くと入力状態を確認できます"}
        </div>
      </section>
      <section>
        <h3>現在の分析</h3>
        <dl>
          <dt>分析経路</dt><dd>{props.analysisSource ?? "未分析"}</dd>
          <dt>障害分類</dt><dd>{props.providerError ?? "なし"}</dd>
          <dt>画像認識信頼度</dt><dd>{props.recognitionConfidence === undefined ? "—" : props.recognitionConfidence.toFixed(3)}</dd>
          <dt>筆跡 / 画像</dt><dd>{props.strokeCount} / {props.imageCount}</dd>
          <dt>分析範囲</dt><dd>{props.problemRegion ? Object.values(props.problemRegion).map(v => v.toFixed(2)).join(", ") : "全体"}</dd>
        </dl>
        {props.metrics && <pre>{JSON.stringify(props.metrics, null, 2)}</pre>}
      </section>
    </aside>
  );
}
