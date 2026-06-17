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

// ページおよびセクションのデータ構造
interface PageData {
  id: string;
  title: string;
  date: string;
  strokes: Stroke[];
  bgImageUrl: string | null;
  bgImageBase64: string | null;
  bgImageSize: { width: number; height: number } | null;
  bgFileName: string | null;
  bgImageOffset: { x: number; y: number }; // 画像のワールド座標上の移動オフセット
  pan: Pan;
  zoom: number;
}

interface SectionData {
  id: string;
  title: string;
  pages: PageData[];
}

// AIフィードバックのモックデータ
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

export default function Home() {
  // 初期データ構造
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
          bgImageOffset: { x: 0, y: 0 },
          pan: { x: 0, y: 0 },
          zoom: 1,
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
          bgImageOffset: { x: 0, y: 0 },
          pan: { x: 0, y: 0 },
          zoom: 1,
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

  // 描画ツール設定 (select 選択ツールを追加)
  const [tool, setTool] = useState<"pen" | "eraser" | "select">("pen");
  const [brushColor, setBrushColor] = useState<string>("#323130"); // デフォルト: 濃いグレー
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

  // アクティブページへのステート更新のヘルパー
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

  const setPanForActivePage = useCallback((update: React.SetStateAction<Pan>) => {
    setSections(prevSections => 
      prevSections.map(s => {
        if (s.id !== activeSectionId) return s;
        return {
          ...s,
          pages: s.pages.map(p => {
            if (p.id !== activePageId) return p;
            const nextPan = typeof update === "function" ? update(p.pan) : update;
            return { ...p, pan: nextPan };
          })
        };
      })
    );
  }, [activeSectionId, activePageId]);

  const setZoomForActivePage = useCallback((update: React.SetStateAction<number>) => {
    setSections(prevSections => 
      prevSections.map(s => {
        if (s.id !== activeSectionId) return s;
        return {
          ...s,
          pages: s.pages.map(p => {
            if (p.id !== activePageId) return p;
            const nextZoom = typeof update === "function" ? update(p.zoom) : update;
            return { ...p, zoom: nextZoom };
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
  const handleResetTransform = () => {
    setPanForActivePage({ x: 0, y: 0 });
    setZoomForActivePage(1);
  };

  // キャンバス全消去
  const handleClear = () => {
    if (window.confirm("このページの手書き内容をすべて消去しますか？")) {
      setStrokesForActivePage([]);
      setReplayedStrokes([]);
      setIsReplaying(false);
      setAiAnalysisResult(null);
    }
  };

  // 白紙ページモードへ切り替え
  const handleSetBlank = () => {
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
              bgImageOffset: { x: 0, y: 0 },
              pan: { x: 0, y: 0 },
              zoom: 1
            };
          })
        };
      })
    );
    setAiAnalysisResult(null);
  };

  // 画像ファイルアップロード処理
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
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
                  title: file.name.split(".")[0], // ファイル名をタイトルに反映
                  bgImageOffset: { x: 0, y: 0 },
                  pan: { x: 0, y: 0 },
                  zoom: 1
                };
              })
            };
          })
        );
        setAiAnalysisResult(null);
      };
    };
    reader.readAsDataURL(file);
  };

  // AI分析送信
  const handleAnalyze = async () => {
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
      
      // 接続エラー時はデモフォールバック
      await new Promise(resolve => setTimeout(resolve, 1500));
      setAiAnalysisResult({
        ...mockAiFeedback,
        "総合評価": `${mockAiFeedback["総合評価"]} (※ローカルバックエンドAPI接続エラーのため、デモ用モックデータを表示しています。開発サーバー http://localhost:8000 を起動し、必要であれば.envにAPIキーを設定してください)`
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  // セクションの新規追加
  const handleAddSection = () => {
    const title = prompt("新しいセクションの名前を入力してください:", "新規セクション");
    if (!title) return;
    
    const newId = `sec_${Date.now()}`;
    const newSection: SectionData = {
      id: newId,
      title,
      pages: [
        {
          id: `page_${Date.now()}`,
          title: "", // 空文字で初期化しプレースホルダーを表示
          date: new Date().toLocaleString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", weekday: "long", hour: "2-digit", minute: "2-digit" }),
          strokes: [],
          bgImageUrl: null,
          bgImageBase64: null,
          bgImageSize: null,
          bgFileName: null,
          bgImageOffset: { x: 0, y: 0 },
          pan: { x: 0, y: 0 },
          zoom: 1
        }
      ]
    };
    
    setSections(prev => [...prev, newSection]);
    setActiveSectionId(newId);
    setActivePageId(newSection.pages[0].id);
    setAiAnalysisResult(null);
  };

  // ページの新規追加
  const handleAddPage = () => {
    const newPage: PageData = {
      id: `page_${Date.now()}`,
      title: "", // 空文字で初期化
      date: new Date().toLocaleString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", weekday: "long", hour: "2-digit", minute: "2-digit" }),
      strokes: [],
      bgImageUrl: null,
      bgImageBase64: null,
      bgImageSize: null,
      bgFileName: null,
      bgImageOffset: { x: 0, y: 0 },
      pan: { x: 0, y: 0 },
      zoom: 1
    };

    setSections(prev => 
      prev.map(s => {
        if (s.id !== activeSectionId) return s;
        return {
          ...s,
          pages: [...s.pages, newPage]
        };
      })
    );
    setActivePageId(newPage.id);
    setAiAnalysisResult(null);
  };

  // ページのタイトル変更 (すべて消しても空文字で保持し、確定やフォールバックで "無題のページ" にする)
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
      
      {/* 1. リボンヘッダー */}
      <header className="ribbon-header">
        
        {/* 最上段: アプリ名とAI分析ボタン */}
        <div className="onenote-header-top">
          <div className="onenote-header-title-area">
            <h1 className="onenote-header-title">
              HomeruAI Note
            </h1>
            <span className="onenote-header-badge">
              OneNote Mode
            </span>
          </div>
          
          <div>
            <button
              onClick={handleAnalyze}
              disabled={activePage.strokes.length === 0 || isAnalyzing || isReplaying}
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

        {/* リボン内容（タブごとに表示変更、描画タブがデフォルト） */}
        <div className="ribbon-content">
          {activeTab === "draw" ? (
            <>
              {/* ツール切替 (ペン・消しゴム・選択ツール) */}
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
                  title="Select / Move Image Tool"
                >
                  <Move size={14} />
                  <span style={{ fontSize: "8px" }}>選択 (画像移動)</span>
                </button>
              </div>

              {/* カラーパレット */}
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

              {/* 太さ調整 */}
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

              {/* キャンバス基本操作 */}
              <div className="ribbon-group">
                <button
                  onClick={handleResetTransform}
                  className="btn"
                  style={{ flexDirection: "column", height: "42px", gap: "2px", border: "none" }}
                  title="Reset Zoom"
                >
                  <Maximize2 size={14} />
                  <span style={{ fontSize: "8px" }}>等倍リセット ({(activePage.zoom * 100).toFixed(0)}%)</span>
                </button>
                <button
                  onClick={handleClear}
                  className="btn"
                  style={{ flexDirection: "column", height: "42px", gap: "2px", border: "none" }}
                  title="Clear Canvas"
                >
                  <Trash2 size={14} className="text-[#a80000]" style={{ color: "#a80000" }} />
                  <span style={{ fontSize: "8px", color: "#a80000" }}>全消去</span>
                </button>
              </div>

              {/* タイムラプス・リプレイ */}
              <div className="ribbon-group" style={{ borderRight: "none" }}>
                <button
                  onClick={() => {
                    setShowReplay(!showReplay);
                    setReplayedStrokes([]);
                  }}
                  disabled={activePage.strokes.length === 0}
                  className={`btn ${showReplay ? "btn-active" : ""}`}
                  style={{ flexDirection: "column", height: "42px", gap: "2px", border: "none" }}
                >
                  {showReplay ? <EyeOff size={14} /> : <Eye size={14} />}
                  <span style={{ fontSize: "8px" }}>タイムラプス</span>
                </button>

                {showReplay && activePage.strokes.length > 0 && (
                  <div style={{ marginLeft: "8px" }}>
                    <ReplayPlayer
                      strokes={activePage.strokes}
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
              {/* 白紙・画像の挿入 */}
              <div className="ribbon-group" style={{ borderRight: "none" }}>
                <button
                  onClick={handleSetBlank}
                  className={`btn ${!activePage.bgImageUrl ? "btn-active" : ""}`}
                  style={{ flexDirection: "column", height: "42px", gap: "2px", border: "none" }}
                >
                  <FileText size={14} />
                  <span style={{ fontSize: "8px" }}>白紙ページ</span>
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className={`btn ${activePage.bgImageUrl ? "btn-active" : ""}`}
                  style={{ flexDirection: "column", height: "42px", gap: "2px", border: "none" }}
                >
                  <Upload size={14} />
                  <span style={{ fontSize: "8px", maxWidth: "80px", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {activePage.bgFileName || "画像を挿入"}
                  </span>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileUpload}
                  className="hidden"
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

      {/* 2. OneNote 2列サイドバー & キャンバス領域 */}
      <div className="onenote-container">
        
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
                onClick={() => {
                  setActiveSectionId(s.id);
                  if (s.pages.length > 0) {
                    setActivePageId(s.pages[0].id);
                  }
                  setAiAnalysisResult(null);
                }}
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
                onClick={() => {
                  setActivePageId(p.id);
                  setAiAnalysisResult(null);
                }}
                className={`page-item ${p.id === activePageId ? "active" : ""}`}
              >
                <span className="page-item-title">{p.title || "無題のページ"}</span>
                <span className="page-item-date">{p.date.split(" ")[0]}</span>
              </li>
            ))}
          </ul>
        </aside>

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
              pan={activePage.pan}
              setPan={setPanForActivePage}
              zoom={activePage.zoom}
              setZoom={setZoomForActivePage}
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
              <div>ズーム: {(activePage.zoom * 100).toFixed(0)}%</div>
              <div>パン: X:{activePage.pan.x.toFixed(0)}, Y:{activePage.pan.y.toFixed(0)}</div>
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

        {/* 右側 AIフィードバックパネル */}
        {(isAnalyzing || aiAnalysisResult) && (
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

            {/* パネルフッター (デバッグ & 閉じる) */}
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
                    {activePage.strokes.length === 0 ? (
                      "// ストロークデータなし"
                    ) : (
                      JSON.stringify(
                        activePage.strokes.map(s => ({
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
        )}

      </div>
    </main>
  );
}
