"use client";

import React, { useState, useRef, useCallback } from "react";
import Canvas from "../components/Canvas";
import ReplayPlayer from "../components/ReplayPlayer";
import { Stroke, CanvasImage, CanvasText, AIAnnotation } from "../types/canvas";
import { jsPDF } from "jspdf";
import { 
  PenTool, Eraser, Sparkles, Trash2, Code, ChevronDown, ChevronUp, HelpCircle,
  Lightbulb, Award, Upload, FileText, Maximize2, Plus, Eye, EyeOff, Move,
  Type, Scissors, Download, Bold, Italic, Underline, ImagePlus
} from "lucide-react";
import { generateGhostRender } from "../utils/ghostRenderer";

interface PageData {
  id: string;
  title: string;
  date: string;
  strokes: Stroke[];
  images: CanvasImage[];
  texts: CanvasText[];
  bgFileName: string | null;
  aiAnnotations: AIAnnotation[];
}

interface SectionData {
  id: string;
  title: string;
  pages: PageData[];
}

const mockAiFeedback = {
  "総合評価": "最後まで諦めずに、自分で誤りに気づいて消しゴムで修正を試みながら解き進めたプロセスが素晴らしいです！",
  "プロセスへの称賛ポイント": ["柔軟性。", "粘り強さ。", "本質的な理解のステップ。"],
  "惜しい点（ヒント）": "計算の最後のステップで少しのズレが生じている可能性があります。",
  "思考タイプラベル": "粘り強い探索者 🔍"
};

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
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleExportPNG: () => void;
  handleExportPDF: () => void;
  handleAnalyze: () => void;
  isAnalyzing: boolean;
}

const RibbonHeader = React.memo(({
  activeTab, setActiveTab, tool, setTool, eraserMode, setEraserMode,
  brushColor, setBrushColor, brushWidth, setBrushWidth, eraserWidth, setEraserWidth,
  textStyle, setTextStyle, zoom, handleResetTransform, handleClear,
  showReplay, setShowReplay, isReplaying, setIsReplaying, setReplayedStrokes,
  activePageStrokes, handleSetBlank, fileInputRef, handleFileUpload,
  handleExportPNG, handleExportPDF, handleAnalyze, isAnalyzing
}: RibbonHeaderProps) => {
  return (
    <header className="ribbon-header">
      <div className="onenote-header-top">
        <div className="onenote-header-title-area">
          <h1 className="onenote-header-title">HomeruAI Note</h1>
          <span className="onenote-header-badge">OneNote Mode</span>
        </div>
        <div>
          <button onClick={handleAnalyze} disabled={activePageStrokes.length === 0 || isAnalyzing || isReplaying} className="btn btn-accent" style={{ backgroundColor: "#ffffff", color: "#5c2d91", borderColor: "#ffffff" }}>
            <Sparkles size={13} className={isAnalyzing ? "animate-spin" : ""} />
            {isAnalyzing ? "分析中..." : "思考をAI分析"}
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
                  <ReplayPlayer strokes={activePageStrokes} isReplaying={isReplaying} setIsReplaying={setIsReplaying} setReplayedStrokes={setReplayedStrokes} />
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
              <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleFileUpload} style={{ display: "none" }} />
              
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

const Sidebar = React.memo(({ sections, activeSectionId, activePageId, handleSectionSwitch, handlePageSwitch, handleAddSection, handleAddPage }: any) => {
  const activeSection = sections.find((s:any) => s.id === activeSectionId) || sections[0];
  return (
    <>
      <aside className="section-sidebar">
        <button onClick={handleAddSection} className="sidebar-add-btn"><Plus size={14} /><span>セクション追加</span></button>
        <ul className="sidebar-list">
          {sections.map((s:any) => (
            <li key={s.id} onClick={() => handleSectionSwitch(s.id)} className={`section-item ${s.id === activeSectionId ? "active" : ""}`}><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</span></li>
          ))}
        </ul>
      </aside>
      <aside className="page-sidebar">
        <button onClick={handleAddPage} className="sidebar-add-btn"><Plus size={14} /><span>ページ追加</span></button>
        <ul className="sidebar-list">
          {activeSection.pages.map((p:any) => (
            <li key={p.id} onClick={() => handlePageSwitch(p.id)} className={`page-item ${p.id === activePageId ? "active" : ""}`}><span className="page-item-title">{p.title || "無題のページ"}</span><span className="page-item-date">{p.date.split(" ")[0]}</span></li>
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
        { id: "page_math", title: "数学ノート", date: "2026/06/17 水曜日 10:00", strokes: [], images: [], texts: [], bgFileName: null, aiAnnotations: [] }
      ]
    }
  ]);

  const [activeSectionId, setActiveSectionId] = useState<string>("sec_quick");
  const [activePageId, setActivePageId] = useState<string>("page_math");

  const activeSection = sections.find(s => s.id === activeSectionId) || sections[0];
  const activePage = activeSection.pages.find(p => p.id === activePageId) || activeSection.pages[0];

  const pageTransformsRef = useRef<Record<string, { pan: { x: number; y: number }; zoom: number }>>({});
  const [displayZoom, setDisplayZoom] = useState<number>(1);

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

  const [aiAnalysisResult, setAiAnalysisResult] = useState<any>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleSectionSwitch = useCallback((newSectionId: string) => {
    setActiveSectionId(newSectionId);
    const targetSection = sections.find(s => s.id === newSectionId);
    if (targetSection && targetSection.pages.length > 0) {
      setActivePageId(targetSection.pages[0].id);
      setDisplayZoom(pageTransformsRef.current[targetSection.pages[0].id]?.zoom || 1);
    }
  }, [sections]);

  const handlePageSwitch = useCallback((newPageId: string) => {
    setActivePageId(newPageId);
    setDisplayZoom(pageTransformsRef.current[newPageId]?.zoom || 1);
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

  const handleResetTransform = useCallback(() => {
    pageTransformsRef.current[activePageId] = { pan: { x: 0, y: 0 }, zoom: 1 };
    setDisplayZoom(1); setActivePageId(prev => prev); setSections(prev => [...prev]);
  }, [activePageId]);

  const handleClear = useCallback(() => {
    if (window.confirm("このページの内容をすべて消去しますか？")) {
      updateActivePage(p => ({ ...p, strokes: [], images: [], texts: [], aiAnnotations: [] }));
      setReplayedStrokes([]); setIsReplaying(false);
    }
  }, [updateActivePage]);

  const handleSetBlank = useCallback(() => {
    updateActivePage(p => ({ ...p, images: [], bgFileName: null }));
    handleResetTransform();
  }, [updateActivePage, handleResetTransform]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file, index) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const base64 = event.target?.result as string;
        const img = new Image();
        img.src = base64;
        img.onload = () => {
          const newImage: CanvasImage = {
            id: `img_${Date.now()}_${index}`, url: base64,
            x: 50 + index * 20, y: 50 + index * 20, width: img.width, height: img.height, name: file.name
          };
          updateActivePage(p => ({ ...p, images: [...p.images, newImage] }));
        };
      };
      reader.readAsDataURL(file);
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [updateActivePage]);

  const handleExportPNG = useCallback(() => {
    const canvas = document.getElementById("homeruai-canvas") as HTMLCanvasElement;
    if (!canvas) return;
    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `${activePage.title || "export"}.png`;
    a.click();
  }, [activePage.title]);

  const handleExportPDF = useCallback(() => {
    const canvas = document.getElementById("homeruai-canvas") as HTMLCanvasElement;
    if (!canvas) return;
    const imgData = canvas.toDataURL("image/jpeg", 1.0);
    const pdf = new jsPDF({
      orientation: canvas.width > canvas.height ? "landscape" : "portrait",
      unit: "px",
      format: [canvas.width, canvas.height]
    });
    pdf.addImage(imgData, "JPEG", 0, 0, canvas.width, canvas.height);
    pdf.save(`${activePage.title || "export"}.pdf`);
  }, [activePage.title]);

  const handleAnalyze = useCallback(async () => {
    if (activePage.strokes.length === 0) {
      alert("分析する手書きプロセスがありません。キャンバスに記述してください。");
      return;
    }
    
    setIsAnalyzing(true);
    setAiAnalysisResult(null);
    // 前回のアノテーションをクリア
    updateActivePage(p => ({ ...p, aiAnnotations: [] }));
    
    try {
      // 基準となる画像（最初の画像）を取得
      const refImage = activePage.images.length > 0 ? activePage.images[0] : null;
      
      // 画像基準のGhost Renderを生成
      const ghostResult = await generateGhostRender(activePage.strokes, refImage);

      const response = await fetch("http://localhost:8000/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          questionId: activePage.title || "custom_upload",
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
          image: ghostResult.image,
          backgroundImage: refImage?.url || null,
          imageWidth: refImage?.width,
          imageHeight: refImage?.height,
          imageX: refImage?.x || 0, // これを追加！ @0621
          imageY: refImage?.y || 0  // これを追加！
        })
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const result = await response.json();
      setAiAnalysisResult(result);

      // canvas_marks を画像相対のAIAnnotationとして保存
      if (result.canvas_marks && Array.isArray(result.canvas_marks) && refImage) {
         const annotations: AIAnnotation[] = result.canvas_marks.map((mark: any, i: number) => ({
           id: `ai_ann_${Date.now()}_${i}`,
           imageId: refImage.id,
           type: mark.type === "circle" ? "circle" : mark.type === "underline" ? "underline" : mark.type === "text" ? "text" : "underline",
           box_2d: mark.box_2d as [number, number, number, number],
           comment: mark.comment || undefined,
           color: mark.type === "circle" ? "#107c41" : "#e81123",
         }));
         updateActivePage(p => ({ ...p, aiAnnotations: annotations }));
      }
    } catch (error) {
      console.warn("FastAPI connection failed. Using mock fallback.", error);
      await new Promise(resolve => setTimeout(resolve, 1500));
      setAiAnalysisResult({
        overall_comment: `${mockAiFeedback["総合評価"]} (※API接続エラーのためモックデータを表示しています)`,
        praise_points: mockAiFeedback["プロセスへの称賛ポイント"],
        hint: mockAiFeedback["惜しい点（ヒント）"],
        thinker_type: mockAiFeedback["思考タイプラベル"],
        solving_approach: "",
        step_analysis: [],
        strategy_evaluation: ""
      });
    } finally {
      setIsAnalyzing(false);
    }
  }, [activePage, updateActivePage]);

  const handleAddSection = useCallback(() => {
    const title = prompt("新しいセクションの名前を入力:", "新規セクション");
    if (!title) return;
    const newId = `sec_${Date.now()}`; const newPageId = `page_${Date.now()}`;
    setSections(prev => [...prev, {
      id: newId, title, pages: [{ id: newPageId, title: "", date: new Date().toLocaleString(), strokes: [], images: [], texts: [], bgFileName: null, aiAnnotations: [] }]
    }]);
    setActiveSectionId(newId); setActivePageId(newPageId);
  }, []);

  const handleAddPage = useCallback(() => {
    const newPageId = `page_${Date.now()}`;
    setSections(prev => prev.map(s => s.id !== activeSectionId ? s : {
      ...s, pages: [...s.pages, { id: newPageId, title: "", date: new Date().toLocaleString(), strokes: [], images: [], texts: [], bgFileName: null, aiAnnotations: [] }]
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
        textStyle={textStyle} setTextStyle={setTextStyle} zoom={displayZoom}
        handleResetTransform={handleResetTransform} handleClear={handleClear}
        showReplay={showReplay} setShowReplay={setShowReplay} isReplaying={isReplaying} setIsReplaying={setIsReplaying}
        setReplayedStrokes={setReplayedStrokes} activePageStrokes={activePage.strokes}
        handleSetBlank={handleSetBlank} fileInputRef={fileInputRef} handleFileUpload={handleFileUpload}
        handleExportPNG={handleExportPNG} handleExportPDF={handleExportPDF} handleAnalyze={handleAnalyze} isAnalyzing={isAnalyzing}
      />
      <div className="onenote-container">
        <Sidebar sections={sections} activeSectionId={activeSectionId} activePageId={activePageId} handleSectionSwitch={handleSectionSwitch} handlePageSwitch={handlePageSwitch} handleAddSection={handleAddSection} handleAddPage={handleAddPage} />
        <div className="canvas-main-area">
          <div className="canvas-header">
            <input type="text" value={activePage.title} onChange={e => updateActivePage(p => ({ ...p, title: e.target.value }))} className="canvas-title-input" placeholder="無題のページ" />
            <div className="canvas-date-label">{activePage.date}</div>
          </div>
          <div className="canvas-body" style={{ display: "flex", flexDirection: "row", width: "100%", height: "100%", overflow: "hidden" }}>
            <div style={{ flex: 1, position: "relative" }}>
              <Canvas
                key={activePageId}
                strokes={isReplaying ? replayedStrokes : activePage.strokes} setStrokes={setStrokesForActivePage}
                images={activePage.images} setImages={setImagesForActivePage}
                texts={activePage.texts} setTexts={setTextsForActivePage}
                aiAnnotations={activePage.aiAnnotations}
                tool={tool} eraserMode={eraserMode} brushColor={brushColor} brushWidth={brushWidth} eraserWidth={eraserWidth} textStyle={textStyle}
                isReplaying={isReplaying} initialPan={pageTransformsRef.current[activePageId]?.pan || { x: 0, y: 0 }} initialZoom={pageTransformsRef.current[activePageId]?.zoom || 1}
                onTransformChange={(newPan, newZoom) => { pageTransformsRef.current[activePageId] = { pan: newPan, zoom: newZoom }; setDisplayZoom(newZoom); }}
              />
            </div>
            {aiAnalysisResult && (
              <div style={{ width: "340px", borderLeft: "1px solid #e1dfdd", backgroundColor: "#fdfdfd", padding: "20px", overflowY: "auto", boxShadow: "-4px 0 12px rgba(0,0,0,0.05)", zIndex: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
                  <h2 style={{ fontSize: "16px", color: "#5c2d91", fontWeight: "bold", margin: 0, display: "flex", alignItems: "center", gap: "6px" }}><Sparkles size={18}/> AI フィードバック</h2>
                  <button onClick={() => setAiAnalysisResult(null)} style={{ border: "none", background: "none", cursor: "pointer", fontSize: "20px", color: "#605e5c" }}>&times;</button>
                </div>
                
                <div style={{ marginBottom: "20px", padding: "16px", backgroundColor: "#fff4ce", borderRadius: "12px", border: "1px solid #fde7a9", display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <div style={{ fontSize: "12px", color: "#795f0c", fontWeight: "bold", marginBottom: "8px" }}>思考タイプ</div>
                  <div style={{ fontSize: "18px", color: "#a80000", fontWeight: "bold", textAlign: "center", display: "flex", alignItems: "center", gap: "8px" }}><Award size={20}/>{aiAnalysisResult.thinker_type || aiAnalysisResult["思考タイプラベル"]}</div>
                </div>

                <div style={{ marginBottom: "20px" }}>
                  <div style={{ fontSize: "14px", fontWeight: "bold", color: "#323130", marginBottom: "8px" }}>全体評価</div>
                  <p style={{ fontSize: "14px", color: "#605e5c", lineHeight: "1.6", margin: 0 }}>{aiAnalysisResult.overall_comment || aiAnalysisResult["総合評価"]}</p>
                </div>

                {aiAnalysisResult.solving_approach && (
                  <div style={{ marginBottom: "20px", padding: "14px", backgroundColor: "#f0f6ff", borderRadius: "10px", border: "1px solid #d0e2ff" }}>
                    <div style={{ fontSize: "13px", fontWeight: "bold", color: "#0043ce", marginBottom: "6px", display: "flex", alignItems: "center", gap: "5px" }}>
                      <Code size={14} /> 解法アプローチ
                    </div>
                    <p style={{ fontSize: "13px", color: "#4a4a4a", lineHeight: "1.6", margin: 0 }}>{aiAnalysisResult.solving_approach}</p>
                  </div>
                )}

                {aiAnalysisResult.step_analysis && aiAnalysisResult.step_analysis.length > 0 && (
                  <div style={{ marginBottom: "20px" }}>
                    <div style={{ fontSize: "14px", fontWeight: "bold", color: "#323130", marginBottom: "10px" }}>📝 手順分析</div>
                    {aiAnalysisResult.step_analysis.map((step: any, i: number) => (
                      <div key={i} style={{ marginBottom: "10px", padding: "10px 12px", backgroundColor: step.is_correct ? "#f0fdf4" : "#fff5f5", borderRadius: "8px", border: `1px solid ${step.is_correct ? "#bbf7d0" : "#fecaca"}` }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                          <span style={{ fontSize: "14px" }}>{step.is_correct ? "✅" : "⚠️"}</span>
                          <span style={{ fontSize: "12px", fontWeight: "bold", color: "#323130" }}>手順 {step.step_number}</span>
                        </div>
                        <div style={{ fontSize: "12px", color: "#4a4a4a", lineHeight: "1.5", marginBottom: "3px" }}>{step.description}</div>
                        <div style={{ fontSize: "11px", color: "#6b7280", lineHeight: "1.4", fontStyle: "italic" }}>{step.observation}</div>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ marginBottom: "20px" }}>
                  <div style={{ fontSize: "14px", fontWeight: "bold", color: "#323130", marginBottom: "8px" }}>素晴らしいポイント</div>
                  <ul style={{ paddingLeft: "24px", margin: 0 }}>
                    {(aiAnalysisResult.praise_points || aiAnalysisResult["プロセスへの称賛ポイント"] || []).map((pt: string, i: number) => (
                      <li key={i} style={{ fontSize: "14px", color: "#605e5c", marginBottom: "8px", lineHeight: "1.5" }}>{pt}</li>
                    ))}
                  </ul>
                </div>

                {aiAnalysisResult.strategy_evaluation && (
                  <div style={{ marginBottom: "20px", padding: "14px", backgroundColor: "#fdf4ff", borderRadius: "10px", border: "1px solid #e9d5ff" }}>
                    <div style={{ fontSize: "13px", fontWeight: "bold", color: "#7c3aed", marginBottom: "6px" }}>🎯 方針評価</div>
                    <p style={{ fontSize: "13px", color: "#4a4a4a", lineHeight: "1.6", margin: 0 }}>{aiAnalysisResult.strategy_evaluation}</p>
                  </div>
                )}

                <div style={{ marginTop: "24px", padding: "16px", backgroundColor: "#e1dfdd", borderRadius: "12px" }}>
                  <div style={{ fontSize: "14px", fontWeight: "bold", color: "#323130", marginBottom: "8px", display: "flex", alignItems: "center", gap: "6px" }}><Lightbulb size={16} color="#0078d4" /> ヒント・アドバイス</div>
                  <p style={{ fontSize: "14px", color: "#605e5c", lineHeight: "1.6", margin: 0 }}>{aiAnalysisResult.hint || aiAnalysisResult["惜しい点_ヒント"] || aiAnalysisResult["惜しい点（ヒント）"]}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
