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
  , BarChart3, Bug, Flame
} from "lucide-react";
import { generateGhostRender } from "../utils/ghostRenderer";
import { loadWorkspace, saveWorkspace } from "../utils/notebookStorage";
import { undoLastStrokeAction } from "../utils/strokeHistory";
import { renderPdfPages } from "../utils/pdfImporter";
import { createId, getOrCreateLearnerId, recordStudyEvent, requestLearnerDashboard, requestPauseAssist } from "../utils/adaptiveLearning";

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

function getWorkspaceKey(): string {
  if (typeof window === "undefined") return "current";
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
            {isAnalyzing ? "思考を読み解き中..." : "ほめるAIで採点！"}
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

    void loadWorkspace<SectionData[]>(getWorkspaceKey())
      .then((stored) => {
        if (cancelled || !stored || stored.schemaVersion !== 1 || !Array.isArray(stored.sections) || stored.sections.length === 0) return;

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
  }, []);

  useEffect(() => {
    if (!persistenceReadyRef.current) return;

    setSaveStatus("saving");
    const timer = window.setTimeout(() => {
      void saveWorkspace<SectionData[]>({
        schemaVersion: 1,
        savedAt: new Date().toISOString(),
        sections,
        activeSectionId,
        activePageId,
        selectedPreset,
        praiseMode,
        pageTransforms,
      }, getWorkspaceKey())
        .then(() => setSaveStatus("saved"))
        .catch((error) => {
          console.warn("Notebook autosave failed.", error);
          setSaveStatus("error");
        });
    }, 500);

    return () => window.clearTimeout(timer);
  }, [sections, activeSectionId, activePageId, selectedPreset, praiseMode, pageTransforms]);


  const handleSectionSwitch = useCallback((newSectionId: string) => {
    setActiveAssistance(null);
    setRevealedHint(null);
    lastAssistedStrokeRef.current = null;
    setActiveSectionId(newSectionId);
    const targetSection = sections.find(s => s.id === newSectionId);
    if (targetSection && targetSection.pages.length > 0) {
      setActivePageId(targetSection.pages[0].id);
    }
  }, [sections]);

  const handlePageSwitch = useCallback((newPageId: string) => {
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
  }, []);

  const updateActivePage = useCallback((updater: (page: PageData) => PageData) => {
    setSections(prev => prev.map(s => s.id !== activeSectionId ? s : {
      ...s, pages: s.pages.map(p => p.id !== activePageId ? p : updater(p))
    }));
  }, [activeSectionId, activePageId]);

  const setStrokesForActivePage = useCallback((update: React.SetStateAction<Stroke[]>) => {
    updateActivePage(p => ({ ...p, strokes: typeof update === "function" ? update(p.strokes) : update }));
  }, [updateActivePage]);

  const setImagesForActivePage = useCallback((update: React.SetStateAction<CanvasImage[]>) => {
    updateActivePage(p => ({ ...p, images: typeof update === "function" ? update(p.images) : update }));
  }, [updateActivePage]);

  const setTextsForActivePage = useCallback((update: React.SetStateAction<CanvasText[]>) => {
    updateActivePage(p => ({ ...p, texts: typeof update === "function" ? update(p.texts) : update }));
  }, [updateActivePage]);

  useEffect(() => {
    let cancelled = false;
    const evaluatePause = async () => {
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
  }, [activePage, activeAssistance, isAnalyzing, isReplaying, selectedPreset, updateActivePage]);

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
  }, [updateActivePage]);

  const handleUndo = useCallback(() => {
    setStrokesForActivePage(previous => undoLastStrokeAction(previous));
  }, [setStrokesForActivePage]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
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
  }, [activeSectionId, updateActivePage]);

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
  }, [activePage.title, activePage.questionText, activePage.strokes, selectedPreset, updateActivePage]);

  const handleApplyCustomProblem = useCallback(() => {
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
  }, [customProblemTitle, customProblemText, placeCustomTextOnCanvas, updateActivePage]);

  const handleAnalyze = useCallback(async () => {
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
      const currentFeedbackCondition = getStudyFeedbackCondition();

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

      // Next.jsプロキシのソケット切断(ECONNRESET)を回避するため直接FastAPI(ポート8000)に接続
      const getApiUrl = () => {
        if (process.env.NEXT_PUBLIC_API_URL) {
          return `${process.env.NEXT_PUBLIC_API_URL}/api/analyze`;
        }
        if (typeof window !== "undefined") {
          return `${window.location.protocol}//${window.location.hostname}:8000/api/analyze`;
        }
        return "/api/analyze";
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

      let response: Response;
      try {
        response = await postAnalysis(getApiUrl());
      } catch (directErr) {
        console.warn("Direct FastAPI connection failed, attempting /api/analyze fallback:", directErr);
        response = await postAnalysis("/api/analyze");
      }

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
  }, [activePage, selectedPreset, praiseMode, refreshDashboard, updateActivePage]);


  const handleAddSection = useCallback(() => {
    const title = prompt("新しいセクションの名前を入力:", "新規セクション");
    if (!title) return;
    const newId = `sec_${Date.now()}`; const newPageId = `page_${Date.now()}`;
    setSections(prev => [...prev, {
      id: newId, title, pages: [{ id: newPageId, title: "", date: new Date().toLocaleString(), strokes: [], images: [], texts: [], bgFileName: null, aiAnnotations: [], sourceType: "blank", hintCount: 0 }]
    }]);
    setActiveSectionId(newId); setActivePageId(newPageId);
  }, []);

  const handleAddPage = useCallback(() => {
    const newPageId = `page_${Date.now()}`;
    setSections(prev => prev.map(s => s.id !== activeSectionId ? s : {
      ...s, pages: [...s.pages, { id: newPageId, title: "", date: new Date().toLocaleString(), strokes: [], images: [], texts: [], bgFileName: null, aiAnnotations: [], sourceType: "blank", hintCount: 0 }]
    }));
    setActivePageId(newPageId);
  }, [activeSectionId]);

  return (
    <main className="onenote-app">
      <RibbonHeader
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
      />
      <section className="motivation-bar" aria-label="今日の学習状況">
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
      </section>
      {showDashboard && <LearningDashboard data={dashboard} loading={dashboardLoading} onClose={() => setShowDashboard(false)} />}
      <div className="onenote-container">
        <Sidebar sections={sections} activeSectionId={activeSectionId} activePageId={activePageId} handleSectionSwitch={handleSectionSwitch} handlePageSwitch={handlePageSwitch} handleAddSection={handleAddSection} handleAddPage={handleAddPage} />
        <div className="canvas-main-area">
          <div className="canvas-header">
            <input type="text" value={activePage.title} onChange={e => updateActivePage(p => ({ ...p, title: e.target.value }))} className="canvas-title-input" placeholder="無題のページ" />
            <div className="canvas-date-label">{activePage.date}</div>
          </div>
<div className="canvas-body" style={{ display: "flex", flexDirection: "row", width: "100%", height: "100%", overflow: "hidden" }}>
  <div style={{ flex: 1, position: "relative", width: "100%", height: "100%" }}>
              <Canvas
                key={activePageId}
                strokes={isReplaying ? replayedStrokes : activePage.strokes} setStrokes={setStrokesForActivePage}
                images={activePage.images} setImages={setImagesForActivePage}
                texts={activePage.texts} setTexts={setTextsForActivePage}
                aiAnnotations={activePage.aiAnnotations}
                tool={tool} eraserMode={eraserMode} brushColor={brushColor} brushWidth={brushWidth} eraserWidth={eraserWidth} textStyle={textStyle}
                isReplaying={isReplaying} initialPan={pageTransforms[activePageId]?.pan || { x: 0, y: 0 }} initialZoom={pageTransforms[activePageId]?.zoom || 1}
                onTransformChange={(newPan, newZoom) => { setPageTransforms(previous => ({ ...previous, [activePageId]: { pan: newPan, zoom: newZoom } })); }}
                onPointerDiagnostics={showDebug ? setPointerDiagnostics : undefined}
              />
              {showDebug && (
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
              {activeAssistance && (
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
              {showProblemRegionSelector && activePage.images[0] && (
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
                <ModalLayer title="ほめるAIの振り返り" onClose={() => setShowPraiseModal(false)}>
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
                        position: "absolute", top: "18px", right: "18px",
                        background: "#f1f5f9", border: "none", borderRadius: "50%",
                        width: "36px", height: "36px", cursor: "pointer",
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
                        background: "linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)",
                        color: "#b45309", padding: "6px 16px", borderRadius: "9999px",
                        fontWeight: "bold", fontSize: "14px", border: "1px solid #fcd34d"
                      }}>
                        <Award size={18} />
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
                          ? "研究用の比較条件として、評価を加えず事実だけを表示しています。"
                          : "実際に記録された筆記・見直し・再開から見つけました。"}
                      </p>
                    </div>

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

                    {activePage.learnerState && activePage.feedbackCondition !== "neutral_summary" && (
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
                          <Sparkle size={16} color="#eab308" />
                          {activePage.feedbackCondition === "neutral_summary" ? "記録された内容" : "取り組みの中で見つけた良かったところ"}
                        </div>
                        {activePage.praisePoints.map((point, idx) => (
                          <div key={idx} style={{
                            display: "flex", alignItems: "flex-start", gap: "12px",
                            backgroundColor: "#f8fafc", padding: "12px 16px", borderRadius: "12px",
                            border: "1px solid #e2e8f0"
                          }}>
                            <CheckCircle2 size={20} color="#10b981" style={{ flexShrink: 0, marginTop: "2px" }} />
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
                        backgroundColor: "#f5f3ff", padding: "18px 20px", borderRadius: "16px",
                        border: "1.5px solid #ddd6fe", display: "flex", flexDirection: "column", gap: "8px"
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
                    {activePage.recognizedContent && (
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

                    {activePage.feedbackCondition !== "neutral_summary" && activePage.intervention && activePage.intervention.hint_levels.length > 0 && (
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

                    {/* ボタン */}
                    <button
                      onClick={() => setShowPraiseModal(false)}
                      style={{
                        backgroundColor: "#5c2d91", color: "#ffffff", border: "none",
                        padding: "14px 20px", borderRadius: "12px", fontSize: "16px",
                        fontWeight: "bold", cursor: "pointer", boxShadow: "0 4px 12px rgba(92, 45, 145, 0.3)",
                        transition: "transform 0.1s ease"
                      }}
                    >
                      {activePage.feedbackCondition === "neutral_summary" ? "ノートに戻る" : "💮 ノートの花丸と赤ペンを見る！"}
                    </button>
                  </div>
                </ModalLayer>
              )}

              {/* 自由問題入力ダイアログ */}
              {showCustomProblemModal && (
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
              {activePage.thoughtTypeBadge && !showPraiseModal && (
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
