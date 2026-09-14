"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import Canvas from "../components/Canvas";
import ReplayPlayer from "../components/ReplayPlayer";
import ProblemRegionSelector, { NormalizedRegion } from "../components/ProblemRegionSelector";
import LearningDashboard from "../components/LearningDashboard";
import ModalLayer from "../components/ModalLayer";
import DebugPanel from "../components/DebugPanel";
import { Stroke, CanvasImage, CanvasText, AIAnnotation, RecognizedContent, AnalysisResponseData, ProcessMetrics, LearnerState, AdaptiveIntervention, LearnerDashboardData, PointerDiagnostics } from "../types/canvas";
import { jsPDF } from "jspdf";
import { 
  PenTool, Eraser, Sparkles, Trash2, 
  Award, FileText, Maximize2, Plus, Eye, EyeOff, Move,
  Type, Scissors, Download, Bold, Italic, Underline, ImagePlus, Bot, Loader2,
  CheckCircle2, X, Sparkle, Undo2, Cloud, CloudOff
  , BarChart3, Bug, Flame, Flower2
} from "lucide-react";
import { generateGhostRender } from "../utils/ghostRenderer";
import { loadWorkspace, saveWorkspace } from "../utils/notebookStorage";
import { undoLastStrokeAction } from "../utils/strokeHistory";
import { renderPdfPages } from "../utils/pdfImporter";
import { apiUrl, createId, flushPendingStudyEvents, getOrCreateLearnerId, pendingStudyEventCount, recordStudyEvent, requestLearnerDashboard, requestPauseAssist } from "../utils/adaptiveLearning";
import { experimentProblemIds, experimentWorkspaceKey, parseExperimentRoute, type ExperimentRoute } from "../utils/experimentMode";

export const PRESET_QUESTIONS = [
  { id: "custom", label: "📝 白紙ノート（自由に解く）", title: "自由ノート", text: "", difficulty: undefined },
  { id: "input_custom", label: "✏️ 自由な問題を入力する...", title: "任意の問題", text: "", difficulty: undefined },
  { id: "photo_problem", label: "📸 教材・プリント写真を貼る", title: "教材プリント", text: "", difficulty: undefined },
  { id: "q_03", label: "🌱 やさしい｜30%引き", title: "買い物の割引", text: "【問題】定価2,400円の商品が30%引きです。\n支払う金額はいくらですか？", difficulty: 0.30 },
  { id: "q_04", label: "🌱 やさしい｜レシピの分量", title: "レシピの分量", text: "【問題】4人分で小麦粉240g使います。\n同じ割合で6人分作ると何g必要ですか？", difficulty: 0.34 },
  { id: "q_05", label: "🌿 標準｜お得な買い方", title: "単価の比較", text: "【問題】Aは6本で780円、Bは10本で1,250円です。\n1本あたり安いのはどちらですか？", difficulty: 0.45 },
  { id: "q_06", label: "🌿 標準｜4日間の平均", title: "4日間の平均", text: "【問題】4日間の学習時間は20分、35分、25分、40分でした。\n1日あたりの平均は何分ですか？", difficulty: 0.48 },
  { id: "q_02", label: "🌿 標準｜一次方程式", title: "一次方程式", text: "【問題】方程式を解いてください。\n3x + 5 = 20", difficulty: 0.52 },
  { id: "q_01", label: "🌳 挑戦｜直角三角形の面積", title: "直角三角形の面積", text: "【問題】辺の長さが6cm、8cm、10cmの\n三角形の面積を求めてください。", difficulty: 0.58 },
  { id: "q_07", label: "🌳 挑戦｜予定から逆算", title: "予定から逆算", text: "【問題】10時15分に到着したい。移動に45分、準備に25分かかります。\n準備を始める時刻は何時ですか？", difficulty: 0.62 },
];

interface PageData {
  id: string;
  title: string;
  date: string;
  questionText?: string;
  strokes: Stroke[];
  images: CanvasImage[];
  texts: CanvasText[];
  bgFileName: string | null;
  aiAnnotations: AIAnnotation[];
  thoughtTypeBadge?: string;
  praisePoints?: string[];
  encouragementMessage?: string;
  recognizedContent?: RecognizedContent;
  aiSummary?: string;
  analysisSource?: "ai" | "hybrid" | "local_fallback";
  analysisNotice?: string;
  providerErrorCategory?: string;
  processMetrics?: ProcessMetrics;
  learnerState?: LearnerState;
  intervention?: AdaptiveIntervention;
  recognitionConfidence?: number;
  recognitionUncertainties?: string[];
  skillTags?: string[];
  sourceType?: "typed" | "photo" | "pdf" | "blank" | "preset";
  hintCount?: number;
  feedbackCondition?: "process_praise" | "neutral_summary";
  problemRegion?: NormalizedRegion;
  rawAiResponse?: unknown;
  trialStartedAt?: number;
  firstStrokeLatencyMs?: number;
  skippedAt?: number;
}


interface SectionData {
  id: string;
  title: string;
  pages: PageData[];
}



const colors = [
  { value: "#000000", label: "Black" },
  { value: "#323130", label: "Dark Gray" },
  { value: "#0078d4", label: "Blue" },
  { value: "#d83b01", label: "Orange Red" },
  { value: "#107c41", label: "Green" },
  { value: "#5c2d91", label: "Purple" },
  { value: "#e81123", label: "Red" },
  { value: "#ffb900", label: "Yellow" },
  { value: "#00bcf2", label: "Cyan" },
  { value: "#e3008c", label: "Magenta" },
];

function getStudyFeedbackCondition(): "process_praise" | "neutral_summary" {
  if (typeof window === "undefined") return "process_praise";
  return new URLSearchParams(window.location.search).get("studyFeedback") === "neutral"
    ? "neutral_summary"
    : "process_praise";
}

function praiseMoment(metrics?: ProcessMetrics): string {
  if (metrics?.successful_revision_count) return "消して書き直した試行錯誤まで、ちゃんと見つけたよ";
  if (metrics?.revision_count) return "消して見直した過程も、ここに残っているよ";
  if (metrics?.restart_count) return "止まったあと、もう一度書き始められたね";
  if (metrics?.stroke_count) return "最初の一画から、考えを形にできたね";
  return "あなたの取り組みを一緒に振り返ろう";
}

function observedProcessDescription(metrics?: ProcessMetrics): string {
  if (!metrics) return "記録された取り組みから見つけました。";
  const actions = [metrics.stroke_count ? "筆記" : "取り組み"];
  if (metrics.revision_count) actions.push("見直し");
  if (metrics.restart_count) actions.push("再開");
  return `実際に記録された${actions.join("・")}から見つけました。`;
}

function createExperimentPage(problemId: string, step: number): PageData {
  const problem = PRESET_QUESTIONS.find(item => item.id === problemId);
  if (!problem?.text) throw new Error(`Unknown experiment problem: ${problemId}`);
  return {
    id: `experiment_page_${step}`,
    title: problem.title,
    date: new Date().toLocaleString("ja-JP"),
    questionText: problem.text,
    strokes: [], images: [],
    texts: [{
      id: `txt_preset_experiment_${step}`, text: problem.text,
      x: 52, y: 40, fontSize: 22, color: "#1e293b",
      fontWeight: "bold", fontStyle: "normal", textDecoration: "none",
    }],
    bgFileName: null,
    aiAnnotations: [],
    sourceType: "preset",
    hintCount: 0,
    trialStartedAt: Date.now(),
  };
}

function getWorkspaceKey(): string {
  if (typeof window === "undefined") return "current";
  const route = parseExperimentRoute(window.location.search);
  if (route.kind === "experiment") return experimentWorkspaceKey(route.config);
  const participantCode = new URLSearchParams(window.location.search).get("participant")?.trim();
  return participantCode && /^[A-Za-z0-9_-]{3,32}$/.test(participantCode)
    ? `study_workspace_${participantCode}`
    : "current";
}

async function prepareSourceImage(dataUrl: string, region?: NormalizedRegion): Promise<string> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const candidate = new Image();
    candidate.onload = () => resolve(candidate);
    candidate.onerror = () => reject(new Error("問題画像を分析用に準備できませんでした。"));
    candidate.src = dataUrl;
  });
  const cropX = region ? Math.round(image.naturalWidth * region.x) : 0;
  const cropY = region ? Math.round(image.naturalHeight * region.y) : 0;
  const cropWidth = region ? Math.max(1, Math.round(image.naturalWidth * region.width)) : image.naturalWidth;
  const cropHeight = region ? Math.max(1, Math.round(image.naturalHeight * region.height)) : image.naturalHeight;
  const maxEdge = 1600;
  const scale = Math.min(1, maxEdge / Math.max(cropWidth, cropHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(cropWidth * scale));
  canvas.height = Math.max(1, Math.round(cropHeight * scale));
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("問題画像を分析用に変換できませんでした。");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, cropX, cropY, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.9);
}

interface RibbonHeaderProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  tool: "pen" | "eraser" | "select" | "text" | "lasso";
  setTool: (tool: "pen" | "eraser" | "select" | "text" | "lasso") => void;
  eraserMode: "stroke" | "pixel";
  setEraserMode: (mode: "stroke" | "pixel") => void;
  brushColor: string;
  setBrushColor: (color: string) => void;
  brushWidth: number;
  setBrushWidth: (w: number) => void;
  eraserWidth: number;
  setEraserWidth: (w: number) => void;
  textStyle: { fontSize: number; color: string; fontWeight: "normal" | "bold"; fontStyle: "normal" | "italic"; textDecoration: "none" | "underline"; };
  setTextStyle: React.Dispatch<React.SetStateAction<{ fontSize: number; color: string; fontWeight: "normal" | "bold"; fontStyle: "normal" | "italic"; textDecoration: "none" | "underline"; }>>;
  handleResetTransform: () => void;
  handleClear: () => void;
  showReplay: boolean;
  setShowReplay: (show: boolean) => void;
  isReplaying: boolean;
  setIsReplaying: (replaying: boolean) => void;
  setReplayedStrokes: React.Dispatch<React.SetStateAction<Stroke[]>>;
  activePageStrokes: Stroke[];
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSelectProblemRegion: () => void;
  canSelectProblemRegion: boolean;
  hasProblemRegion: boolean;
  handleExportPNG: () => void;
  handleExportPDF: () => void;
  handleAnalyze: () => void;
  isAnalyzing: boolean;
  selectedPreset: string;
  onSelectPreset: (presetId: string) => void;
  onOpenCustomProblemModal: () => void;
  praiseMode: "super_praise" | "support" | "challenge";
  setPraiseMode: (mode: "super_praise" | "support" | "challenge") => void;
  handleUndo: () => void;
  saveStatus: "loading" | "saving" | "saved" | "error";
}

const RibbonHeader = React.memo(({
  activeTab, setActiveTab, tool, setTool, eraserMode, setEraserMode,
  brushColor, setBrushColor, brushWidth, setBrushWidth, eraserWidth, setEraserWidth,
  textStyle, setTextStyle, handleResetTransform, handleClear,
  showReplay, setShowReplay, isReplaying, setIsReplaying, setReplayedStrokes,
  activePageStrokes, fileInputRef, handleFileUpload,
  onSelectProblemRegion, canSelectProblemRegion, hasProblemRegion,
  handleExportPNG, handleExportPDF, handleAnalyze, isAnalyzing,
  selectedPreset, onSelectPreset,
  onOpenCustomProblemModal, praiseMode, setPraiseMode, handleUndo, saveStatus
}: RibbonHeaderProps) => {
  return (
    <header className="ribbon-header">
      <div className="onenote-header-top">
        <div className="onenote-header-title-area">
          <h1 className="onenote-header-title">HomeruAI Note</h1>
          <span className="onenote-header-badge">Homeru AI Mode</span>
          <span title={saveStatus === "error" ? "この端末に保存できませんでした" : "ノートはこの端末に自動保存されます"} style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11px", color: saveStatus === "error" ? "#fecaca" : "#e1dfdd" }}>
            {saveStatus === "error" ? <CloudOff size={13} /> : <Cloud size={13} />}
            {saveStatus === "loading" ? "復元中" : saveStatus === "saving" ? "保存中" : saveStatus === "error" ? "保存できません" : "保存済み"}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          {/* 問題プリセット選択 */}
          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <span style={{ fontSize: "11px", color: "#e1dfdd", fontWeight: "bold" }}>問題:</span>
            <select
              value={selectedPreset}
              onChange={(e) => onSelectPreset(e.target.value)}
              style={{ fontSize: "12px", padding: "4px 8px", borderRadius: "4px", border: "1px solid #797775", backgroundColor: "#ffffff", color: "#323130" }}
              disabled={isAnalyzing}
            >
              {PRESET_QUESTIONS.map(q => (
                <option key={q.id} value={q.id}>{q.label}</option>
              ))}
            </select>
            <button
              onClick={onOpenCustomProblemModal}
              title="自由な問題文を入力・編集"
              style={{
                fontSize: "11px",
                padding: "4px 8px",
                borderRadius: "4px",
                border: "1px solid #797775",
                backgroundColor: "#ffffff",
                color: "#323130",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "2px"
              }}
              disabled={isAnalyzing}
            >
              ✏️ 入力
            </button>
          </div>

          {/* ほめモード選択 */}
          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <span style={{ fontSize: "11px", color: "#e1dfdd", fontWeight: "bold" }}>褒め方:</span>
            <select
              value={praiseMode}
              onChange={(e) => setPraiseMode(e.target.value as "super_praise" | "support" | "challenge")}
              style={{ fontSize: "12px", padding: "4px 8px", borderRadius: "4px", border: "1px solid #797775", backgroundColor: "#ffffff", color: "#323130" }}
              disabled={isAnalyzing}
            >
              <option value="super_praise">🌱 小さな一歩も見つける</option>
              <option value="support">🤝 いっしょに伴走 (標準)</option>
              <option value="challenge">🎯 チャレンジ (気づき重視)</option>
            </select>
          </div>

          <span style={{ fontSize: "11px", padding: "4px 8px", borderRadius: "999px", background: "#ede9fe", color: "#5b21b6", fontWeight: 700 }}>
            Gemini認識 + プロセス分析
          </span>

          <button 
            onClick={handleAnalyze} 
            disabled={activePageStrokes.length === 0 || isAnalyzing || isReplaying} 
            className="btn btn-accent" 
            style={{ 
              backgroundColor: "#ffb900", 
              color: "#323130", 
              borderColor: "#ffb900", 
              fontWeight: "bold",
              boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
              padding: "6px 14px"
            }}
          >
            <Sparkles size={15} className={isAnalyzing ? "animate-spin" : ""} />
            {isAnalyzing ? "思考を読み解き中..." : "ほめるAIで振り返る"}
          </button>
        </div>
      </div>


      <div className="ribbon-tabs">
        <button className={`ribbon-tab ${activeTab === "home" ? "active" : ""}`} onClick={() => setActiveTab("home")}>ホーム</button>
        <button className={`ribbon-tab ${activeTab === "draw" ? "active" : ""}`} onClick={() => setActiveTab("draw")}>描画</button>
        <button className={`ribbon-tab ${activeTab === "insert" ? "active" : ""}`} onClick={() => setActiveTab("insert")}>挿入</button>
      </div>

      <div className="ribbon-content">
        {activeTab === "draw" ? (
          <>
            <div className="ribbon-group">
              <button onClick={() => setTool("select")} disabled={isReplaying} className={`btn ${tool === "select" && !isReplaying ? "btn-active" : ""}`} style={{ flexDirection: "column", height: "42px", gap: "2px", border: "none" }} title="Select Tool">
                <Move size={14} /> <span style={{ fontSize: "8px" }}>選択</span>
              </button>
              <button onClick={() => setTool("lasso")} disabled={isReplaying} className={`btn ${tool === "lasso" && !isReplaying ? "btn-active" : ""}`} style={{ flexDirection: "column", height: "42px", gap: "2px", border: "none" }} title="Lasso Tool">
                <Scissors size={14} /> <span style={{ fontSize: "8px" }}>投げ縄</span>
              </button>
              <button onClick={() => setTool("pen")} disabled={isReplaying} className={`btn ${tool === "pen" && !isReplaying ? "btn-active" : ""}`} style={{ flexDirection: "column", height: "42px", gap: "2px", border: "none" }} title="Pen Tool">
                <PenTool size={14} /> <span style={{ fontSize: "8px" }}>ペン</span>
              </button>
              <button onClick={() => setTool("eraser")} disabled={isReplaying} className={`btn ${tool === "eraser" && !isReplaying ? "btn-active" : ""}`} style={{ flexDirection: "column", height: "42px", gap: "2px", border: "none" }} title="Eraser Tool">
                <Eraser size={14} /> <span style={{ fontSize: "8px" }}>消しゴム</span>
              </button>
              <button onClick={() => setTool("text")} disabled={isReplaying} className={`btn ${tool === "text" && !isReplaying ? "btn-active" : ""}`} style={{ flexDirection: "column", height: "42px", gap: "2px", border: "none" }} title="Text Tool">
                <Type size={14} /> <span style={{ fontSize: "8px" }}>テキスト</span>
              </button>
            </div>

            {tool === "pen" && (
              <div className="ribbon-group">
                <div className="color-picker-grid" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
                  {colors.map((c) => (
                    <button key={c.value} onClick={() => setBrushColor(c.value)} className={`color-dot ${brushColor === c.value ? "active" : ""} ${c.value === "#ffffff" ? "color-dot-white" : ""}`} style={{ backgroundColor: c.value }} title={c.label} />
                  ))}
                </div>
                <input type="color" value={brushColor} onChange={(e) => setBrushColor(e.target.value)} style={{ width: "24px", height: "24px", border: "none", cursor: "pointer", padding: "0" }} title="カスタム色" />
              </div>
            )}

            {tool === "text" && (
              <div className="ribbon-group" style={{ display: "flex", gap: "8px" }}>
                 <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                   <input type="number" value={textStyle.fontSize} onChange={e => setTextStyle(p => ({ ...p, fontSize: Number(e.target.value) }))} style={{ width: "40px", fontSize: "10px" }} />
                   <span style={{ fontSize: "10px" }}>px</span>
                 </div>
                 <div style={{ display: "flex", gap: "2px" }}>
                   <button onClick={() => setTextStyle(p => ({ ...p, fontWeight: p.fontWeight === "bold" ? "normal" : "bold" }))} className={`btn ${textStyle.fontWeight === "bold" ? "btn-active" : ""}`} style={{ padding: "4px" }}><Bold size={12} /></button>
                   <button onClick={() => setTextStyle(p => ({ ...p, fontStyle: p.fontStyle === "italic" ? "normal" : "italic" }))} className={`btn ${textStyle.fontStyle === "italic" ? "btn-active" : ""}`} style={{ padding: "4px" }}><Italic size={12} /></button>
                   <button onClick={() => setTextStyle(p => ({ ...p, textDecoration: p.textDecoration === "underline" ? "none" : "underline" }))} className={`btn ${textStyle.textDecoration === "underline" ? "btn-active" : ""}`} style={{ padding: "4px" }}><Underline size={12} /></button>
                 </div>
                 <input type="color" value={textStyle.color} onChange={e => setTextStyle(p => ({ ...p, color: e.target.value }))} style={{ width: "20px", height: "20px" }} />
              </div>
            )}

            <div className="ribbon-group">
              {tool === "pen" ? (
                <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: "2px" }}>
                  <span style={{ fontSize: "8px", color: "#605e5c" }}>ペンの太さ</span>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <input type="range" min="2" max="15" value={brushWidth} onChange={(e) => setBrushWidth(parseInt(e.target.value))} className="accent-[#5c2d91]" style={{ width: "64px", height: "4px" }} />
                    <span style={{ fontSize: "9px", fontFamily: "monospace" }}>{brushWidth}px</span>
                  </div>
                </div>
              ) : tool === "eraser" ? (
                <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: "2px" }}>
                  <span style={{ fontSize: "8px", color: "#605e5c" }}>消しゴム設定</span>
                  <select value={eraserMode} onChange={e => setEraserMode(e.target.value as "stroke"| "pixel")} style={{ fontSize: "9px", padding: "2px" }}>
                    <option value="stroke">一筆消し</option>
                    <option value="pixel">部分消し(ピクセル)</option>
                  </select>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <input type="range" min="10" max="80" value={eraserWidth} onChange={(e) => setEraserWidth(parseInt(e.target.value))} className="accent-[#5c2d91]" style={{ width: "64px", height: "4px" }} />
                    <span style={{ fontSize: "9px", fontFamily: "monospace" }}>{eraserWidth}px</span>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: "2px" }}>
                  <span style={{ fontSize: "8px", color: "#605e5c" }}>{tool === "lasso" ? "投げ縄モード" : "選択モード"}</span>
                </div>
              )}
            </div>

            <div className="ribbon-group">
              <button onClick={handleUndo} disabled={isReplaying || activePageStrokes.length === 0} className="btn" style={{ flexDirection: "column", height: "42px", gap: "2px", border: "none" }} title="ひとつ前に戻す (Ctrl/Cmd+Z)">
                <Undo2 size={14} /> <span style={{ fontSize: "8px" }}>元に戻す</span>
              </button>
              <button onClick={handleResetTransform} className="btn" style={{ flexDirection: "column", height: "42px", gap: "2px", border: "none" }} title="Reset Zoom">
                <Maximize2 size={14} /> <span style={{ fontSize: "8px" }}>等倍リセット</span>
              </button>
              <button onClick={handleClear} className="btn" style={{ flexDirection: "column", height: "42px", gap: "2px", border: "none" }} title="Clear Canvas">
                <Trash2 size={14} style={{ color: "#a80000" }} /> <span style={{ fontSize: "8px", color: "#a80000" }}>全消去</span>
              </button>
            </div>

            <div className="ribbon-group" style={{ borderRight: "none" }}>
              <button onClick={() => { setShowReplay(!showReplay); setReplayedStrokes([]); }} disabled={activePageStrokes.length === 0} className={`btn ${showReplay ? "btn-active" : ""}`} style={{ flexDirection: "column", height: "42px", gap: "2px", border: "none" }}>
                {showReplay ? <EyeOff size={14} /> : <Eye size={14} />} <span style={{ fontSize: "8px" }}>タイムラプス</span>
              </button>
              {showReplay && activePageStrokes.length > 0 && (
                <div style={{ marginLeft: "8px" }}>
                  <ReplayPlayer key={`${activePageStrokes.length}-${activePageStrokes.at(-1)?.endTime ?? 0}`} strokes={activePageStrokes} setIsReplaying={setIsReplaying} setReplayedStrokes={setReplayedStrokes} />
                </div>
              )}
            </div>
          </>
        ) : activeTab === "insert" ? (
          <>
            <div className="ribbon-group" style={{ borderRight: "none" }}>
              <button onClick={() => fileInputRef.current?.click()} className="btn" style={{ flexDirection: "column", height: "42px", gap: "2px", border: "none" }}>
                <ImagePlus size={14} /> <span style={{ fontSize: "8px" }}>画像を挿入</span>
              </button>
              <input ref={fileInputRef} type="file" accept="image/*,application/pdf" multiple onChange={handleFileUpload} style={{ display: "none" }} />
              <button onClick={onSelectProblemRegion} disabled={!canSelectProblemRegion} className={`btn ${hasProblemRegion ? "btn-active" : ""}`} style={{ flexDirection: "column", height: "42px", gap: "2px", border: "none" }} title="複数の問題がある画像から分析対象を選択">
                <Scissors size={14} /> <span style={{ fontSize: "8px" }}>{hasProblemRegion ? "範囲選択済み" : "問題範囲"}</span>
              </button>
              
              <button onClick={handleExportPNG} className="btn" style={{ flexDirection: "column", height: "42px", gap: "2px", border: "none", marginLeft: "16px" }}>
                <Download size={14} /> <span style={{ fontSize: "8px" }}>PNG保存</span>
              </button>
              <button onClick={handleExportPDF} className="btn" style={{ flexDirection: "column", height: "42px", gap: "2px", border: "none" }}>
                <FileText size={14} /> <span style={{ fontSize: "8px" }}>PDF保存</span>
              </button>
            </div>
          </>
        ) : (
          <div style={{ fontSize: "11px", color: "#605e5c", padding: "8px 0" }}>
            <button onClick={handleExportPNG} className="btn" style={{ display: "inline-flex", flexDirection: "column", height: "42px", gap: "2px", border: "none" }}>
               <Download size={14} /> <span style={{ fontSize: "8px" }}>PNGとして保存</span>
            </button>
            <button onClick={handleExportPDF} className="btn" style={{ display: "inline-flex", flexDirection: "column", height: "42px", gap: "2px", border: "none" }}>
               <FileText size={14} /> <span style={{ fontSize: "8px" }}>PDFとして保存</span>
            </button>
          </div>
        )}
      </div>
    </header>
  );
});
RibbonHeader.displayName = "RibbonHeader";

interface SidebarProps {
  sections: SectionData[];
  activeSectionId: string;
  activePageId: string;
  handleSectionSwitch: (sectionId: string) => void;
  handlePageSwitch: (pageId: string) => void;
  handleAddSection: () => void;
  handleAddPage: () => void;
}

const Sidebar = React.memo(({ sections, activeSectionId, activePageId, handleSectionSwitch, handlePageSwitch, handleAddSection, handleAddPage }: SidebarProps) => {
  const activeSection = sections.find(section => section.id === activeSectionId) || sections[0];
  return (
    <>
      <aside className="section-sidebar">
        <button onClick={handleAddSection} className="sidebar-add-btn"><Plus size={14} /><span>セクション追加</span></button>
        <ul className="sidebar-list">
          {sections.map(section => (
            <li key={section.id} onClick={() => handleSectionSwitch(section.id)} className={`section-item ${section.id === activeSectionId ? "active" : ""}`}><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{section.title}</span></li>
          ))}
        </ul>
      </aside>
      <aside className="page-sidebar">
        <button onClick={handleAddPage} className="sidebar-add-btn"><Plus size={14} /><span>ページ追加</span></button>
        <ul className="sidebar-list">
          {activeSection.pages.map(page => (
            <li key={page.id} onClick={() => handlePageSwitch(page.id)} className={`page-item ${page.id === activePageId ? "active" : ""}`}><span className="page-item-title">{page.title || "無題のページ"}</span><span className="page-item-date">{page.date.split(" ")[0]}</span></li>
          ))}
        </ul>
      </aside>
    </>
  );
});
Sidebar.displayName = "Sidebar";

export default function Home() {
  const [experimentRoute, setExperimentRoute] = useState<ExperimentRoute | null>(null);
  const [experimentStep, setExperimentStep] = useState(0);
  const [experimentFinished, setExperimentFinished] = useState(false);
  const [optionalChosen, setOptionalChosen] = useState<boolean | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [pendingEventCount, setPendingEventCount] = useState(-2);
  const [eventSyncError, setEventSyncError] = useState(false);
  const experimentConfig = experimentRoute?.kind === "experiment" ? experimentRoute.config : null;
  const isExperiment = experimentConfig !== null;

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setExperimentRoute(parseExperimentRoute(window.location.search)));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const [sections, setSections] = useState<SectionData[]>([
    {
      id: "sec_quick", title: "クイック ノート",
      pages: [
        { 
          id: "page_math", 
          title: "直角三角形の面積", 
          date: "2026/09/04 金曜日 16:00", 
          strokes: [], 
          images: [], 
          texts: [
            {
              id: "txt_preset_init",
              text: "【問題】辺の長さが a=6, b=8, c=10 の\n直角三角形の面積を求めよ。",
              x: 60,
              y: 40,
              fontSize: 22,
              color: "#1e293b",
              fontWeight: "bold",
              fontStyle: "normal",
              textDecoration: "none"
            }
          ], 
          bgFileName: null, 
          aiAnnotations: [],
          sourceType: "preset",
          hintCount: 0,
        }
      ]
    }
  ]);

  const [activeSectionId, setActiveSectionId] = useState<string>("sec_quick");
  const [activePageId, setActivePageId] = useState<string>("page_math");
  
  const [selectedPreset, setSelectedPreset] = useState<string>("q_01");
  const [praiseMode, setPraiseMode] = useState<"super_praise" | "support" | "challenge">("super_praise");
  const [showPraiseModal, setShowPraiseModal] = useState<boolean>(false);
  const [showCustomProblemModal, setShowCustomProblemModal] = useState<boolean>(false);
  const [showProblemRegionSelector, setShowProblemRegionSelector] = useState<boolean>(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [customProblemTitle, setCustomProblemTitle] = useState<string>("");
  const [customProblemText, setCustomProblemText] = useState<string>("");
  const [placeCustomTextOnCanvas, setPlaceCustomTextOnCanvas] = useState<boolean>(true);

  const activeSection = sections.find(s => s.id === activeSectionId) || sections[0];
  const activePage = activeSection.pages.find(p => p.id === activePageId) || activeSection.pages[0];
  const experimentLocked = isExperiment && (experimentFinished || Boolean(activePage.thoughtTypeBadge) || Boolean(activePage.skippedAt));

  const [pageTransforms, setPageTransforms] = useState<Record<string, { pan: { x: number; y: number }; zoom: number }>>({});

  const [tool, setTool] = useState<"pen" | "eraser" | "select" | "text" | "lasso">("pen");
  const [eraserMode, setEraserMode] = useState<"stroke" | "pixel">("stroke");
  const [brushColor, setBrushColor] = useState<string>("#323130");
  const [brushWidth, setBrushWidth] = useState<number>(4);
  const [eraserWidth, setEraserWidth] = useState<number>(30);
  const [textStyle, setTextStyle] = useState<{ fontSize: number; color: string; fontWeight: "normal" | "bold"; fontStyle: "normal" | "italic"; textDecoration: "none" | "underline"; }>({ fontSize: 24, color: "#000000", fontWeight: "normal", fontStyle: "normal", textDecoration: "none" });

  const [activeTab, setActiveTab] = useState<string>("draw");
  const [replayedStrokes, setReplayedStrokes] = useState<Stroke[]>([]);
  const [isReplaying, setIsReplaying] = useState(false);
  const [showReplay, setShowReplay] = useState(false);

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"loading" | "saving" | "saved" | "error">("loading");
  const [activeAssistance, setActiveAssistance] = useState<AdaptiveIntervention | null>(null);
  const [revealedHint, setRevealedHint] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<LearnerDashboardData | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [pointerDiagnostics, setPointerDiagnostics] = useState<PointerDiagnostics>({
    pointerType: "unknown", pressure: 0, tiltX: 0, tiltY: 0,
    width: 0, height: 0, coalescedSamples: 0, palmTouchesIgnored: 0, updatedAt: 0,
  });
  
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const persistenceReadyRef = useRef(false);
  const autosaveGenerationRef = useRef(0);
  const experimentTransitionRef = useRef(false);
  const firstStrokeLoggedRef = useRef<Set<string>>(new Set());
  const learnerIdRef = useRef("anonymous");
  const sessionIdRef = useRef("session_pending");
  const lastAssistedStrokeRef = useRef<number | null>(null);
  const lastAssistCheckAtRef = useRef(0);

  const refreshDashboard = useCallback(async (showLoading = false) => {
    if (showLoading) setDashboardLoading(true);
    try {
      setDashboard(await requestLearnerDashboard(learnerIdRef.current));
    } catch (error) {
      console.warn("Growth dashboard could not be loaded.", error);
    } finally {
      if (showLoading) setDashboardLoading(false);
    }
  }, []);

  useEffect(() => {
    const studyQuery = new URLSearchParams(window.location.search);
    const participantCode = studyQuery.get("participant")?.trim();
    const learnerId = participantCode && /^[A-Za-z0-9_-]{3,32}$/.test(participantCode)
      ? `study_${participantCode}`
      : getOrCreateLearnerId();
    learnerIdRef.current = learnerId;
    sessionIdRef.current = createId("session");
    recordStudyEvent({
      learnerId: learnerIdRef.current,
      sessionId: sessionIdRef.current,
      eventType: "session_started",
    });
    void requestLearnerDashboard(learnerId)
      .then(setDashboard)
      .catch(error => console.warn("Initial growth dashboard could not be loaded.", error));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const sync = () => {
      setPendingEventCount(pendingStudyEventCount());
      void flushPendingStudyEvents().then(count => {
        if (!cancelled) setPendingEventCount(count);
      });
    };
    const onVisibility = () => { if (document.visibilityState === "visible") sync(); };
    sync();
    const timer = window.setInterval(sync, 8_000);
    window.addEventListener("online", sync);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("online", sync);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  useEffect(() => {
    if (!experimentRoute || experimentRoute.kind === "invalid") return;
    let cancelled = false;

    const startExperiment = () => {
      if (experimentRoute.kind !== "experiment") return;
      const firstProblemId = experimentProblemIds(experimentRoute.config)[0];
      setSections([{ id: "sec_experiment", title: "実験", pages: [createExperimentPage(firstProblemId, 0)] }]);
      setActiveSectionId("sec_experiment");
      setActivePageId("experiment_page_0");
      setSelectedPreset(firstProblemId);
      setPraiseMode("super_praise");
      setExperimentStep(0);
      setExperimentFinished(false);
      setOptionalChosen(null);
      setPageTransforms({});
      recordStudyEvent({
        learnerId: learnerIdRef.current,
        sessionId: sessionIdRef.current,
        problemId: firstProblemId,
        eventType: "experiment_started",
        data: {
          study_set: experimentRoute.config.setId,
          feedback_condition: experimentRoute.config.feedbackCondition,
          trial: 1,
        },
      });
    };

    void loadWorkspace<SectionData[]>(getWorkspaceKey())
      .then((stored) => {
        if (cancelled) return;
        if (!stored) {
          startExperiment();
          return;
        }
        if (stored.schemaVersion !== 1 || !Array.isArray(stored.sections) || stored.sections.length === 0) {
          if (experimentRoute.kind === "experiment") setSaveStatus("error");
          return;
        }

        if (experimentRoute.kind === "experiment") {
          const progress = stored.experimentProgress;
          const planned = experimentProblemIds(experimentRoute.config);
          const step = progress?.step ?? -1;
          const section = stored.sections.find(item => item.id === "sec_experiment");
          const page = Number.isInteger(step) && step >= 0 && step < planned.length
            ? section?.pages.find(item => item.id === `experiment_page_${step}` && item.questionText === PRESET_QUESTIONS.find(problem => problem.id === planned[step])?.text)
            : undefined;
          if (!progress || !section || !page) {
            setSaveStatus("error");
            return;
          }
          setSections([section]);
          setActiveSectionId("sec_experiment");
          setActivePageId(page.id);
          setSelectedPreset(planned[step]);
          setPraiseMode("super_praise");
          setExperimentStep(step);
          setExperimentFinished(progress.finished);
          setOptionalChosen(progress.optionalChosen);
          setPageTransforms(stored.pageTransforms ?? {});
          return;
        }

        const validSections = stored.sections.filter(section =>
          section && typeof section.id === "string" && Array.isArray(section.pages) && section.pages.length > 0
        );
        if (validSections.length === 0) return;

        const requestedSection = validSections.find(section => section.id === stored.activeSectionId) ?? validSections[0];
        const requestedPage = requestedSection.pages.find(page => page.id === stored.activePageId) ?? requestedSection.pages[0];
        setSections(validSections);
        setActiveSectionId(requestedSection.id);
        setActivePageId(requestedPage.id);
        setSelectedPreset(stored.selectedPreset || "custom");
        setPraiseMode(["super_praise", "support", "challenge"].includes(stored.praiseMode) ? stored.praiseMode : "super_praise");
        setPageTransforms(stored.pageTransforms ?? {});
      })
      .catch((error) => {
        console.warn("Saved notebook could not be restored.", error);
        if (!cancelled) setSaveStatus("error");
      })
      .finally(() => {
        if (!cancelled) {
          persistenceReadyRef.current = true;
          setSaveStatus(current => current === "error" ? "error" : "saved");
        }
      });

    return () => { cancelled = true; };
  }, [experimentRoute]);

  useEffect(() => {
    if (!persistenceReadyRef.current) return;

    const generation = ++autosaveGenerationRef.current;
    setSaveStatus("saving");
    const timer = window.setTimeout(() => {
      if (generation !== autosaveGenerationRef.current || experimentTransitionRef.current) return;
      void saveWorkspace<SectionData[]>({
        schemaVersion: 1,
        savedAt: new Date().toISOString(),
        sections,
        activeSectionId,
        activePageId,
        selectedPreset,
        praiseMode,
        pageTransforms,
        experimentProgress: isExperiment ? {
          step: experimentStep,
          finished: experimentFinished,
          optionalChosen,
        } : undefined,
      }, getWorkspaceKey())
        .then(() => setSaveStatus("saved"))
        .catch((error) => {
          console.warn("Notebook autosave failed.", error);
          setSaveStatus("error");
        });
    }, 500);

    return () => window.clearTimeout(timer);
  }, [sections, activeSectionId, activePageId, selectedPreset, praiseMode, pageTransforms, isExperiment, experimentStep, experimentFinished, optionalChosen]);


  const handleSectionSwitch = useCallback((newSectionId: string) => {
    if (isExperiment) return;
    setActiveAssistance(null);
    setRevealedHint(null);
    lastAssistedStrokeRef.current = null;
    setActiveSectionId(newSectionId);
    const targetSection = sections.find(s => s.id === newSectionId);
    if (targetSection && targetSection.pages.length > 0) {
      setActivePageId(targetSection.pages[0].id);
    }
  }, [sections, isExperiment]);

  const handlePageSwitch = useCallback((newPageId: string) => {
    if (isExperiment) return;
    setActiveAssistance(null);
    setRevealedHint(null);
    lastAssistedStrokeRef.current = null;
    recordStudyEvent({
      learnerId: learnerIdRef.current,
      sessionId: sessionIdRef.current,
      problemId: newPageId,
      eventType: "next_problem_started",
    });
    setActivePageId(newPageId);
  }, [isExperiment]);

  const updateActivePage = useCallback((updater: (page: PageData) => PageData) => {
    setSections(prev => prev.map(s => s.id !== activeSectionId ? s : {
      ...s, pages: s.pages.map(p => p.id !== activePageId ? p : updater(p))
    }));
  }, [activeSectionId, activePageId]);

  const setStrokesForActivePage = useCallback((update: React.SetStateAction<Stroke[]>) => {
    if (experimentLocked) return;
    updateActivePage(p => ({ ...p, strokes: typeof update === "function" ? update(p.strokes) : update }));
  }, [updateActivePage, experimentLocked]);

  const setImagesForActivePage = useCallback((update: React.SetStateAction<CanvasImage[]>) => {
    if (isExperiment) return;
    updateActivePage(p => ({ ...p, images: typeof update === "function" ? update(p.images) : update }));
  }, [updateActivePage, isExperiment]);

  const setTextsForActivePage = useCallback((update: React.SetStateAction<CanvasText[]>) => {
    if (isExperiment) return;
    updateActivePage(p => ({ ...p, texts: typeof update === "function" ? update(p.texts) : update }));
  }, [updateActivePage, isExperiment]);

  useEffect(() => {
    if (!isExperiment || !experimentConfig || !activePage.trialStartedAt || activePage.firstStrokeLatencyMs !== undefined || activePage.skippedAt) return;
    const firstDraw = activePage.strokes.find(stroke => stroke.type === "draw");
    if (!firstDraw || firstStrokeLoggedRef.current.has(activePage.id)) return;
    firstStrokeLoggedRef.current.add(activePage.id);
    const latencyMs = Math.max(0, firstDraw.startTime - activePage.trialStartedAt);
    updateActivePage(page => ({ ...page, firstStrokeLatencyMs: latencyMs }));
    void recordStudyEvent({
      learnerId: learnerIdRef.current,
      sessionId: sessionIdRef.current,
      problemId: selectedPreset,
      eventType: "first_stroke",
      data: { study_set: experimentConfig.setId, trial: experimentStep + 1, latency_ms: latencyMs },
    });
  }, [isExperiment, experimentConfig, activePage, selectedPreset, experimentStep, updateActivePage]);

  useEffect(() => {
    if (!isExperiment || !experimentConfig || !showPraiseModal || !activePage.thoughtTypeBadge) return;
    const openedAt = Date.now();
    void recordStudyEvent({
      learnerId: learnerIdRef.current, sessionId: sessionIdRef.current,
      problemId: selectedPreset, eventType: "feedback_displayed",
      data: { study_set: experimentConfig.setId, trial: experimentStep + 1, source: activePage.analysisSource, feedback_condition: experimentConfig.feedbackCondition },
    });
    return () => {
      void recordStudyEvent({
        learnerId: learnerIdRef.current, sessionId: sessionIdRef.current,
        problemId: selectedPreset, eventType: "feedback_closed",
        data: { study_set: experimentConfig.setId, trial: experimentStep + 1, visible_ms: Math.max(0, Date.now() - openedAt) },
      });
    };
  }, [isExperiment, experimentConfig, showPraiseModal, activePage.id, activePage.thoughtTypeBadge, activePage.analysisSource, selectedPreset, experimentStep]);

  useEffect(() => {
    let cancelled = false;
    const evaluatePause = async () => {
      if (isExperiment) return;
      if (getStudyFeedbackCondition() === "neutral_summary") return;
      const draws = activePage.strokes.filter(stroke => stroke.type === "draw");
      if (draws.length === 0 || isAnalyzing || isReplaying) return;
      const lastStrokeEnd = Math.max(...draws.map(stroke => stroke.endTime));
      const idleSeconds = Math.max(0, (Date.now() - lastStrokeEnd) / 1000);

      if (activeAssistance && lastAssistedStrokeRef.current !== null && lastStrokeEnd > lastAssistedStrokeRef.current) {
        recordStudyEvent({
          learnerId: learnerIdRef.current,
          sessionId: sessionIdRef.current,
          problemId: selectedPreset,
          eventType: "writing_resumed",
          data: { after_intervention: activeAssistance.action },
        });
        setActiveAssistance(null);
        setRevealedHint(null);
        lastAssistedStrokeRef.current = null;
        return;
      }
      if (idleSeconds < 15 || lastAssistedStrokeRef.current === lastStrokeEnd) return;
      if (Date.now() - lastAssistCheckAtRef.current < 10_000) return;
      lastAssistCheckAtRef.current = Date.now();

      try {
        const response = await requestPauseAssist({
          learnerId: learnerIdRef.current,
          sessionId: sessionIdRef.current,
          problemId: selectedPreset,
          questionText: activePage.questionText,
          strokes: activePage.strokes,
          idleSeconds,
          pageVisible: document.visibilityState === "visible",
          hintCount: activePage.hintCount ?? 0,
        });
        if (cancelled || response.intervention.action === "wait") return;
        lastAssistedStrokeRef.current = lastStrokeEnd;
        setActiveAssistance(response.intervention);
        updateActivePage(page => ({ ...page, learnerState: response.learner_state }));
        recordStudyEvent({
          learnerId: learnerIdRef.current,
          sessionId: sessionIdRef.current,
          problemId: selectedPreset,
          eventType: "intervention_offered",
          data: {
            action: response.intervention.action,
            idle_seconds: Math.round(idleSeconds),
            policy_version: response.intervention.policy_version,
            state: response.learner_state,
            hint_count: activePage.hintCount ?? 0,
            unresolved_pause_ratio: (response.process_metrics.unresolved_pause_count ?? 0) / Math.max(1, response.process_metrics.pause_count),
            repeated_region_signal: Math.min(1, (response.process_metrics.repeated_region_count ?? 0) / 5),
            difficulty_gap: Math.max(0, 0.5 - response.learner_state.mastery),
          },
          interventionProbability: 1,
        });
      } catch (error) {
        console.warn("Pause assistance could not be evaluated.", error);
      }
    };
    const timer = window.setInterval(() => void evaluatePause(), 3_000);
    void evaluatePause();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activePage, activeAssistance, isAnalyzing, isReplaying, selectedPreset, updateActivePage, isExperiment]);

  const dismissAssistance = useCallback(() => {
    if (activeAssistance) {
      recordStudyEvent({
        learnerId: learnerIdRef.current,
        sessionId: sessionIdRef.current,
        problemId: selectedPreset,
        eventType: "intervention_dismissed",
        data: { action: activeAssistance.action },
      });
    }
    setActiveAssistance(null);
    setRevealedHint(null);
  }, [activeAssistance, selectedPreset]);

  const revealNextHint = useCallback(() => {
    if (!activeAssistance) return;
    const currentCount = activePage.hintCount ?? 0;
    const hint = activeAssistance.hint_levels[Math.min(currentCount, activeAssistance.hint_levels.length - 1)];
    if (!hint) return;
    setRevealedHint(hint);
    updateActivePage(page => ({ ...page, hintCount: (page.hintCount ?? 0) + 1 }));
    recordStudyEvent({
      learnerId: learnerIdRef.current,
      sessionId: sessionIdRef.current,
      problemId: selectedPreset,
      eventType: "hint_opened",
      data: { level: currentCount + 1, action: activeAssistance.action },
    });
  }, [activeAssistance, activePage.hintCount, selectedPreset, updateActivePage]);

  const handleResetTransform = useCallback(() => {
    setPageTransforms(previous => ({ ...previous, [activePageId]: { pan: { x: 0, y: 0 }, zoom: 1 } }));
    setActivePageId(prev => prev); setSections(prev => [...prev]);
  }, [activePageId]);

  const handleClear = useCallback(() => {
    if (isExperiment) return;
    if (window.confirm("このページの内容をすべて消去しますか？")) {
      updateActivePage(p => ({
        ...p,
        strokes: [], images: [], texts: [], aiAnnotations: [],
        thoughtTypeBadge: undefined, praisePoints: undefined, encouragementMessage: undefined,
        recognizedContent: undefined, aiSummary: undefined, analysisSource: undefined,
        analysisNotice: undefined, processMetrics: undefined, rawAiResponse: undefined,
      }));
      setReplayedStrokes([]); setIsReplaying(false);
      setActiveAssistance(null); setRevealedHint(null); lastAssistedStrokeRef.current = null;
    }
  }, [updateActivePage, isExperiment]);

  const handleUndo = useCallback(() => {
    setStrokesForActivePage(previous => undoLastStrokeAction(previous));
  }, [setStrokesForActivePage]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (isExperiment) return;
    const files = Array.from(e.target.files ?? []);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (files.length === 0) return;

    void (async () => {
      setAnalysisError(null);
      for (const [index, file] of files.entries()) {
        if (file.size > 20 * 1024 * 1024) {
          setAnalysisError(`${file.name} は20MBを超えているため読み込めません。`);
          continue;
        }
        if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
          try {
            const renderedPages = await renderPdfPages(file);
            const addedPages: PageData[] = renderedPages.map((rendered) => {
              const displayScale = Math.min(1, 1050 / rendered.width);
              return {
                id: createId("page_pdf"),
                title: rendered.name,
                date: new Date().toLocaleString(),
                strokes: [],
                images: [{
                  id: createId("img_pdf"),
                  url: rendered.dataUrl,
                  x: 40,
                  y: 40,
                  width: Math.round(rendered.width * displayScale),
                  height: Math.round(rendered.height * displayScale),
                  name: rendered.name,
                }],
                texts: [],
                bgFileName: file.name,
                aiAnnotations: [],
                sourceType: "pdf",
                hintCount: 0,
              };
            });
            if (addedPages.length > 0) {
              setSections(previous => previous.map(section => section.id !== activeSectionId ? section : {
                ...section,
                pages: [...section.pages, ...addedPages],
              }));
              setActivePageId(addedPages[0].id);
              setSelectedPreset("photo_problem");
            }
          } catch (error) {
            setAnalysisError(error instanceof Error ? error.message : "PDFを読み込めませんでした。");
          }
          continue;
        }
        if (!file.type.startsWith("image/")) {
          setAnalysisError(`${file.name} は対応していないファイル形式です。`);
          continue;
        }
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error ?? new Error("画像を読み込めませんでした。"));
          reader.readAsDataURL(file);
        });
        const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve({ width: image.width, height: image.height });
          image.onerror = () => reject(new Error("画像を表示できませんでした。"));
          image.src = base64;
        });
        const displayScale = Math.min(1, 1050 / dimensions.width);
        const newImage: CanvasImage = {
          id: createId("img"),
          url: base64,
          x: 50 + index * 20,
          y: 50 + index * 20,
          width: Math.round(dimensions.width * displayScale),
          height: Math.round(dimensions.height * displayScale),
          name: file.name,
        };
        updateActivePage(page => ({
          ...page,
          title: page.title || file.name,
          images: [...page.images, newImage],
          bgFileName: file.name,
          sourceType: "photo",
        }));
        setSelectedPreset("photo_problem");
      }
    })().catch((error) => {
      setAnalysisError(error instanceof Error ? error.message : "ファイルを読み込めませんでした。");
    });
  }, [activeSectionId, updateActivePage, isExperiment]);

  const exportCanvasWithWhiteBackground = (mimeType: string, quality: number = 1.0) => {
    const canvas = document.getElementById("homeruai-canvas") as HTMLCanvasElement;
    if (!canvas) return null;

    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const ctx = tempCanvas.getContext("2d");
    
    if (ctx) {
      // 白背景を塗りつぶす
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
      // その上に元のキャンバスの内容を描画
      ctx.drawImage(canvas, 0, 0);
    }
    
    return tempCanvas.toDataURL(mimeType, quality);
  };

  const handleExportPNG = useCallback(() => {
    // 白背景合成済みのPNGデータURLを取得
    const url = exportCanvasWithWhiteBackground("image/png");
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = `${activePage.title || "export"}.png`;
    a.click();
  }, [activePage.title]);

  const handleExportPDF = useCallback(() => {
    const canvas = document.getElementById("homeruai-canvas") as HTMLCanvasElement;
    if (!canvas) return;
    
    // PDF用にはJPEG（品質1.0）として白背景で取得
    const imgData = exportCanvasWithWhiteBackground("image/jpeg", 1.0);
    if (!imgData) return;

    // PDFのサイズは画面上の見た目のサイズ（CSSサイズ）に合わせる
    const pdfWidth = canvas.clientWidth; 
    const pdfHeight = canvas.clientHeight;

    const pdf = new jsPDF({
      orientation: pdfWidth > pdfHeight ? "landscape" : "portrait",
      unit: "px",
      format: [pdfWidth, pdfHeight]
    });
    
    pdf.addImage(imgData, "JPEG", 0, 0, pdfWidth, pdfHeight);
    pdf.save(`${activePage.title || "export"}.pdf`);
  }, [activePage.title]);

  const handleSelectPreset = useCallback((presetId: string) => {
    if (isExperiment) return;
    if (presetId === "input_custom") {
      setSelectedPreset(presetId);
      setCustomProblemTitle(activePage.title || "任意の問題");
      setCustomProblemText(activePage.questionText || "");
      setShowCustomProblemModal(true);
      return;
    }

    if (presetId === "photo_problem") {
      setSelectedPreset(presetId);
      fileInputRef.current?.click();
      return;
    }

    const target = PRESET_QUESTIONS.find(q => q.id === presetId);
    if (!target) return;
    if (presetId !== selectedPreset && activePage.strokes.some(stroke => !stroke.isErased) && !window.confirm("問題を切り替えると、このページの筆記内容が消えます。切り替えますか？")) return;

    setSelectedPreset(presetId);
    recordStudyEvent({
      learnerId: learnerIdRef.current,
      sessionId: sessionIdRef.current,
      problemId: presetId,
      eventType: "next_problem_started",
      data: { feedback_condition: getStudyFeedbackCondition() },
    });

    updateActivePage(p => {
      const filteredTexts = p.texts.filter(t => !t.id.startsWith("txt_preset_"));
      const newTexts: CanvasText[] = target.text ? [
        ...filteredTexts,
        {
          id: `txt_preset_${Date.now()}`,
          text: target.text,
          x: 60,
          y: 40,
          fontSize: 22,
          color: "#1e293b",
          fontWeight: "bold",
          fontStyle: "normal",
          textDecoration: "none"
        }
      ] : filteredTexts;

      return {
        ...p,
        title: target.title,
        questionText: target.text || undefined,
        texts: newTexts,
        strokes: [],
        aiAnnotations: [],
        thoughtTypeBadge: undefined,
        praisePoints: undefined,
        encouragementMessage: undefined,
        recognizedContent: undefined,
        aiSummary: undefined,
        analysisSource: undefined,
        analysisNotice: undefined,
        processMetrics: undefined,
        learnerState: undefined,
        intervention: undefined,
        recognitionConfidence: undefined,
        recognitionUncertainties: undefined,
        skillTags: undefined,
        sourceType: presetId === "custom" ? "blank" : "preset",
        hintCount: 0,
        rawAiResponse: undefined
      };
    });
    setReplayedStrokes([]);
    setIsReplaying(false);
  }, [activePage.title, activePage.questionText, activePage.strokes, selectedPreset, updateActivePage, isExperiment]);

  const handleApplyCustomProblem = useCallback(() => {
    if (isExperiment) return;
    const finalTitle = customProblemTitle.trim() || "任意の問題";
    const finalQuestion = customProblemText.trim();

    updateActivePage(p => {
      const filteredTexts = p.texts.filter(t => !t.id.startsWith("txt_preset_"));
      const newTexts: CanvasText[] = (placeCustomTextOnCanvas && finalQuestion) ? [
        ...filteredTexts,
        {
          id: `txt_preset_${Date.now()}`,
          text: `【問題】\n${finalQuestion}`,
          x: 60,
          y: 40,
          fontSize: 20,
          color: "#1e293b",
          fontWeight: "bold",
          fontStyle: "normal",
          textDecoration: "none"
        }
      ] : filteredTexts;

      return {
        ...p,
        title: finalTitle,
        questionText: finalQuestion,
        texts: newTexts,
        strokes: [],
        aiAnnotations: [],
        thoughtTypeBadge: undefined,
        praisePoints: undefined,
        encouragementMessage: undefined,
        recognizedContent: undefined,
        aiSummary: undefined,
        analysisSource: undefined,
        analysisNotice: undefined,
        processMetrics: undefined,
        learnerState: undefined,
        intervention: undefined,
        recognitionConfidence: undefined,
        recognitionUncertainties: undefined,
        skillTags: undefined,
        sourceType: "typed",
        hintCount: 0,
        rawAiResponse: undefined
      };
    });
    setSelectedPreset("input_custom");
    setShowCustomProblemModal(false);
    setReplayedStrokes([]);
    setIsReplaying(false);
  }, [customProblemTitle, customProblemText, placeCustomTextOnCanvas, updateActivePage, isExperiment]);

  const handleAnalyze = useCallback(async () => {
    if (isAnalyzing || experimentLocked || (isExperiment && saveStatus === "loading")) return;
    if (activePage.strokes.length === 0) {
      alert("分析する手書きプロセスがありません。キャンバスに記述してください。");
      return;
    }
    
    setIsAnalyzing(true);
    setAnalysisError(null);
    updateActivePage(p => ({ ...p, aiAnnotations: [] }));
    
    try {
      const refImage = activePage.images.length > 0 ? activePage.images[0] : null;
      const selectedBounds = refImage && activePage.problemRegion ? {
        x: refImage.x + refImage.width * activePage.problemRegion.x,
        y: refImage.y + refImage.height * activePage.problemRegion.y,
        width: refImage.width * activePage.problemRegion.width,
        height: refImage.height * activePage.problemRegion.height,
      } : undefined;
      const directlyInside = (stroke: Stroke) => !selectedBounds || stroke.points.some(point =>
        point.x >= selectedBounds.x && point.x <= selectedBounds.x + selectedBounds.width
        && point.y >= selectedBounds.y && point.y <= selectedBounds.y + selectedBounds.height
      );
      const selectedDrawIds = new Set(activePage.strokes.filter(stroke => stroke.type === "draw" && directlyInside(stroke)).map(stroke => stroke.strokeId));
      const strokesForAnalysis = activePage.strokes.filter(stroke =>
        directlyInside(stroke) || stroke.targetStrokeIds?.some(id => selectedDrawIds.has(id))
      );
      if (strokesForAnalysis.length === 0) {
        throw new Error("選択した問題範囲に手書きがありません。範囲を選び直してください。");
      }
      const ghostResult = await generateGhostRender(strokesForAnalysis, refImage);
      if (!ghostResult.image) throw new Error("分析用の画像を作成できませんでした。もう一度ペンで書いてからお試しください。");
      const sourceImage = refImage ? await prepareSourceImage(refImage.url, activePage.problemRegion) : undefined;
      const processImage = refImage && activePage.problemRegion
        ? await prepareSourceImage(ghostResult.image, activePage.problemRegion)
        : ghostResult.image;
      const analysisBounds = selectedBounds ?? ghostResult.virtualBounds;

      const targetQuestionId = selectedPreset !== "custom" ? selectedPreset : (activePage.title || "custom");
      const presetDifficulty = PRESET_QUESTIONS.find(question => question.id === selectedPreset)?.difficulty;
      const currentFeedbackCondition = experimentConfig?.feedbackCondition ?? getStudyFeedbackCondition();

      const payload = {
        questionId: targetQuestionId,
        questionText: activePage.questionText || undefined,
        praiseMode: praiseMode,
        feedbackCondition: currentFeedbackCondition,
        learnerId: learnerIdRef.current,
        sessionId: sessionIdRef.current,
        sourceType: activePage.sourceType ?? (refImage ? "photo" : activePage.questionText ? "typed" : "blank"),
        sourceImage,
        analysisBounds: analysisBounds ? {
          min_x: analysisBounds.x,
          min_y: analysisBounds.y,
          width: analysisBounds.width,
          height: analysisBounds.height,
        } : undefined,
        hintCount: activePage.hintCount ?? 0,
        problemDifficulty: presetDifficulty,
        strokes: strokesForAnalysis.map(s => {
          let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
          for (const p of s.points) {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
          }
          if (minX === Infinity) {
            minX = 0; maxX = 0; minY = 0; maxY = 0;
          }
          return {
            strokeId: s.strokeId,
            type: s.type,
            startTime: s.startTime,
            endTime: s.endTime,
            points: [],
            boundingBox: [minX, maxX, minY, maxY],
            pointCount: s.points.length,
            color: s.color,
            width: s.width,
            isErased: s.isErased || false,
            erasedAt: s.erasedAt,
            targetStrokeIds: s.targetStrokeIds
          };
        }),
        image: processImage,
        imageWidth: refImage?.width,
        imageHeight: refImage?.height,
        imageX: refImage?.x || 0,
        imageY: refImage?.y || 0,
        model: "gemini" as const,
      };

      const postAnalysis = async (url: string) => {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 60_000);
        try {
          return await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal: controller.signal,
          });
        } finally {
          window.clearTimeout(timeout);
        }
      };

      const response = await postAnalysis(apiUrl("/api/analyze"));

      if (!response.ok) {
        let detail = "";
        try {
          const errorBody = await response.json() as { detail?: string };
          detail = typeof errorBody.detail === "string" ? ` ${errorBody.detail}` : "";
        } catch { /* JSONではないエラー応答 */ }
        throw new Error(`分析APIが応答できませんでした (${response.status})。${detail}`);
      }

      const result = await response.json() as AnalysisResponseData;

      const targetImage = refImage;
      const bounds = ghostResult.virtualBounds;
      const imgId = targetImage ? targetImage.id : "canvas_base";

      const allowedAnnotationTypes = new Set(["circle", "underline", "text", "stamp"] as const);
      const annotations: AIAnnotation[] = (Array.isArray(result.annotations) ? result.annotations : []).flatMap((mark, i) => {
        if (!Array.isArray(mark.box_2d) || mark.box_2d.length !== 4 || !allowedAnnotationTypes.has(mark.type)) return [];
        let box = mark.box_2d.map(value => Math.max(0, Math.min(1000, Math.round(Number(value))))) as [number, number, number, number];
        if (box.some(value => !Number.isFinite(value))) return [];
        if (targetImage && activePage.problemRegion) {
          const region = activePage.problemRegion;
          box = [
            Math.round((region.y + box[0] / 1000 * region.height) * 1000),
            Math.round((region.x + box[1] / 1000 * region.width) * 1000),
            Math.round((region.y + box[2] / 1000 * region.height) * 1000),
            Math.round((region.x + box[3] / 1000 * region.width) * 1000),
          ];
        }
        return [{
          id: `ai_ann_${Date.now()}_${i}`,
          imageId: imgId,
          type: mark.type,
          box_2d: box,
          comment: mark.comment || undefined,
          color: mark.type === "circle" ? "#107c41" : "#e81123",
          virtualBounds: targetImage ? undefined : bounds,
          evidenceId: mark.evidence_id,
        }];
      });

      updateActivePage(p => ({
        ...p,
        aiAnnotations: annotations,
        thoughtTypeBadge: result.thought_type_badge || "今回見えた学び方",
        praisePoints: result.praise_points || [],
        encouragementMessage: result.encouragement_message || "",
        recognizedContent: result.recognized_content,
        aiSummary: result.summary,
        analysisSource: result.source,
        analysisNotice: result.notice,
        providerErrorCategory: result.provider_error_category,
        processMetrics: result.process_metrics,
        learnerState: result.learner_state,
        intervention: result.intervention,
        recognitionConfidence: result.recognition_confidence,
        recognitionUncertainties: result.recognition_uncertainties,
        skillTags: result.skill_tags,
        feedbackCondition: result.feedback_condition ?? currentFeedbackCondition,
        rawAiResponse: result
      }));

      recordStudyEvent({
        learnerId: learnerIdRef.current,
        sessionId: sessionIdRef.current,
        problemId: targetQuestionId,
        eventType: "analysis_completed",
        data: {
          analysis_id: result.analysis_id,
          source: result.source,
          recognition_confidence: result.recognition_confidence,
          intervention_action: result.intervention?.action,
          feedback_condition: result.feedback_condition ?? currentFeedbackCondition,
          ...(experimentConfig ? { study_set: experimentConfig.setId, trial: experimentStep + 1 } : {}),
        },
      });

      void refreshDashboard();

      setShowPraiseModal(true);
    } catch (error) {
      console.warn("FastAPI connection failed.", error);
      const message = error instanceof DOMException && error.name === "AbortError"
        ? "分析が60秒以内に完了しませんでした。通信状況を確認して、もう一度お試しください。"
        : error instanceof Error ? error.message : "AI分析に失敗しました。";
      setAnalysisError(message);
    } finally {
      setIsAnalyzing(false);
    }
  }, [activePage, selectedPreset, praiseMode, refreshDashboard, updateActivePage, isAnalyzing, experimentLocked, isExperiment, saveStatus, experimentConfig, experimentStep]);


  const handleAddSection = useCallback(() => {
    if (isExperiment) return;
    const title = prompt("新しいセクションの名前を入力:", "新規セクション");
    if (!title) return;
    const newId = `sec_${Date.now()}`; const newPageId = `page_${Date.now()}`;
    setSections(prev => [...prev, {
      id: newId, title, pages: [{ id: newPageId, title: "", date: new Date().toLocaleString(), strokes: [], images: [], texts: [], bgFileName: null, aiAnnotations: [], sourceType: "blank", hintCount: 0 }]
    }]);
    setActiveSectionId(newId); setActivePageId(newPageId);
  }, [isExperiment]);

  const handleAddPage = useCallback(() => {
    if (isExperiment) return;
    const newPageId = `page_${Date.now()}`;
    setSections(prev => prev.map(s => s.id !== activeSectionId ? s : {
      ...s, pages: [...s.pages, { id: newPageId, title: "", date: new Date().toLocaleString(), strokes: [], images: [], texts: [], bgFileName: null, aiAnnotations: [], sourceType: "blank", hintCount: 0 }]
    }));
    setActivePageId(newPageId);
  }, [activeSectionId, isExperiment]);

  const persistExperimentProgress = useCallback(async (
    nextSections: SectionData[], nextStep: number, finished: boolean,
    nextOptionalChosen: boolean | null, problemId: string,
  ): Promise<boolean> => {
    if (!experimentConfig || experimentTransitionRef.current) return false;
    experimentTransitionRef.current = true;
    autosaveGenerationRef.current += 1;
    setIsTransitioning(true);
    setSaveStatus("saving");
    try {
      await saveWorkspace<SectionData[]>({
        schemaVersion: 1,
        savedAt: new Date().toISOString(),
        sections: nextSections,
        activeSectionId: "sec_experiment",
        activePageId: `experiment_page_${nextStep}`,
        selectedPreset: problemId,
        praiseMode: "super_praise",
        pageTransforms,
        experimentProgress: { step: nextStep, finished, optionalChosen: nextOptionalChosen },
      }, experimentWorkspaceKey(experimentConfig));
      setSaveStatus("saved");
      return true;
    } catch (error) {
      console.warn("Experiment progress could not be saved.", error);
      setSaveStatus("error");
      setAnalysisError("進行状況を保存できませんでした。端末の空き容量やブラウザ設定を確認して、もう一度お試しください。");
      return false;
    } finally {
      experimentTransitionRef.current = false;
      setIsTransitioning(false);
    }
  }, [experimentConfig, pageTransforms]);

  const skipExperimentTrial = useCallback(async () => {
    if (!experimentConfig || experimentLocked || isAnalyzing || experimentTransitionRef.current) return;
    const now = Date.now();
    const nextSections = sections.map(section => section.id !== "sec_experiment" ? section : {
      ...section,
      pages: section.pages.map(page => page.id !== activePageId ? page : { ...page, skippedAt: now }),
    });
    if (!await persistExperimentProgress(nextSections, experimentStep, false, optionalChosen, selectedPreset)) return;
    setSections(nextSections);
    void recordStudyEvent({
      learnerId: learnerIdRef.current, sessionId: sessionIdRef.current,
      problemId: selectedPreset, eventType: "trial_skipped",
      data: {
        study_set: experimentConfig.setId, trial: experimentStep + 1,
        elapsed_ms: Math.max(0, now - (activePage.trialStartedAt ?? now)),
        stroke_count: activePage.strokes.length,
      },
    }).then(() => setPendingEventCount(pendingStudyEventCount()));
    setPendingEventCount(pendingStudyEventCount());
  }, [experimentConfig, experimentLocked, isAnalyzing, sections, activePageId, persistExperimentProgress, experimentStep, optionalChosen, selectedPreset, activePage.trialStartedAt, activePage.strokes.length]);

  const trackStudyEventDelivery = useCallback((delivery: Promise<boolean>) => {
    setPendingEventCount(pendingStudyEventCount());
    void delivery.then(confirmed => {
      const pending = pendingStudyEventCount();
      setPendingEventCount(pending);
      if (!confirmed && pending <= 0) setEventSyncError(true);
    });
  }, []);

  const advanceExperiment = useCallback(async (allowOptional = false): Promise<boolean> => {
    if (!experimentConfig || (!activePage.thoughtTypeBadge && !activePage.skippedAt) || experimentStep >= 3 || isAnalyzing || experimentTransitionRef.current) return false;
    const nextStep = experimentStep + 1;
    if (nextStep === 3 && optionalChosen !== true && !allowOptional) return false;
    const problemId = experimentProblemIds(experimentConfig)[nextStep];
    if (!problemId) return false;
    const nextSections = sections.map(section => section.id !== "sec_experiment" ? section : {
      ...section,
      pages: [...section.pages.filter(page => page.id !== `experiment_page_${nextStep}`), createExperimentPage(problemId, nextStep)],
    });
    if (!await persistExperimentProgress(nextSections, nextStep, false, nextStep === 3 ? true : optionalChosen, problemId)) return false;
    setSections(nextSections);
    setActivePageId(`experiment_page_${nextStep}`);
    setSelectedPreset(problemId);
    setExperimentStep(nextStep);
    if (nextStep === 3) setOptionalChosen(true);
    setTool("pen");
    setShowPraiseModal(false);
    setAnalysisError(null);
    setActiveAssistance(null);
    setRevealedHint(null);
    recordStudyEvent({
      learnerId: learnerIdRef.current,
      sessionId: sessionIdRef.current,
      problemId,
      eventType: "next_problem_started",
      data: { study_set: experimentConfig.setId, trial: nextStep + 1, feedback_condition: experimentConfig.feedbackCondition },
    });
    return true;
  }, [experimentConfig, activePage.thoughtTypeBadge, activePage.skippedAt, experimentStep, isAnalyzing, optionalChosen, sections, persistExperimentProgress]);

  const finishExperiment = useCallback(async (choseOptional: boolean) => {
    if (!experimentConfig || (!activePage.thoughtTypeBadge && !activePage.skippedAt) || isAnalyzing || experimentTransitionRef.current) return;
    if (experimentStep === 2) {
      if (choseOptional && !await advanceExperiment(true)) return;
      if (!choseOptional && !await persistExperimentProgress(sections, experimentStep, true, false, selectedPreset)) return;
      setOptionalChosen(choseOptional);
      trackStudyEventDelivery(recordStudyEvent({
        learnerId: learnerIdRef.current,
        sessionId: sessionIdRef.current,
        problemId: selectedPreset,
        eventType: "experiment_optional_choice",
        data: { study_set: experimentConfig.setId, chose_optional: choseOptional, feedback_condition: experimentConfig.feedbackCondition },
      }));
      if (choseOptional) return;
    } else if (experimentStep === 3) {
      if (!await persistExperimentProgress(sections, experimentStep, true, true, selectedPreset)) return;
    } else return;
    setExperimentFinished(true);
    setShowPraiseModal(false);
    trackStudyEventDelivery(recordStudyEvent({
      learnerId: learnerIdRef.current,
      sessionId: sessionIdRef.current,
      problemId: selectedPreset,
      eventType: "experiment_finished",
      data: { study_set: experimentConfig.setId, completed_trials: experimentStep + 1, chose_optional: choseOptional || optionalChosen === true, feedback_condition: experimentConfig.feedbackCondition },
    }));
    trackStudyEventDelivery(recordStudyEvent({
      learnerId: learnerIdRef.current,
      sessionId: sessionIdRef.current,
      eventType: "session_completed",
      data: { experiment: true, study_set: experimentConfig.setId, completed_trials: experimentStep + 1 },
    }));
  }, [experimentConfig, activePage.thoughtTypeBadge, activePage.skippedAt, isAnalyzing, experimentStep, selectedPreset, optionalChosen, advanceExperiment, persistExperimentProgress, sections, trackStudyEventDelivery]);

  if (!experimentRoute) {
    return <main className="experiment-status" aria-live="polite"><Loader2 className="animate-spin" size={28} />準備しています…</main>;
  }
  if (experimentRoute.kind === "invalid") {
    return <main className="experiment-status"><h1>実験用URLを確認してください</h1><p>{experimentRoute.reason}</p><p>研究者から配布されたURLを開いてください。</p></main>;
  }
  if (saveStatus === "loading") {
    return <main className="experiment-status" aria-live="polite"><Loader2 className="animate-spin" size={28} />ノートを読み込んでいます…</main>;
  }
  if (isExperiment && activeSectionId !== "sec_experiment") {
    return <main className="experiment-status"><h1>実験を開始できませんでした</h1><p>この端末の保存データを読み込めません。研究者にお知らせください。保存データは自動で消去していません。</p></main>;
  }
  if (isExperiment && experimentFinished) {
    return <main className="experiment-status experiment-complete"><CheckCircle2 size={44} /><h1>体験はここまでです</h1>
      {pendingEventCount === -2 ? <p role="status">研究記録を確認しています…</p>
        : pendingEventCount === 0 && !eventSyncError
          ? <p role="status">この端末に未送信の記録はありません。研究者の案内に沿って、外部アンケートへ進んでください。</p>
          : <div className="experiment-sync-alert" role="alert"><p>{pendingEventCount < 0 || eventSyncError ? "記録を保存・送信できませんでした。" : `記録を送信中です（未送信 ${pendingEventCount} 件）。`}この端末を閉じる前に研究者へお知らせください。</p><button type="button" onClick={() => { void flushPendingStudyEvents().then(setPendingEventCount); }}>送信を再試行</button></div>}
      <p className="experiment-complete-note">アンケートはこのアプリ内にはありません。進行状況はこの端末にも保存されます。</p></main>;
  }

  return (
    <main className={`onenote-app ${isExperiment ? "experiment-app" : ""}`}>
      {isExperiment ? (
        <header className="ribbon-header experiment-ribbon">
          <div className="onenote-header-top">
            <div className="onenote-header-title-area">
              <h1 className="onenote-header-title">HomeruAI Note</h1>
              <span className="onenote-header-badge">Homeru AI Mode</span>
              <span className="experiment-save-status" title={saveStatus === "error" ? "この端末に保存できませんでした" : "ノートはこの端末に自動保存されます"}>
                {saveStatus === "error" ? <CloudOff size={13} /> : <Cloud size={13} />}
                {saveStatus === "saving" ? "保存中" : saveStatus === "error" ? "保存できません" : "保存済み"}
              </span>
            </div>
            <div className="experiment-header-actions">
              <span className="experiment-current-problem">{experimentStep < 3 ? `問題 ${experimentStep + 1} / 3` : "追加の問題"} · {activePage.title}</span>
              {!experimentLocked ? <button type="button" className="btn btn-accent experiment-analyze-button" onClick={handleAnalyze} disabled={isAnalyzing || activePage.strokes.length === 0}>
                <Sparkles size={16} />{isAnalyzing ? "思考を読み解き中..." : experimentConfig?.feedbackCondition === "neutral_summary" ? "振り返る" : "ほめるAIで振り返る"}
              </button> : activePage.thoughtTypeBadge ? <button type="button" className="btn btn-accent experiment-analyze-button" onClick={() => setShowPraiseModal(true)} disabled={isTransitioning}>
                <Sparkles size={16} />振り返りを見る
              </button> : null}
            </div>
          </div>
          <div className="ribbon-tabs"><span className="ribbon-tab active">描画</span></div>
          <div className="ribbon-content experiment-ribbon-content" role="toolbar" aria-label="ノートの描画操作">
            <div className="ribbon-group">
              <button type="button" className={`btn ${tool === "pen" ? "btn-active" : ""}`} onClick={() => setTool("pen")} disabled={experimentLocked} aria-pressed={tool === "pen"}><PenTool size={15} />ペン</button>
              <button type="button" className={`btn ${tool === "eraser" ? "btn-active" : ""}`} onClick={() => setTool("eraser")} disabled={experimentLocked} aria-pressed={tool === "eraser"}><Eraser size={15} />消しゴム</button>
              <button type="button" className="btn" onClick={handleUndo} disabled={experimentLocked || activePage.strokes.length === 0}><Undo2 size={15} />元に戻す</button>
              <button type="button" className="btn" onClick={handleResetTransform}><Maximize2 size={15} />等倍</button>
            </div>
            {tool === "pen" ? <>
              <div className="ribbon-group experiment-color-group" aria-label="ペンの色">
                <div className="color-picker-grid" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
                  {colors.map(color => <button type="button" key={color.value} onClick={() => setBrushColor(color.value)} disabled={experimentLocked} className={`color-dot ${brushColor === color.value ? "active" : ""} ${color.value === "#ffffff" ? "color-dot-white" : ""}`} style={{ backgroundColor: color.value }} title={color.label} aria-label={`${color.label}のペン`} />)}
                </div>
              </div>
              <label className="experiment-tool-setting">ペンの太さ <input type="range" min="2" max="15" value={brushWidth} onChange={event => setBrushWidth(Number(event.target.value))} disabled={experimentLocked} /><span>{brushWidth}px</span></label>
            </> : <div className="experiment-tool-settings">
              <label>消しゴム <select value={eraserMode} onChange={event => setEraserMode(event.target.value as "stroke" | "pixel")} disabled={experimentLocked}><option value="stroke">一筆消し</option><option value="pixel">部分消し</option></select></label>
              <label>太さ <input type="range" min="10" max="80" value={eraserWidth} onChange={event => setEraserWidth(Number(event.target.value))} disabled={experimentLocked} /><span>{eraserWidth}px</span></label>
            </div>}
          </div>
        </header>
      ) : <RibbonHeader
        activeTab={activeTab} setActiveTab={setActiveTab} tool={tool} setTool={setTool}
        eraserMode={eraserMode} setEraserMode={setEraserMode}
        brushColor={brushColor} setBrushColor={setBrushColor} brushWidth={brushWidth} setBrushWidth={setBrushWidth}
        eraserWidth={eraserWidth} setEraserWidth={setEraserWidth}
        textStyle={textStyle} setTextStyle={setTextStyle}
        handleResetTransform={handleResetTransform} handleClear={handleClear}
        showReplay={showReplay} setShowReplay={setShowReplay} isReplaying={isReplaying} setIsReplaying={setIsReplaying}
        setReplayedStrokes={setReplayedStrokes} activePageStrokes={activePage.strokes}
        fileInputRef={fileInputRef} handleFileUpload={handleFileUpload}
        onSelectProblemRegion={() => setShowProblemRegionSelector(true)}
        canSelectProblemRegion={activePage.images.length > 0}
        hasProblemRegion={Boolean(activePage.problemRegion)}
        handleExportPNG={handleExportPNG} handleExportPDF={handleExportPDF} handleAnalyze={handleAnalyze} isAnalyzing={isAnalyzing}
        selectedPreset={selectedPreset} onSelectPreset={handleSelectPreset}
        onOpenCustomProblemModal={() => {
          setCustomProblemTitle(activePage.title || "任意の問題");
          setCustomProblemText(activePage.questionText || "");
          setShowCustomProblemModal(true);
        }}
        praiseMode={praiseMode} setPraiseMode={setPraiseMode}
        handleUndo={handleUndo} saveStatus={saveStatus}
      />}
      {isExperiment ? <section className="motivation-bar experiment-motivation-bar" aria-label="調査の進行状況">
        <div className="motivation-message">
          <span>{experimentConfig?.feedbackCondition === "neutral_summary" ? "今回の取り組み" : "今日もノートを開けたね"}</span>
          <strong>{experimentConfig?.feedbackCondition === "neutral_summary" ? `${activePage.strokes.filter(stroke => stroke.type === "draw").length}本の筆記を記録中` : activePage.strokes.some(stroke => stroke.type === "draw") ? `${activePage.strokes.filter(stroke => stroke.type === "draw").length}本の一歩を記録中` : "まず一画から始めよう"}</strong>
        </div>
        <div className="compact-level experiment-level">
          <div className="compact-level-label">{experimentStep < 3 ? `問題 ${experimentStep + 1} / 3` : "追加の問題"}</div>
          <div className="compact-xp"><div style={{ width: `${Math.min(100, (experimentStep + 1) / 3 * 100)}%` }} /></div>
        </div>
        <div className="experiment-actions" role="group" aria-label="次のステップ">
          {!experimentLocked && <button type="button" onClick={() => { void skipExperimentTrial(); }} disabled={isAnalyzing || isTransitioning}>書けないまま次へ</button>}
          {experimentLocked && <>
            {experimentStep < 2 && <button type="button" className="primary" onClick={() => { void advanceExperiment(); }} disabled={isTransitioning}>{isTransitioning ? "保存中…" : "次の問題へ"}</button>}
            {experimentStep === 2 && <><button type="button" onClick={() => { void finishExperiment(false); }} disabled={isTransitioning}>ここで終了</button><button type="button" className="primary" onClick={() => { void finishExperiment(true); }} disabled={isTransitioning}>追加の1問を解く</button></>}
            {experimentStep === 3 && <button type="button" className="primary" onClick={() => { void finishExperiment(true); }} disabled={isTransitioning}>体験を終了</button>}
          </>}
        </div>
      </section> : <section className="motivation-bar" aria-label="今日の学習状況">
        <div className="motivation-message">
          <span>今日もノートを開けたね</span>
          <strong>{activePage.strokes.length > 0 ? `${activePage.strokes.filter(stroke => stroke.type === "draw").length}本の一歩を記録中` : "まず一画から始めよう"}</strong>
        </div>
        <div className="compact-level">
          <div className="compact-level-label"><Flame size={16} />Lv.{dashboard?.level ?? 1}</div>
          <div className="compact-xp"><div style={{ width: `${dashboard ? Math.round(dashboard.level_xp / dashboard.xp_to_next_level * 100) : 0}%` }} /></div>
          <span>{dashboard?.total_xp ?? 0} XP</span>
        </div>
        <button className="dashboard-button" onClick={() => { setShowDashboard(true); void refreshDashboard(true); }}><BarChart3 size={18} />成長を見る</button>
        <button className={`debug-button ${showDebug ? "active" : ""}`} onClick={() => setShowDebug(value => !value)} title="研究者向けデバッグ表示"><Bug size={17} />Debug</button>
      </section>}
      {isExperiment && <section className="experiment-guide" aria-live="polite">
        {activePage.skippedAt ? "この問題は筆記なしで記録しました。次の問題へ進めます。" : experimentLocked ? activePage.feedbackCondition === "neutral_summary" ? "振り返りを確認したら、次へ進んでください。" : "ノートの花丸も見られます。準備ができたら次へ進んでください。" : "下のノートに書いてください。途中まででも大丈夫。書いたら右上の「振り返る」を押します。"}
      </section>}
      {!isExperiment && showDashboard && <LearningDashboard data={dashboard} loading={dashboardLoading} onClose={() => setShowDashboard(false)} />}
      <div className="onenote-container">
        {isExperiment ? <>
          <aside className="section-sidebar experiment-section-sidebar" aria-label="調査ノート"><div className="sidebar-add-btn">固定のノート</div><ul className="sidebar-list"><li className="section-item active">調査ノート</li></ul></aside>
          <aside className="page-sidebar experiment-page-sidebar" aria-label="問題の進行"><div className="sidebar-add-btn">出題順</div><ul className="sidebar-list">
            {[0, 1, 2, ...(optionalChosen ? [3] : [])].map(index => <li key={index} className={`page-item ${index === experimentStep ? "active" : ""}`} aria-current={index === experimentStep ? "step" : undefined}>
              <span className="page-item-title">{index < 3 ? `問題 ${index + 1}` : "追加の問題"}</span><span className="page-item-date">{index < experimentStep ? "完了" : index === experimentStep ? activePage.title : "このあと"}</span>
            </li>)}
          </ul></aside>
        </> : <Sidebar sections={sections} activeSectionId={activeSectionId} activePageId={activePageId} handleSectionSwitch={handleSectionSwitch} handlePageSwitch={handlePageSwitch} handleAddSection={handleAddSection} handleAddPage={handleAddPage} />}
        <div className="canvas-main-area">
          <div className="canvas-header">
            {isExperiment ? <><h1 className="canvas-title-input experiment-canvas-title">{activePage.title}</h1><div className="canvas-date-label">この問題をノートに解いてみましょう</div></> : <><input type="text" value={activePage.title} onChange={e => updateActivePage(p => ({ ...p, title: e.target.value }))} className="canvas-title-input" placeholder="無題のページ" /><div className="canvas-date-label">{activePage.date}</div></>}
          </div>
<div className="canvas-body" style={{ display: "flex", flexDirection: "row", width: "100%", height: "100%", overflow: "hidden" }}>
  <div style={{ flex: 1, position: "relative", width: "100%", height: "100%" }}>
              <Canvas
                key={activePageId}
                strokes={isReplaying ? replayedStrokes : activePage.strokes} setStrokes={setStrokesForActivePage}
                images={activePage.images} setImages={setImagesForActivePage}
                texts={activePage.texts} setTexts={setTextsForActivePage}
                aiAnnotations={activePage.feedbackCondition === "neutral_summary" ? [] : activePage.aiAnnotations}
                tool={tool} eraserMode={eraserMode} brushColor={brushColor} brushWidth={brushWidth} eraserWidth={eraserWidth} textStyle={textStyle}
                isReplaying={isReplaying || experimentLocked} initialPan={pageTransforms[activePageId]?.pan || { x: 0, y: 0 }} initialZoom={pageTransforms[activePageId]?.zoom || 1}
                onTransformChange={(newPan, newZoom) => { setPageTransforms(previous => ({ ...previous, [activePageId]: { pan: newPan, zoom: newZoom } })); }}
                onPointerDiagnostics={!isExperiment && showDebug ? setPointerDiagnostics : undefined}
              />
              {!isExperiment && showDebug && (
                <DebugPanel
                  learnerState={activePage.learnerState}
                  dashboard={dashboard}
                  metrics={activePage.processMetrics}
                  pointer={pointerDiagnostics}
                  analysisSource={activePage.analysisSource}
                  providerError={activePage.providerErrorCategory}
                  recognitionConfidence={activePage.recognitionConfidence}
                  strokeCount={activePage.strokes.length}
                  imageCount={activePage.images.length}
                  problemRegion={activePage.problemRegion}
                  onClose={() => setShowDebug(false)}
                />
              )}
              {!isExperiment && activeAssistance && (
                <aside aria-live="polite" style={{
                  position: "absolute", right: "20px", bottom: "24px", zIndex: 48,
                  width: "min(360px, calc(100% - 40px))", background: "#ffffff",
                  border: "2px solid #c4b5fd", borderRadius: "18px", padding: "16px",
                  boxShadow: "0 16px 36px rgba(76, 29, 149, 0.2)", display: "flex",
                  flexDirection: "column", gap: "12px", maxHeight: "calc(100% - 48px)", overflowY: "auto",
                }}>
                  <div style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                    <Bot size={24} color="#6d28d9" style={{ flexShrink: 0 }} />
                    <div>
                      <strong style={{ color: "#4c1d95", fontSize: "14px" }}>
                        {activeAssistance.action === "offer_hint" ? "考えるお手伝い" : "今の取り組み、見えているよ"}
                      </strong>
                      <p style={{ margin: "5px 0 0", color: "#334155", lineHeight: 1.55, fontSize: "13px" }}>
                        {activeAssistance.message}
                      </p>
                    </div>
                  </div>
                  {revealedHint && (
                    <div style={{ background: "#fefce8", border: "1px solid #fde68a", borderRadius: "10px", padding: "10px", color: "#713f12", fontSize: "13px", lineHeight: 1.5 }}>
                      <strong>小さなヒント：</strong> {revealedHint}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", flexWrap: "wrap" }}>
                    <button onClick={dismissAssistance} style={{ border: "1px solid #cbd5e1", background: "#ffffff", color: "#475569", borderRadius: "9px", padding: "8px 11px", cursor: "pointer", fontSize: "12px" }}>
                      このまま考える
                    </button>
                    {activeAssistance.hint_levels.length > 0 && (
                      <button onClick={revealNextHint} style={{ border: "none", background: "#6d28d9", color: "#ffffff", borderRadius: "9px", padding: "8px 12px", cursor: "pointer", fontSize: "12px", fontWeight: 700 }}>
                        {revealedHint ? "次のヒント" : "小さなヒントを見る"}
                      </button>
                    )}
                  </div>
                </aside>
              )}
              {analysisError && (
                <div role="alert" style={{ position: "absolute", top: "16px", left: "50%", transform: "translateX(-50%)", zIndex: 55, width: "min(620px, calc(100% - 32px))", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", background: "#fff7ed", color: "#9a3412", border: "1px solid #fdba74", borderRadius: "12px", padding: "12px 14px", boxShadow: "0 8px 24px rgba(0,0,0,0.12)", fontSize: "13px" }}>
                  <span><strong>分析を完了できませんでした。</strong> {analysisError}</span>
                  <button aria-label="エラーを閉じる" onClick={() => setAnalysisError(null)} style={{ border: "none", background: "transparent", color: "inherit", cursor: "pointer", padding: "2px", minWidth: "44px", minHeight: "44px", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><X size={18} /></button>
                </div>
              )}
              {!isExperiment && showProblemRegionSelector && activePage.images[0] && (
                <ProblemRegionSelector
                  imageUrl={activePage.images[0].url}
                  initialRegion={activePage.problemRegion}
                  onClose={() => setShowProblemRegionSelector(false)}
                  onApply={(problemRegion) => {
                    updateActivePage(page => ({ ...page, problemRegion }));
                    setShowProblemRegionSelector(false);
                  }}
                />
              )}
              {isAnalyzing && (
                <div 
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: "100%",
                    backgroundColor: "rgba(255, 255, 255, 0.75)",
                    backdropFilter: "blur(8px)",
                    WebkitBackdropFilter: "blur(8px)",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    alignItems: "center",
                    zIndex: 50,
                  }}
                >
                  <div 
                    style={{
                      backgroundColor: "#ffffff",
                      padding: "36px 54px",
                      borderRadius: "20px",
                      boxShadow: "0 20px 40px rgba(92, 45, 145, 0.2)",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: "18px",
                      border: "2px solid #e1dfdd",
                    }}
                  >
                    <div style={{ position: "relative" }}>
                      <Bot size={60} color="#5c2d91" />
                      <div style={{ position: "absolute", top: -8, right: -12 }}>
                        <Sparkles size={28} color="#ffb900" className="animate-spin" style={{ animationDuration: '3s' }} />
                      </div>
                    </div>
                    
                    <h3 style={{ margin: 0, fontSize: "22px", color: "#323130", fontWeight: "bold" }}>
                      思考の軌跡を読み解いています...
                    </h3>
                    
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#605e5c", fontSize: "14px" }}>
                      <Loader2 size={16} className="animate-spin" />
                      <span>消しゴムで直した跡や、じっくり考えた時間を分析中！</span>
                    </div>
                  </div>
                </div>
              )}

              {/* 🌟 ほめる先生の称賛ポップアップカード（モーダル） */}
              {showPraiseModal && (activePage.thoughtTypeBadge || activePage.aiSummary) && (
                <ModalLayer title={activePage.feedbackCondition === "neutral_summary" ? "今回の記録" : "ほめるAIの振り返り"} onClose={() => setShowPraiseModal(false)}>
                  <div style={{
                    backgroundColor: "#ffffff",
                    borderRadius: "24px",
                    boxShadow: "0 25px 60px rgba(0,0,0,0.3)",
                    maxWidth: "580px",
                    width: "100%",
                    padding: "32px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "20px",
                    position: "relative",
                    border: "1px solid #f1f5f9"
                  }}>
                    {/* 閉じるボタン */}
                    <button
                      onClick={() => setShowPraiseModal(false)}
                      style={{
                        position: "absolute", top: "14px", right: "14px",
                        background: "#f1f5f9", border: "none", borderRadius: "50%",
                        width: "44px", height: "44px", cursor: "pointer",
                        display: "flex", justifyContent: "center", alignItems: "center",
                        color: "#64748b"
                      }}
                    >
                      <X size={20} />
                    </button>

                    {/* 称号バッジヘッダー */}
                    <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
                      <div style={{
                        display: "inline-flex", alignItems: "center", gap: "6px",
                        background: activePage.feedbackCondition === "neutral_summary" ? "#f1f5f9" : "linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)",
                        color: activePage.feedbackCondition === "neutral_summary" ? "#475569" : "#b45309", padding: "6px 16px", borderRadius: "9999px",
                        fontWeight: "bold", fontSize: "14px", border: activePage.feedbackCondition === "neutral_summary" ? "1px solid #cbd5e1" : "1px solid #fcd34d"
                      }}>
                        {activePage.feedbackCondition === "neutral_summary" ? <FileText size={18} /> : <Award size={18} />}
                        {activePage.feedbackCondition === "neutral_summary" ? "今回の記録" : "今回見えた学び方"}
                      </div>

                      <h2 style={{
                        fontSize: "26px", fontWeight: "900", margin: "4px 0",
                        color: "#1e293b", letterSpacing: "-0.5px"
                      }}>
                        {activePage.thoughtTypeBadge || "自分の考えを形にした"}
                      </h2>
                      <p style={{ margin: 0, fontSize: "13px", color: "#64748b" }}>
                        {activePage.feedbackCondition === "neutral_summary"
                          ? "今回の筆記と見直しの記録です。"
                          : observedProcessDescription(activePage.processMetrics)}
                      </p>
                    </div>

                    {activePage.feedbackCondition !== "neutral_summary" && <div className="praise-celebration" aria-label="記録から見つけた一歩">
                      <span className="praise-celebration-icon" aria-hidden="true"><Flower2 size={36} /></span>
                      <div><span className="praise-celebration-kicker">あなたの過程を見つけたよ</span><strong>{praiseMoment(activePage.processMetrics)}</strong></div>
                    </div>}

                    {/* 称賛ポイント3選 */}
                    {activePage.analysisNotice && (
                      <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1e40af", borderRadius: "10px", padding: "10px 12px", fontSize: "12px", lineHeight: 1.5 }}>
                        <strong>{activePage.analysisSource === "local_fallback" ? (activePage.feedbackCondition === "neutral_summary" ? "端末内で記録を集計" : "端末内のプロセス分析で応援中") : "分析方法のお知らせ"}</strong><br />
                        {activePage.analysisNotice}
                      </div>
                    )}

                    {activePage.processMetrics && (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px" }}>
                        {[
                          ["書いた筆跡", `${activePage.processMetrics.stroke_count}本`],
                          ["書き直し", `${activePage.processMetrics.revision_count}回`],
                          ["考えた時間", `${Math.round(activePage.processMetrics.session_seconds)}秒`],
                        ].map(([label, value]) => (
                          <div key={label} style={{ textAlign: "center", background: "#faf5ff", border: "1px solid #e9d5ff", borderRadius: "10px", padding: "9px 6px" }}>
                            <div style={{ color: "#6b21a8", fontWeight: 800, fontSize: "18px" }}>{value}</div>
                            <div style={{ color: "#64748b", fontSize: "10px" }}>{label}</div>
                          </div>
                        ))}
                      </div>
                    )}

                    {!isExperiment && activePage.learnerState && activePage.feedbackCondition !== "neutral_summary" && (
                      <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "12px", padding: "12px 14px", display: "flex", flexDirection: "column", gap: "9px" }}>
                        <div style={{ color: "#334155", fontWeight: 700, fontSize: "12px" }}>今の学び方に合わせたサポート</div>
                        {[
                          ["身につきの推定", activePage.learnerState.mastery, "#2563eb"],
                          ["自分で進める力", activePage.learnerState.autonomous_engagement, "#7c3aed"],
                          ["粘り強く戻る力", activePage.learnerState.persistence, "#059669"],
                        ].map(([label, score, color]) => (
                          <div key={String(label)} style={{ display: "grid", gridTemplateColumns: "112px 1fr", gap: "8px", alignItems: "center", fontSize: "11px", color: "#475569" }}>
                            <span>{label}</span>
                            <div style={{ height: "7px", background: "#e2e8f0", borderRadius: "999px", overflow: "hidden" }}>
                              <div style={{ width: `${Math.round(Number(score) * 100)}%`, height: "100%", background: String(color), borderRadius: "999px" }} />
                            </div>
                          </div>
                        ))}
                        <div style={{ color: "#64748b", fontSize: "10px", lineHeight: 1.5 }}>
                          人格や才能の評価ではなく、この端末で観測した学習行動からサポート量を調整するための推定です。
                        </div>
                      </div>
                    )}

                    {activePage.praisePoints && activePage.praisePoints.length > 0 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                        <div style={{ fontSize: "14px", fontWeight: "bold", color: "#334155", display: "flex", alignItems: "center", gap: "6px" }}>
                          {activePage.feedbackCondition === "neutral_summary" ? <FileText size={16} color="#64748b" /> : <Sparkle size={16} color="#eab308" />}
                          {activePage.feedbackCondition === "neutral_summary" ? "記録された内容" : "取り組みの中で見つけた良かったところ"}
                        </div>
                        {activePage.praisePoints.map((point, idx) => (
                          <div key={idx} style={{
                            display: "flex", alignItems: "flex-start", gap: "12px",
                            backgroundColor: activePage.feedbackCondition === "neutral_summary" ? "#f8fafc" : "#fffbeb", padding: "12px 16px", borderRadius: "12px",
                            border: activePage.feedbackCondition === "neutral_summary" ? "1px solid #e2e8f0" : "1px solid #fde68a"
                          }}>
                            {activePage.feedbackCondition === "neutral_summary" ? <FileText size={20} color="#64748b" style={{ flexShrink: 0, marginTop: "2px" }} /> : <Sparkles size={20} color="#d97706" style={{ flexShrink: 0, marginTop: "2px" }} />}
                            <span style={{ fontSize: "14px", color: "#1e293b", lineHeight: "1.5", fontWeight: "500" }}>
                              {point}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* 先生からの温かいメッセージ */}
                    {(activePage.encouragementMessage || activePage.aiSummary) && (
                      <div style={{
                        backgroundColor: activePage.feedbackCondition === "neutral_summary" ? "#f8fafc" : "#f5f3ff", padding: "18px 20px", borderRadius: "16px",
                        border: activePage.feedbackCondition === "neutral_summary" ? "1.5px solid #cbd5e1" : "1.5px solid #ddd6fe", display: "flex", flexDirection: "column", gap: "8px"
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#5c2d91", fontWeight: "bold", fontSize: "15px" }}>
                          <Bot size={20} />
                          {activePage.feedbackCondition === "neutral_summary" ? "記録" : "学習伴走者からのメッセージ"}
                        </div>
                        <p style={{ margin: 0, fontSize: "14px", color: "#334155", lineHeight: "1.7", whiteSpace: "pre-wrap" }}>
                          {activePage.encouragementMessage || activePage.aiSummary}
                        </p>
                      </div>
                    )}

                    {/* AI問題・文字認識の確認 */}
                    {!isExperiment && activePage.recognizedContent && (
                      <div style={{ fontSize: "12px", color: "#64748b", backgroundColor: "#f8fafc", padding: "12px 14px", borderRadius: "10px", border: "1px solid #e2e8f0", display: "flex", flexDirection: "column", gap: "6px" }}>
                        {activePage.recognizedContent.recognized_question && (
                          <div style={{ color: "#334155" }}>
                            <strong style={{ color: "#5c2d91" }}>📖 取り組んだ問題:</strong> {activePage.recognizedContent.recognized_question}
                          </div>
                        )}
                        <div>
                          <strong>✍️ 読み取った式・答え:</strong> {activePage.recognizedContent.current_answer || "手書き解答"}
                        </div>
                        {activePage.recognizedContent.erased_attempts && activePage.recognizedContent.erased_attempts !== "なし" && (
                          <div style={{ color: "#e11d48" }}>
                            <strong>💡 消去した試行錯誤:</strong> {activePage.recognizedContent.erased_attempts}
                          </div>
                        )}
                        {activePage.recognitionConfidence !== undefined && activePage.recognitionConfidence < 0.7 && (
                          <div style={{ color: "#92400e", background: "#fffbeb", borderRadius: "7px", padding: "7px" }}>
                            画像認識の確信度が低めです。問題文や式が合っているか確認してください。
                            {activePage.recognitionUncertainties?.length ? `（${activePage.recognitionUncertainties.join("、")}）` : ""}
                          </div>
                        )}
                        <button
                          onClick={() => {
                            const currentQuestion = activePage.recognizedContent?.recognized_question || activePage.questionText || "";
                            const corrected = window.prompt("認識した問題文を修正してください。筆記内容は消えません。", currentQuestion);
                            if (corrected === null) return;
                            updateActivePage(page => ({ ...page, questionText: corrected.trim() || undefined }));
                            setShowPraiseModal(false);
                          }}
                          style={{ alignSelf: "flex-start", border: "none", background: "transparent", color: "#6d28d9", cursor: "pointer", padding: 0, fontSize: "11px", textDecoration: "underline" }}
                        >
                          認識した問題を修正する
                        </button>
                      </div>
                    )}

                    {!isExperiment && activePage.feedbackCondition !== "neutral_summary" && activePage.intervention && activePage.intervention.hint_levels.length > 0 && (
                      <button
                        onClick={() => {
                          setActiveAssistance(activePage.intervention ?? null);
                          setShowPraiseModal(false);
                        }}
                        style={{ border: "1px solid #c4b5fd", background: "#f5f3ff", color: "#5b21b6", padding: "10px 14px", borderRadius: "10px", cursor: "pointer", fontWeight: 700 }}
                      >
                        必要なら、小さなヒントを使う
                      </button>
                    )}

                    {/* 両モードともノートへ戻ってから次へ進む。称賛群では花丸も目に入る。 */}
                    <button
                      onClick={() => setShowPraiseModal(false)}
                      className="praise-return-button"
                      style={{
                        backgroundColor: "#5c2d91", color: "#ffffff", border: "none",
                        padding: "14px 20px", borderRadius: "12px", fontSize: "16px",
                        fontWeight: "bold", cursor: "pointer", boxShadow: "0 4px 12px rgba(92, 45, 145, 0.3)",
                        transition: "transform 0.1s ease"
                      }}
                    >
                      {activePage.feedbackCondition === "neutral_summary" ? "ノートに戻る" : "💮 ノートの花丸と赤ペンを見る！"}
                    </button>
                    {isExperiment && analysisError && <p role="alert" className="experiment-save-error">{analysisError}</p>}
                  </div>
                </ModalLayer>
              )}

              {/* 自由問題入力ダイアログ */}
              {!isExperiment && showCustomProblemModal && (
                <ModalLayer title="自由な問題を設定" onClose={() => setShowCustomProblemModal(false)}>
                  <div style={{
                    backgroundColor: "#ffffff", borderRadius: "16px", padding: "28px",
                    maxWidth: "520px", width: "90%", boxShadow: "0 20px 40px rgba(0,0,0,0.25)",
                    display: "flex", flexDirection: "column", gap: "18px",
                    border: "1px solid #e2e8f0"
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ fontSize: "24px" }}>✏️</span>
                        <h3 style={{ margin: 0, fontSize: "18px", fontWeight: "bold", color: "#1e293b" }}>自由な問題を設定</h3>
                      </div>
                      <button 
                        onClick={() => setShowCustomProblemModal(false)}
                        style={{ border: "none", background: "none", cursor: "pointer", color: "#94a3b8" }}
                      >
                        <X size={20} />
                      </button>
                    </div>

                    <p style={{ margin: 0, fontSize: "13px", color: "#64748b", lineHeight: "1.5" }}>
                      学校の宿題プリント、問題集の設問、手書きの計算など、解きたい問題を自由に入力してください。AIがその問題を理解してプロセスを褒めます！
                    </p>

                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <label style={{ fontSize: "12px", fontWeight: "bold", color: "#334155" }}>問題のタイトル / 教科:</label>
                      <input 
                        type="text"
                        value={customProblemTitle}
                        onChange={(e) => setCustomProblemTitle(e.target.value)}
                        placeholder="例: 一次方程式、鶴亀算、英語ワークP15"
                        style={{
                          padding: "8px 12px", borderRadius: "8px", border: "1px solid #cbd5e1",
                          fontSize: "14px", outline: "none"
                        }}
                      />
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <label style={{ fontSize: "12px", fontWeight: "bold", color: "#334155" }}>問題文・数式:</label>
                      <textarea
                        value={customProblemText}
                        onChange={(e) => setCustomProblemText(e.target.value)}
                        placeholder="例: 方程式 4x - 9 = 15 を解け。&#10;例: 1本120円の鉛筆と1冊150円のノートを合わせて..."
                        rows={4}
                        style={{
                          padding: "10px 12px", borderRadius: "8px", border: "1px solid #cbd5e1",
                          fontSize: "14px", outline: "none", resize: "vertical", fontFamily: "inherit"
                        }}
                      />
                    </div>

                    <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#475569", cursor: "pointer" }}>
                      <input 
                        type="checkbox"
                        checked={placeCustomTextOnCanvas}
                        onChange={(e) => setPlaceCustomTextOnCanvas(e.target.checked)}
                      />
                      ノートの上部に問題文をテキストとして配置する
                    </label>

                    <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "6px" }}>
                      <button
                        onClick={() => setShowCustomProblemModal(false)}
                        style={{
                          padding: "8px 16px", borderRadius: "8px", border: "1px solid #cbd5e1",
                          backgroundColor: "#f8fafc", color: "#475569", cursor: "pointer", fontSize: "14px"
                        }}
                      >
                        キャンセル
                      </button>
                      <button
                        onClick={handleApplyCustomProblem}
                        style={{
                          padding: "8px 20px", borderRadius: "8px", border: "none",
                          backgroundColor: "#5c2d91", color: "#ffffff", fontWeight: "bold",
                          cursor: "pointer", fontSize: "14px", boxShadow: "0 2px 8px rgba(92, 45, 145, 0.3)"
                        }}
                      >
                        決定してノートを作成
                      </button>
                    </div>
                  </div>
                </ModalLayer>
              )}

              {/* モーダルが閉じた後も表示されるフローティングボタン */}
              {!isExperiment && activePage.thoughtTypeBadge && !showPraiseModal && (
                <div style={{
                  position: "absolute", bottom: "24px", right: "24px",
                  display: "flex", flexDirection: "column", gap: "10px", zIndex: 40,
                  maxWidth: "calc(100% - 48px)", maxHeight: "calc(100% - 48px)", overflowY: "auto"
                }}>
                  <button
                    onClick={() => setShowPraiseModal(true)}
                    style={{
                      display: "flex", alignItems: "center", gap: "8px",
                      backgroundColor: "#ffffff", color: "#5c2d91",
                      border: "2px solid #5c2d91", padding: "10px 18px", borderRadius: "9999px",
                      fontSize: "14px", fontWeight: "bold", cursor: "pointer",
                      boxShadow: "0 4px 16px rgba(0,0,0,0.15)"
                    }}
                  >
                    <Award size={18} color="#f59e0b" />
                    褒めカードをもう一度見る ({activePage.thoughtTypeBadge})
                  </button>

                  {activePage.rawAiResponse !== undefined && (
                    <button
                      onClick={() => {
                        const blob = new Blob([JSON.stringify(activePage.rawAiResponse, null, 2)], { type: 'application/json' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `debug_ai_${activePage.id}.json`;
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                      style={{
                        display: "flex", alignItems: "center", gap: "6px", alignSelf: "flex-end",
                        background: "rgba(255,255,255,0.9)", color: "#64748b", border: "1px solid #cbd5e1",
                        padding: "6px 12px", borderRadius: "6px", fontSize: "11px", cursor: "pointer"
                      }}
                    >
                      <Download size={12} />
                      AI生データ(JSON)
                    </button>
                  )}
                </div>
              )}
            </div>

          </div>
        </div>
      </div>

    </main>
  );
}
