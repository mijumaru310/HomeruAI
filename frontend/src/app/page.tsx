"use client";

import React, { useState, useRef, useCallback } from "react";
import Canvas from "../components/Canvas";
import ReplayPlayer from "../components/ReplayPlayer";
import { Stroke } from "../types/canvas";
import { Pan } from "../hooks/useCanvasTransform";
import { 
  PenTool, 
  Eraser, 
  Sparkles, 
  Trash2, 
  Code, 
  ChevronDown, 
  ChevronUp, 
  HelpCircle,
  Lightbulb,
  Award,
  Upload,
  FileText,
  Maximize2,
  Plus,
  Eye,
  EyeOff,
  Move
} from "lucide-react";

// ページおよびセクションのデータ構造 (高頻度ステートの pan, zoom を除外)
interface PageData {
  id: string;
  title: string;
  date: string;
  strokes: Stroke[];
  bgImageUrl: string | null;
  bgImageBase64: string | null;
  bgImageSize: { width: number; height: number } | null;
  bgFileName: string | null;
  bgImageOffset: { x: number; y: number };
}

interface SectionData {
  id: string;
  title: string;
  pages: PageData[];
}

const mockAiFeedback = {
  "総合評価": "最後まで諦めずに、自分で誤りに気づいて消しゴムで修正を試みながら解き進めたプロセスが本当に素晴らしいです！",
  "プロセスへの称賛ポイント": [
    "一度書いたアプローチを消しゴムで消し、別の視点から式を組み立て直した柔軟性。",
    "計算途中で手が止まった時間がありましたが、投げ出さずに思考を巡らせた粘り強さ。",
    "手書きのプロセスの中に、正解へつながる本質的な理解のステップがはっきりと残っています。"
  ],
  "惜しい点（ヒント）": "計算の最後のステップで掛け算または割り算に少しのズレが生じている可能性があります。もう一度最後の2行を確認してみましょう！",
  "思考タイプラベル": "粘り強い探索者 🔍"
};

const colors = [
  { value: "#323130", label: "Dark Gray" },
  { value: "#0078d4", label: "Blue" },
  { value: "#d83b01", label: "Orange Red" },
  { value: "#107c41", label: "Green" },
  { value: "#5c2d91", label: "Purple" },
];

// ==========================================
// 1. リボンヘッダーのメモ化コンポーネント
// ==========================================
interface RibbonHeaderProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  tool: "pen" | "eraser" | "select";
  setTool: (tool: "pen" | "eraser" | "select") => void;
  brushColor: string;
  setBrushColor: (color: string) => void;
  brushWidth: number;
  setBrushWidth: (w: number) => void;
  eraserWidth: number;
  setEraserWidth: (w: number) => void;
  zoom: number;
  handleResetTransform: () => void;
  handleClear: () => void;
  showReplay: boolean;
  setShowReplay: (show: boolean) => void;
  isReplaying: boolean;
  setIsReplaying: (replaying: boolean) => void;
  setReplayedStrokes: React.Dispatch<React.SetStateAction<Stroke[]>>;
  activePageStrokes: Stroke[];
  handleSetBlank: () => void;
  bgFileName: string | null;
  bgImageUrl: string | null;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleAnalyze: () => void;
  isAnalyzing: boolean;
}

const RibbonHeader = React.memo(({
  activeTab,
  setActiveTab,
  tool,
  setTool,
  brushColor,
  setBrushColor,
  brushWidth,
  setBrushWidth,
  eraserWidth,
  setEraserWidth,
  zoom,
  handleResetTransform,
  handleClear,
  showReplay,
  setShowReplay,
  isReplaying,
  setIsReplaying,
  setReplayedStrokes,
  activePageStrokes,
  handleSetBlank,
  bgFileName,
  bgImageUrl,
  fileInputRef,
  handleFileUpload,
  handleAnalyze,
  isAnalyzing
}: RibbonHeaderProps) => {
  return (
    <header className="ribbon-header">
      {/* 最上段: アプリ名とAI分析ボタン */}
      <div className="onenote-header-top">
        <div className="onenote-header-title-area">
          <h1 className="onenote-header-title">HomeruAI Note</h1>
          <span className="onenote-header-badge">OneNote Mode</span>
        </div>
        
        <div>
          <button
            onClick={handleAnalyze}
            disabled={activePageStrokes.length === 0 || isAnalyzing || isReplaying}
            className="btn btn-accent"
            style={{ backgroundColor: "#ffffff", color: "#5c2d91", borderColor: "#ffffff" }}
          >
            <Sparkles size={13} className={isAnalyzing ? "animate-spin" : ""} />
            {isAnalyzing ? "分析中..." : "思考をAI分析"}
          </button>
        </div>
      </div>

      {/* タブバー */}
      <div className="ribbon-tabs">
        <button 
          className={`ribbon-tab ${activeTab === "home" ? "active" : ""}`}
          onClick={() => setActiveTab("home")}
        >
          ホーム
        </button>
        <button 
          className={`ribbon-tab ${activeTab === "draw" ? "active" : ""}`}
          onClick={() => setActiveTab("draw")}
        >
          描画
        </button>
        <button 
          className={`ribbon-tab ${activeTab === "insert" ? "active" : ""}`}
          onClick={() => setActiveTab("insert")}
        >
          挿入
        </button>
      </div>

      {/* リボン内容 */}
      <div className="ribbon-content">
        {activeTab === "draw" ? (
          <>
            <div className="ribbon-group">
              <button
                onClick={() => setTool("pen")}
                disabled={isReplaying}
                className={`btn ${tool === "pen" && !isReplaying ? "btn-active" : ""}`}
                style={{ flexDirection: "column", height: "42px", gap: "2px", border: "none" }}
                title="Pen Tool"
              >
                <PenTool size={14} />
                <span style={{ fontSize: "8px" }}>ペン</span>
              </button>
              <button
                onClick={() => setTool("eraser")}
                disabled={isReplaying}
                className={`btn ${tool === "eraser" && !isReplaying ? "btn-active" : ""}`}
                style={{ flexDirection: "column", height: "42px", gap: "2px", border: "none" }}
                title="Eraser Tool"
              >
                <Eraser size={14} />
                <span style={{ fontSize: "8px" }}>消しゴム</span>
              </button>
              <button
                onClick={() => setTool("select")}
                disabled={isReplaying}
                className={`btn ${tool === "select" && !isReplaying ? "btn-active" : ""}`}
                style={{ flexDirection: "column", height: "42px", gap: "2px", border: "none" }}
                title="Select Tool"
              >
                <Move size={14} />
                <span style={{ fontSize: "8px" }}>選択 (画像移動)</span>
              </button>
            </div>

            {tool === "pen" && (
              <div className="ribbon-group">
                <div className="color-picker-grid">
                  {colors.map((c) => (
                    <button
                      key={c.value}
                      onClick={() => setBrushColor(c.value)}
                      className={`color-dot ${brushColor === c.value ? "active" : ""} ${c.value === "#ffffff" ? "color-dot-white" : ""}`}
                      style={{ backgroundColor: c.value }}
                      title={c.label}
                    />
                  ))}
                </div>
              </div>
            )}

            <div className="ribbon-group">
              {tool === "pen" ? (
                <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: "2px" }}>
                  <span style={{ fontSize: "8px", color: "#605e5c" }}>ペンの太さ</span>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <input
                      type="range"
                      min="2"
                      max="15"
                      value={brushWidth}
                      onChange={(e) => setBrushWidth(parseInt(e.target.value))}
                      className="accent-[#5c2d91]"
                      style={{ width: "64px", height: "4px" }}
                    />
                    <span style={{ fontSize: "9px", fontFamily: "monospace" }}>{brushWidth}px</span>
                  </div>
                </div>
              ) : tool === "eraser" ? (
                <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: "2px" }}>
                  <span style={{ fontSize: "8px", color: "#605e5c" }}>消しゴムの太さ</span>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <input
                      type="range"
                      min="10"
                      max="80"
                      value={eraserWidth}
                      onChange={(e) => setEraserWidth(parseInt(e.target.value))}
                      className="accent-[#5c2d91]"
                      style={{ width: "80px", height: "4px" }}
                    />
                    <span style={{ fontSize: "9px", fontFamily: "monospace" }}>{eraserWidth}px</span>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: "2px" }}>
                  <span style={{ fontSize: "8px", color: "#605e5c" }}>画像選択モード</span>
                  <span style={{ fontSize: "9px", color: "#a19f9d", maxWidth: "120px", whiteSpace: "normal" }}>
                    画像をドラッグして自由に動かせます。
                  </span>
                </div>
              )}
            </div>

            <div className="ribbon-group">
              <button
                onClick={handleResetTransform}
                className="btn"
                style={{ flexDirection: "column", height: "42px", gap: "2px", border: "none" }}
                title="Reset Zoom"
              >
                <Maximize2 size={14} />
                <span style={{ fontSize: "8px" }}>等倍リセット ({(zoom * 100).toFixed(0)}%)</span>
              </button>
              <button
                onClick={handleClear}
                className="btn"
                style={{ flexDirection: "column", height: "42px", gap: "2px", border: "none" }}
                title="Clear Canvas"
              >
                <Trash2 size={14} style={{ color: "#a80000" }} />
                <span style={{ fontSize: "8px", color: "#a80000" }}>全消去</span>
              </button>
            </div>

            <div className="ribbon-group" style={{ borderRight: "none" }}>
              <button
                onClick={() => {
                  setShowReplay(!showReplay);
                  setReplayedStrokes([]);
                }}
                disabled={activePageStrokes.length === 0}
                className={`btn ${showReplay ? "btn-active" : ""}`}
                style={{ flexDirection: "column", height: "42px", gap: "2px", border: "none" }}
              >
                {showReplay ? <EyeOff size={14} /> : <Eye size={14} />}
                <span style={{ fontSize: "8px" }}>タイムラプス</span>
              </button>

              {showReplay && activePageStrokes.length > 0 && (
                <div style={{ marginLeft: "8px" }}>
                  <ReplayPlayer
                    strokes={activePageStrokes}
                    isReplaying={isReplaying}
                    setIsReplaying={setIsReplaying}
                    setReplayedStrokes={setReplayedStrokes}
                  />
                </div>
              )}
            </div>
          </>
        ) : activeTab === "insert" ? (
          <>
            <div className="ribbon-group" style={{ borderRight: "none" }}>
              <button
                onClick={handleSetBlank}
                className={`btn ${!bgImageUrl ? "btn-active" : ""}`}
                style={{ flexDirection: "column", height: "42px", gap: "2px", border: "none" }}
              >
                <FileText size={14} />
                <span style={{ fontSize: "8px" }}>白紙ページ</span>
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className={`btn ${bgImageUrl ? "btn-active" : ""}`}
                style={{ flexDirection: "column", height: "42px", gap: "2px", border: "none" }}
              >
                <Upload size={14} />
                <span style={{ fontSize: "8px", maxWidth: "80px", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {bgFileName || "画像を挿入"}
                </span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileUpload}
                style={{ display: "none" }}
              />
            </div>
          </>
        ) : (
          <div style={{ fontSize: "11px", color: "#605e5c", padding: "8px 0" }}>
            ホームタブに特別な操作はありません。描画または挿入タブを使用してください。
          </div>
        )}
      </div>
    </header>
  );
});
RibbonHeader.displayName = "RibbonHeader";

// ==========================================
// 2. サイドバーのメモ化コンポーネント
// ==========================================
interface SidebarProps {
  sections: SectionData[];
  activeSectionId: string;
  activePageId: string;
  handleSectionSwitch: (id: string) => void;
  handlePageSwitch: (id: string) => void;
  handleAddSection: () => void;
  handleAddPage: () => void;
}

const Sidebar = React.memo(({
  sections,
  activeSectionId,
  activePageId,
  handleSectionSwitch,
  handlePageSwitch,
  handleAddSection,
  handleAddPage
}: SidebarProps) => {
  const activeSection = sections.find(s => s.id === activeSectionId) || sections[0];

  return (
    <>
      {/* 列1: セクション sidebar */}
      <aside className="section-sidebar">
        <button onClick={handleAddSection} className="sidebar-add-btn">
          <Plus size={14} />
          <span>セクションの追加</span>
        </button>
        <ul className="sidebar-list">
          {sections.map(s => (
            <li
              key={s.id}
              onClick={() => handleSectionSwitch(s.id)}
              className={`section-item ${s.id === activeSectionId ? "active" : ""}`}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</span>
            </li>
          ))}
        </ul>
      </aside>

      {/* 列2: ページ sidebar */}
      <aside className="page-sidebar">
        <button onClick={handleAddPage} className="sidebar-add-btn">
          <Plus size={14} />
          <span>ページの追加</span>
        </button>
        <ul className="sidebar-list">
          {activeSection.pages.map(p => (
            <li
              key={p.id}
              onClick={() => handlePageSwitch(p.id)}
              className={`page-item ${p.id === activePageId ? "active" : ""}`}
            >
              <span className="page-item-title">{p.title || "無題のページ"}</span>
              <span className="page-item-date">{p.date.split(" ")[0]}</span>
            </li>
          ))}
        </ul>
      </aside>
    </>
  );
});
Sidebar.displayName = "Sidebar";

// ==========================================
// 3. AIフィードバックパネルのメモ化コンポーネント
// ==========================================
interface AiFeedbackPanelProps {
  isAnalyzing: boolean;
  aiAnalysisResult: typeof mockAiFeedback | null;
  setAiAnalysisResult: (res: typeof mockAiFeedback | null) => void;
  setIsAnalyzing: (analyzing: boolean) => void;
  activePageStrokes: Stroke[];
  showDebug: boolean;
  setShowDebug: (show: boolean) => void;
}

const AiFeedbackPanel = React.memo(({
  isAnalyzing,
  aiAnalysisResult,
  setAiAnalysisResult,
  setIsAnalyzing,
  activePageStrokes,
  showDebug,
  setShowDebug
}: AiFeedbackPanelProps) => {
  return (
    <aside className="ai-panel">
      {/* パネルヘッダー */}
      <div className="ai-panel-header">
        <span className="text-xs font-bold uppercase tracking-wider text-[#5c2d91] flex items-center gap-1 select-none">
          <Award size={14} />
          AI プロセス分析
        </span>
        {aiAnalysisResult && (
          <span className="bg-[#efeaf4] text-[#5c2d91] border border-[#d2bfe6] text-[11px] px-2.5 py-0.5 rounded-full font-bold">
            {aiAnalysisResult["思考タイプラベル"]}
          </span>
        )}
      </div>

      {/* パネルコンテンツ */}
      <div className="ai-panel-content">
        {isAnalyzing ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "80px 0", gap: "12px" }}>
            <div style={{ width: "32px", height: "32px", borderRadius: "50%", border: "4px solid #edebe9", borderTopColor: "#5c2d91", animation: "pulse-animation 1s infinite" }}></div>
            <span style={{ fontSize: "12px", color: "#605e5c", fontWeight: 500 }}>
              試行錯誤の跡を解析しています...
            </span>
          </div>
        ) : (
          aiAnalysisResult && (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px", fontSize: "12px", lineHeight: 1.5 }}>
              {/* 総合評価 */}
              <div>
                <h4 className="ai-section-title">
                  <HelpCircle size={12} /> 総合評価
                </h4>
                <div className="ai-card-info">
                  {aiAnalysisResult["総合評価"]}
                </div>
              </div>

              {/* プロセスへの称賛ポイント */}
              <div>
                <h4 className="ai-section-title">
                  <Sparkles size={12} /> プロセスの称賛ポイント
                </h4>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {aiAnalysisResult["プロセスへの称賛ポイント"].map((point, index) => (
                    <div key={index} className="ai-card-success" style={{ display: "flex", alignItems: "start", gap: "8px" }}>
                      <span style={{ color: "#107c41", fontWeight: "bold" }}>✓</span>
                      <span>{point}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 惜しい点（ヒント） */}
              <div>
                <h4 className="ai-section-title">
                  <Lightbulb size={12} /> 次へのヒント
                </h4>
                <div className="ai-card-hint">
                  {aiAnalysisResult["惜しい点（ヒント）"]}
                </div>
              </div>
            </div>
          )
        )}
      </div>

      {/* パネルフッター */}
      <div style={{ padding: "12px", borderTop: "1px solid #edebe9", display: "flex", flexDirection: "column", gap: "8px", backgroundColor: "#faf9f8" }}>
        <button
          onClick={() => setShowDebug(!showDebug)}
          style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "10px", color: "#605e5c", background: "none", border: "none", cursor: "pointer", padding: "4px 0" }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <Code size={11} />
            <span>ストロークデータダンプ</span>
          </span>
          {showDebug ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>

        {showDebug && (
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <div style={{ fontSize: "8px", color: "#f3f2f1", fontFamily: "monospace", lineHeight: 1.2, maxHeight: "80px", overflowY: "auto", backgroundColor: "#323130", padding: "8px", borderRadius: "4px" }}>
              {activePageStrokes.length === 0 ? (
                "// ストロークデータなし"
              ) : (
                JSON.stringify(
                  activePageStrokes.map(s => ({
                    strokeId: s.strokeId,
                    type: s.type,
                    startTime: s.startTime,
                    pointsCount: s.points.length,
                    isErased: s.isErased || false
                  })), 
                  null, 
                  2
                )
              )}
            </div>
          </div>
        )}

        <button
          onClick={() => {
            setAiAnalysisResult(null);
            setIsAnalyzing(false);
          }}
          className="btn"
          style={{ width: "100%", fontWeight: "600", fontSize: "12px" }}
        >
          閉じる
        </button>
      </div>
    </aside>
  );
});
AiFeedbackPanel.displayName = "AiFeedbackPanel";

// ==========================================
// 4. メインコンポーネント (Home)
// ==========================================
export default function Home() {
  // 初期データ構造 (pan, zoom を除外)
  const [sections, setSections] = useState<SectionData[]>([
    {
      id: "sec_quick",
      title: "クイック ノート",
      pages: [
        {
          id: "page_math",
          title: "三角形の面積",
          date: "2026/06/17 水曜日 10:00",
          strokes: [],
          bgImageUrl: null,
          bgImageBase64: null,
          bgImageSize: null,
          bgFileName: null,
          bgImageOffset: { x: 0, y: 0 }
        },
        {
          id: "page_blank",
          title: "無題のページ",
          date: "2026/06/17 水曜日 10:05",
          strokes: [],
          bgImageUrl: null,
          bgImageBase64: null,
          bgImageSize: null,
          bgFileName: null,
          bgImageOffset: { x: 0, y: 0 }
        }
      ]
    }
  ]);

  // アクティブなセクション・ページのID管理
  const [activeSectionId, setActiveSectionId] = useState<string>("sec_quick");
  const [activePageId, setActivePageId] = useState<string>("page_math");

  // アクティブなオブジェクトの参照
  const activeSection = sections.find(s => s.id === activeSectionId) || sections[0];
  const activePage = activeSection.pages.find(p => p.id === activePageId) || activeSection.pages[0];

  // 【最重要】パンとズームは sections から分離し、高頻度な再レンダーからパレットを保護する
  const [pan, setPan] = useState<Pan>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState<number>(1);

  // ページごとのパン・ズーム位置を一時退避しておくマップ
  const pageTransformsRef = useRef<Record<string, { pan: Pan; zoom: number }>>({
    page_math: { pan: { x: 0, y: 0 }, zoom: 1 },
    page_blank: { pan: { x: 0, y: 0 }, zoom: 1 }
  });

  // 描画ツール設定
  const [tool, setTool] = useState<"pen" | "eraser" | "select">("pen");
  const [brushColor, setBrushColor] = useState<string>("#323130");
  const [brushWidth, setBrushWidth] = useState<number>(4);
  const [eraserWidth, setEraserWidth] = useState<number>(30);

  // リボンタブ状態
  const [activeTab, setActiveTab] = useState<string>("draw");

  // タイムラプスのリプレイ用一時ステート
  const [replayedStrokes, setReplayedStrokes] = useState<Stroke[]>([]);
  const [isReplaying, setIsReplaying] = useState(false);
  const [showReplay, setShowReplay] = useState(false);

  // AIフィードバック・デバッグステート
  const [aiAnalysisResult, setAiAnalysisResult] = useState<typeof mockAiFeedback | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showDebug, setShowDebug] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // セクション切り替え処理 (パン・ズーム位置の退避とロード)
  const handleSectionSwitch = useCallback((newSectionId: string) => {
    // 現在のページのパン・ズームを退避
    pageTransformsRef.current[activePageId] = { pan, zoom };

    setActiveSectionId(newSectionId);
    
    const targetSection = sections.find(s => s.id === newSectionId);
    if (targetSection && targetSection.pages.length > 0) {
      const firstPageId = targetSection.pages[0].id;
      setActivePageId(firstPageId);
      
      const savedTransform = pageTransformsRef.current[firstPageId] || { pan: { x: 0, y: 0 }, zoom: 1 };
      setPan(savedTransform.pan);
      setZoom(savedTransform.zoom);
    }
    setAiAnalysisResult(null);
  }, [activePageId, pan, zoom, sections]);

  // ページ切り替え処理 (パン・ズーム位置の退避とロード)
  const handlePageSwitch = useCallback((newPageId: string) => {
    // 現在のページのパン・ズームを退避
    pageTransformsRef.current[activePageId] = { pan, zoom };

    setActivePageId(newPageId);

    const savedTransform = pageTransformsRef.current[newPageId] || { pan: { x: 0, y: 0 }, zoom: 1 };
    setPan(savedTransform.pan);
    setZoom(savedTransform.zoom);
    setAiAnalysisResult(null);
  }, [activePageId, pan, zoom]);

  // アクティブページへの手書きストローク更新
  const setStrokesForActivePage = useCallback((update: React.SetStateAction<Stroke[]>) => {
    setSections(prevSections => 
      prevSections.map(s => {
        if (s.id !== activeSectionId) return s;
        return {
          ...s,
          pages: s.pages.map(p => {
            if (p.id !== activePageId) return p;
            const nextStrokes = typeof update === "function" ? update(p.strokes) : update;
            return { ...p, strokes: nextStrokes };
          })
        };
      })
    );
  }, [activeSectionId, activePageId]);

  const setBgImageOffsetForActivePage = useCallback((offset: { x: number; y: number }) => {
    setSections(prevSections => 
      prevSections.map(s => {
        if (s.id !== activeSectionId) return s;
        return {
          ...s,
          pages: s.pages.map(p => {
            if (p.id !== activePageId) return p;
            return { ...p, bgImageOffset: offset };
          })
        };
      })
    );
  }, [activeSectionId, activePageId]);

  // トランスフォーム（パン・ズーム）リセット
  const handleResetTransform = useCallback(() => {
    setPan({ x: 0, y: 0 });
    setZoom(1);
  }, []);

  // キャンバス全消去
  const handleClear = useCallback(() => {
    if (window.confirm("このページの手書き内容をすべて消去しますか？")) {
      setStrokesForActivePage([]);
      setReplayedStrokes([]);
      setIsReplaying(false);
      setAiAnalysisResult(null);
    }
  }, [setStrokesForActivePage]);

  // 白紙ページモードへ切り替え
  const handleSetBlank = useCallback(() => {
    setSections(prevSections => 
      prevSections.map(s => {
        if (s.id !== activeSectionId) return s;
        return {
          ...s,
          pages: s.pages.map(p => {
            if (p.id !== activePageId) return p;
            return {
              ...p,
              bgImageUrl: null,
              bgImageBase64: null,
              bgImageSize: null,
              bgFileName: null,
              bgImageOffset: { x: 0, y: 0 }
            };
          })
        };
      })
    );
    setPan({ x: 0, y: 0 });
    setZoom(1);
    setAiAnalysisResult(null);
  }, [activeSectionId, activePageId]);

  // 画像ファイルアップロード処理
  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      
      const img = new Image();
      img.src = base64;
      img.onload = () => {
        setSections(prevSections => 
          prevSections.map(s => {
            if (s.id !== activeSectionId) return s;
            return {
              ...s,
              pages: s.pages.map(p => {
                if (p.id !== activePageId) return p;
                return {
                  ...p,
                  bgImageUrl: base64,
                  bgImageBase64: base64,
                  bgImageSize: { width: img.width, height: img.height },
                  bgFileName: file.name,
                  title: file.name.split(".")[0],
                  bgImageOffset: { x: 0, y: 0 }
                };
              })
            };
          })
        );
        setPan({ x: 0, y: 0 });
        setZoom(1);
        setAiAnalysisResult(null);
      };
    };
    reader.readAsDataURL(file);
  }, [activeSectionId, activePageId]);

  // AI分析送信
  const handleAnalyze = useCallback(async () => {
    if (activePage.strokes.length === 0) {
      alert("分析する手書きプロセスがありません。キャンバスに記述してください。");
      return;
    }
    
    setIsAnalyzing(true);
    setAiAnalysisResult(null);
    
    try {
      const response = await fetch("http://localhost:8000/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          questionId: activePage.bgFileName ? "custom_upload" : "blank_page",
          strokes: activePage.strokes.map(s => ({
            strokeId: s.strokeId,
            type: s.type,
            startTime: s.startTime,
            endTime: s.endTime,
            points: s.points.map(p => ({ x: p.x, y: p.y, p: p.p, t: p.t })),
            color: s.color,
            width: s.width,
            isErased: s.isErased || false,
            erasedAt: s.erasedAt,
            targetStrokeIds: s.targetStrokeIds
          })),
          backgroundImage: activePage.bgImageBase64,
          imageWidth: activePage.bgImageSize?.width,
          imageHeight: activePage.bgImageSize?.height
        })
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const result = await response.json();
      setAiAnalysisResult(result);
    } catch (error) {
      console.warn("FastAPI connection failed. Using mock fallback.", error);
      
      await new Promise(resolve => setTimeout(resolve, 1500));
      setAiAnalysisResult({
        ...mockAiFeedback,
        "総合評価": `${mockAiFeedback["総合評価"]} (※ローカルバックエンドAPI接続エラーのため、デモ用モックデータを表示しています。開発サーバー http://localhost:8000 を起動し、必要であれば.envにAPIキーを設定してください)`
      });
    } finally {
      setIsAnalyzing(false);
    }
  }, [activePage]);

  // セクションの新規追加
  const handleAddSection = useCallback(() => {
    const title = prompt("新しいセクションの名前を入力してください:", "新規セクション");
    if (!title) return;
    
    const newId = `sec_${Date.now()}`;
    const newPageId = `page_${Date.now()}`;
    const newSection: SectionData = {
      id: newId,
      title,
      pages: [
        {
          id: newPageId,
          title: "",
          date: new Date().toLocaleString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", weekday: "long", hour: "2-digit", minute: "2-digit" }),
          strokes: [],
          bgImageUrl: null,
          bgImageBase64: null,
          bgImageSize: null,
          bgFileName: null,
          bgImageOffset: { x: 0, y: 0 }
        }
      ]
    };
    
    // 現在のトランスフォームを退避
    pageTransformsRef.current[activePageId] = { pan, zoom };

    setSections(prev => [...prev, newSection]);
    setActiveSectionId(newId);
    setActivePageId(newPageId);
    
    // 新しいページのトランスフォームを初期化
    pageTransformsRef.current[newPageId] = { pan: { x: 0, y: 0 }, zoom: 1 };
    setPan({ x: 0, y: 0 });
    setZoom(1);
    setAiAnalysisResult(null);
  }, [activePageId, pan, zoom]);

  // ページの新規追加
  const handleAddPage = useCallback(() => {
    const newPageId = `page_${Date.now()}`;
    const newPage: PageData = {
      id: newPageId,
      title: "",
      date: new Date().toLocaleString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", weekday: "long", hour: "2-digit", minute: "2-digit" }),
      strokes: [],
      bgImageUrl: null,
      bgImageBase64: null,
      bgImageSize: null,
      bgFileName: null,
      bgImageOffset: { x: 0, y: 0 }
    };

    // 現在のトランスフォームを退避
    pageTransformsRef.current[activePageId] = { pan, zoom };

    setSections(prev => 
      prev.map(s => {
        if (s.id !== activeSectionId) return s;
        return {
          ...s,
          pages: [...s.pages, newPage]
        };
      })
    );
    setActivePageId(newPageId);
    
    // 新しいページのトランスフォームを初期化
    pageTransformsRef.current[newPageId] = { pan: { x: 0, y: 0 }, zoom: 1 };
    setPan({ x: 0, y: 0 });
    setZoom(1);
    setAiAnalysisResult(null);
  }, [activeSectionId, activePageId, pan, zoom]);

  // ページのタイトル変更
  const handleRenamePage = (newTitle: string) => {
    setSections(prev => 
      prev.map(s => {
        if (s.id !== activeSectionId) return s;
        return {
          ...s,
          pages: s.pages.map(p => {
            if (p.id !== activePageId) return p;
            return { ...p, title: newTitle };
          })
        };
      })
    );
  };

  return (
    <main className="onenote-app">
      
      {/* 1. リボンヘッダー (メモ化により、パンや無駄なステート更新による再レンダーを100%防止) */}
      <RibbonHeader
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        tool={tool}
        setTool={setTool}
        brushColor={brushColor}
        setBrushColor={setBrushColor}
        brushWidth={brushWidth}
        setBrushWidth={setBrushWidth}
        eraserWidth={eraserWidth}
        setEraserWidth={setEraserWidth}
        zoom={zoom}
        handleResetTransform={handleResetTransform}
        handleClear={handleClear}
        showReplay={showReplay}
        setShowReplay={setShowReplay}
        isReplaying={isReplaying}
        setIsReplaying={setIsReplaying}
        setReplayedStrokes={setReplayedStrokes}
        activePageStrokes={activePage.strokes}
        handleSetBlank={handleSetBlank}
        bgFileName={activePage.bgFileName}
        bgImageUrl={activePage.bgImageUrl}
        fileInputRef={fileInputRef}
        handleFileUpload={handleFileUpload}
        handleAnalyze={handleAnalyze}
        isAnalyzing={isAnalyzing}
      />

      {/* 2. OneNote 2列サイドバー & キャンバス領域 */}
      <div className="onenote-container">
        
        {/* ナビゲーションサイドバー (メモ化によりパン・ズーム操作中の再レンダーを完全バイパス) */}
        <Sidebar
          sections={sections}
          activeSectionId={activeSectionId}
          activePageId={activePageId}
          handleSectionSwitch={handleSectionSwitch}
          handlePageSwitch={handlePageSwitch}
          handleAddSection={handleAddSection}
          handleAddPage={handleAddPage}
        />

        {/* メインのキャンバス領域 */}
        <div className="canvas-main-area">
          
          {/* OneNote風キャンバス上のタイトル・日付入力部 */}
          <div className="canvas-header">
            <input
              type="text"
              value={activePage.title}
              onChange={(e) => handleRenamePage(e.target.value)}
              className="canvas-title-input"
              placeholder="無題のページ"
            />
            <div className="canvas-date-label">
              {activePage.date}
            </div>
          </div>

          {/* キャンバスコンテナ */}
          <div className="canvas-body">
            <Canvas
              strokes={isReplaying ? replayedStrokes : activePage.strokes}
              setStrokes={setStrokesForActivePage}
              tool={tool}
              brushColor={brushColor}
              brushWidth={brushWidth}
              eraserWidth={eraserWidth}
              bgImageUrl={activePage.bgImageUrl}
              bgImageOffset={activePage.bgImageOffset || { x: 0, y: 0 }}
              setBgImageOffset={setBgImageOffsetForActivePage}
              isReplaying={isReplaying}
              pan={pan}
              setPan={setPan}
              zoom={zoom}
              setZoom={setZoom}
              resetTransform={handleResetTransform}
            />

            {isReplaying && (
              <div className="replay-active-badge">
                <span className="pulse-dot">
                  <span className="pulse-ping"></span>
                  <span className="pulse-core"></span>
                </span>
                リプレイ再生中...
              </div>
            )}

            {/* キャンバス座標インジケータ (左下) */}
            <div className="hud-indicator">
              <div>ズーム: {(zoom * 100).toFixed(0)}%</div>
              <div>パン: X:{pan.x.toFixed(0)}, Y:{pan.y.toFixed(0)}</div>
              {activePage.bgImageUrl && activePage.bgImageOffset && (
                <div>画像オフセット: X:{activePage.bgImageOffset.x.toFixed(0)}, Y:{activePage.bgImageOffset.y.toFixed(0)}</div>
              )}
              <div className="hud-indicator-guide">
                ※ PC: ホイールでズーム / 右ドラッグで移動<br/>
                ※ iPad: ペンで書く / 指で移動・ピンチ
              </div>
            </div>
          </div>
        </div>

        {/* 右側 AIフィードバックパネル (メモ化) */}
        {(isAnalyzing || aiAnalysisResult) && (
          <AiFeedbackPanel
            isAnalyzing={isAnalyzing}
            aiAnalysisResult={aiAnalysisResult}
            setAiAnalysisResult={setAiAnalysisResult}
            setIsAnalyzing={setIsAnalyzing}
            activePageStrokes={activePage.strokes}
            showDebug={showDebug}
            setShowDebug={setShowDebug}
          />
        )}

      </div>
    </main>
  );
}
