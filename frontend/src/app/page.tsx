"use client";

import React, { useState, useRef } from "react";
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
  RefreshCw,
  Eye,
  EyeOff
} from "lucide-react";

// AIフィードバックのデフォルトモックデータ
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

export default function Home() {
  // 描画・トランスフォーム（パン・ズーム）ステート
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [replayedStrokes, setReplayedStrokes] = useState<Stroke[]>([]);
  const [isReplaying, setIsReplaying] = useState(false);
  
  const [pan, setPan] = useState<Pan>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState<number>(1);
  
  // 描画ツール設定
  const [tool, setTool] = useState<"pen" | "eraser">("pen");
  const [brushColor, setBrushColor] = useState<string>("#1e293b"); // デフォルト: 濃いダークグレー
  const [brushWidth, setBrushWidth] = useState<number>(4);
  const [eraserWidth, setEraserWidth] = useState<number>(30);
  
  // 背景画像ステート (白紙モード時は null)
  const [bgImageUrl, setBgImageUrl] = useState<string | null>(null);
  const [bgImageBase64, setBgImageBase64] = useState<string | null>(null);
  const [bgImageSize, setBgImageSize] = useState<{ width: number; height: number } | null>(null);
  const [bgFileName, setBgFileName] = useState<string | null>(null);
  
  // タイムラプスリプレイリボンの表示フラグ
  const [showReplay, setShowReplay] = useState(false);
  
  // AIフィードバック・デバッグステート
  const [aiAnalysisResult, setAiAnalysisResult] = useState<typeof mockAiFeedback | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // トランスフォーム（パン・ズーム）リセット
  const handleResetTransform = () => {
    setPan({ x: 0, y: 0 });
    setZoom(1);
  };

  // キャンバス全消去
  const handleClear = () => {
    if (window.confirm("キャンバスの内容をすべて消去して書き直しますか？")) {
      setStrokes([]);
      setReplayedStrokes([]);
      setIsReplaying(false);
      setAiAnalysisResult(null);
    }
  };

  // 白紙ページモードへ切り替え
  const handleSetBlank = () => {
    setBgImageUrl(null);
    setBgImageBase64(null);
    setBgImageSize(null);
    setBgFileName(null);
    handleResetTransform();
    setAiAnalysisResult(null);
  };

  // 画像ファイルアップロード処理
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      setBgImageBase64(base64);
      
      const img = new Image();
      img.src = base64;
      img.onload = () => {
        setBgImageSize({ width: img.width, height: img.height });
        setBgImageUrl(base64);
        setBgFileName(file.name);
        handleResetTransform();
        setAiAnalysisResult(null);
      };
    };
    reader.readAsDataURL(file);
  };

  // AI分析送信
  const handleAnalyze = async () => {
    if (strokes.length === 0) {
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
          questionId: bgFileName ? "custom_upload" : "blank_page",
          strokes: strokes.map(s => ({
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
          backgroundImage: bgImageBase64,
          imageWidth: bgImageSize?.width,
          imageHeight: bgImageSize?.height
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

  const colors = [
    { value: "#1e293b", label: "Dark" },
    { value: "#2563eb", label: "Blue" },
    { value: "#ef4444", label: "Red" },
  ];

  return (
    <main className="w-full h-screen overflow-hidden flex flex-col bg-slate-950 text-slate-100 font-sans">
      
      {/* 1. Word風 上部リボンツールバー */}
      <header className="w-full border-b border-slate-800 bg-slate-900/90 backdrop-blur-md z-30 px-4 py-2 flex flex-col gap-2 shadow-lg flex-shrink-0">
        
        {/* 最上段: ロゴと分析ボタン */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-black tracking-wider bg-gradient-to-r from-indigo-400 to-indigo-100 bg-clip-text text-transparent select-none">
              HomeruAI <span className="text-xs font-normal text-slate-400 border border-slate-700/60 px-2 py-0.5 rounded-full">Note v2</span>
            </h1>
            <span className="hidden sm:inline text-xs text-slate-500 font-mono">
              ({strokes.length} strokes logged)
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleAnalyze}
              disabled={strokes.length === 0 || isAnalyzing || isReplaying}
              className="btn btn-accent py-1.5 px-4 font-bold flex items-center gap-2 text-xs uppercase tracking-wider rounded-lg h-9"
            >
              <Sparkles size={14} className={isAnalyzing ? "animate-spin" : ""} />
              {isAnalyzing ? "分析中..." : "思考をAI分析"}
            </button>
          </div>
        </div>

        {/* 下段: Wordリボン風の機能グループ */}
        <div className="flex items-center gap-4 overflow-x-auto pb-1 select-none scrollbar-thin">
          
          {/* グループ1: ドキュメント / モード設定 */}
          <div className="flex items-center gap-1.5 pr-4 border-r border-slate-800 flex-shrink-0">
            <button
              onClick={handleSetBlank}
              className={`btn text-xs py-1.5 px-2.5 rounded-lg flex items-center gap-1.5 h-8 ${!bgImageUrl ? "btn-active bg-indigo-500/20 text-indigo-300 border-indigo-500/30" : ""}`}
              title="Blank Page"
            >
              <FileText size={14} />
              <span>白紙</span>
            </button>
            
            <button
              onClick={() => fileInputRef.current?.click()}
              className={`btn text-xs py-1.5 px-2.5 rounded-lg flex items-center gap-1.5 h-8 ${bgImageUrl ? "btn-active bg-indigo-500/20 text-indigo-300 border-indigo-500/30" : ""}`}
              title="Upload custom math problem image"
            >
              <Upload size={14} />
              <span className="max-w-[80px] truncate">{bgFileName || "問題アップロード"}</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileUpload}
              className="hidden"
            />
          </div>

          {/* グループ2: ツール選択 */}
          <div className="flex items-center gap-1.5 pr-4 border-r border-slate-800 flex-shrink-0">
            <button
              onClick={() => setTool("pen")}
              disabled={isReplaying}
              className={`btn text-xs py-1.5 px-3 rounded-lg flex items-center gap-1.5 h-8 ${tool === "pen" && !isReplaying ? "btn-active bg-indigo-500/20 text-indigo-300 border-indigo-500/40" : ""}`}
              title="Pen Tool"
            >
              <PenTool size={14} />
              <span>ペン</span>
            </button>
            
            <button
              onClick={() => setTool("eraser")}
              disabled={isReplaying}
              className={`btn text-xs py-1.5 px-3 rounded-lg flex items-center gap-1.5 h-8 ${tool === "eraser" && !isReplaying ? "btn-active bg-indigo-500/20 text-indigo-300 border-indigo-500/40" : ""}`}
              title="Object Eraser Tool"
            >
              <Eraser size={14} />
              <span>消しゴム</span>
            </button>
          </div>

          {/* グループ3: ブラシプロパティ */}
          <div className="flex items-center gap-3 pr-4 border-r border-slate-800 flex-shrink-0 h-8">
            {tool === "pen" ? (
              <>
                <div className="flex gap-1.5">
                  {colors.map((c) => (
                    <button
                      key={c.value}
                      onClick={() => setBrushColor(c.value)}
                      className="w-5 h-5 rounded-full border transition-all flex items-center justify-center flex-shrink-0"
                      style={{
                        backgroundColor: c.value === "#1e293b" ? "#ffffff" : c.value,
                        borderColor: brushColor === c.value ? "#818cf8" : "transparent",
                      }}
                      title={c.label}
                    >
                      {c.value === "#1e293b" && (
                        <span className="w-2.5 h-2.5 rounded-full bg-slate-800"></span>
                      )}
                    </button>
                  ))}
                </div>
                
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-400">太さ:</span>
                  <input
                    type="range"
                    min="2"
                    max="15"
                    value={brushWidth}
                    onChange={(e) => setBrushWidth(parseInt(e.target.value))}
                    className="w-16 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                  />
                  <span className="text-[10px] font-mono text-slate-300 w-6">{brushWidth}px</span>
                </div>
              </>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-400">消しゴム径:</span>
                <input
                  type="range"
                  min="10"
                  max="80"
                  value={eraserWidth}
                  onChange={(e) => setEraserWidth(parseInt(e.target.value))}
                  className="w-20 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                />
                <span className="text-[10px] font-mono text-slate-300 w-6">{eraserWidth}px</span>
              </div>
            )}
          </div>

          {/* グループ4: キャンバス操作 (クリア・ズームリセット) */}
          <div className="flex items-center gap-1.5 pr-4 border-r border-slate-800 flex-shrink-0">
            <button
              onClick={handleResetTransform}
              className="btn text-xs py-1.5 px-2.5 rounded-lg flex items-center gap-1.5 h-8 text-slate-300 hover:text-white"
              title="Reset Zoom & Scroll"
            >
              <Maximize2 size={13} />
              <span>等倍リセット ({(zoom * 100).toFixed(0)}%)</span>
            </button>
            
            <button
              onClick={handleClear}
              className="btn btn-danger text-xs py-1.5 px-2.5 rounded-lg flex items-center gap-1.5 h-8"
              title="Clear Note"
            >
              <Trash2 size={13} />
              <span>全消去</span>
            </button>
          </div>

          {/* グループ5: リプレイ */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => setShowReplay(!showReplay)}
              disabled={strokes.length === 0}
              className={`btn text-xs py-1.5 px-3 rounded-lg flex items-center gap-1.5 h-8 ${showReplay ? "bg-indigo-500/20 text-indigo-300 border-indigo-500/30" : "text-slate-300"} disabled:opacity-40`}
            >
              {showReplay ? <EyeOff size={13} /> : <Eye size={13} />}
              <span>タイムラプス</span>
            </button>

            {showReplay && strokes.length > 0 && (
              <div className="animate-fadeIn">
                <ReplayPlayer
                  strokes={strokes}
                  isReplaying={isReplaying}
                  setIsReplaying={setIsReplaying}
                  setReplayedStrokes={setReplayedStrokes}
                />
              </div>
            )}
          </div>

        </div>
      </header>

      {/* 2. キャンバス ＆ AIサイドパネル (下部エリア) */}
      <div className="flex flex-1 min-h-0 relative w-full h-full">
        
        {/* キャンバス領域 */}
        <div className="flex-1 h-full min-h-0 relative z-10 bg-slate-900">
          <Canvas
            strokes={isReplaying ? replayedStrokes : strokes}
            setStrokes={setStrokes}
            tool={tool}
            brushColor={brushColor}
            brushWidth={brushWidth}
            eraserWidth={eraserWidth}
            bgImageUrl={bgImageUrl}
            isReplaying={isReplaying}
            pan={pan}
            setPan={setPan}
            zoom={zoom}
            setZoom={setZoom}
            resetTransform={handleResetTransform}
          />

          {isReplaying && (
            <div className="absolute top-4 left-4 z-20 bg-indigo-600/90 text-white text-xs px-3 py-1.5 rounded-full font-bold flex items-center gap-1.5 shadow-lg backdrop-blur-sm select-none animate-pulse">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
              </span>
              REPLAYING PROCESS
            </div>
          )}

          {/* 無限キャンバス操作インジケータ (左下) */}
          <div className="absolute bottom-4 left-4 z-20 flex flex-col gap-1 text-[10px] text-slate-400 font-mono bg-slate-950/80 backdrop-blur border border-slate-800 p-2.5 rounded-lg select-none">
            <div>ズーム: {(zoom * 100).toFixed(0)}%</div>
            <div>スクロール: X:{pan.x.toFixed(0)}, Y:{pan.y.toFixed(0)}</div>
            <div className="border-t border-slate-800 pt-1 mt-1 text-[9px] text-slate-500">
              ※ PC: Wheelでズーム / 右ドラッグで移動<br/>
              ※ iPad: Pencilで書く / 指でスクロール＆ピンチ
            </div>
          </div>
        </div>

        {/* 右側 AIフィードバックサイドパネル (AIが動き出すか結果がある場合にスライド表示) */}
        {(isAnalyzing || aiAnalysisResult) && (
          <aside className="absolute md:relative right-0 top-0 h-full w-full md:w-[380px] z-20 glass-panel border-t-0 border-r-0 border-b-0 border-l border-slate-800 bg-slate-950/95 backdrop-blur-md flex flex-col min-h-0 shadow-2xl animate-slideLeft">
            
            {/* サイドバーヘッダー */}
            <div className="p-4 border-b border-slate-800 flex items-center justify-between flex-shrink-0">
              <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5 select-none">
                <Award size={14} />
                AI Process Analysis
              </span>
              {aiAnalysisResult && (
                <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs px-2.5 py-0.5 rounded-full font-bold">
                  {aiAnalysisResult["思考タイプラベル"]}
                </span>
              )}
            </div>

            {/* サイドバーコンテンツ */}
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
              {isAnalyzing ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3">
                  <div className="w-10 h-10 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin"></div>
                  <span className="text-sm text-indigo-300 font-medium animate-pulse">
                    試行錯誤（消去・停止）の跡を解析しています...
                  </span>
                </div>
              ) : (
                aiAnalysisResult && (
                  <div className="flex flex-col gap-5 text-sm leading-relaxed animate-fadeIn">
                    
                    {/* 総合評価 */}
                    <div>
                      <h4 className="text-xs font-semibold text-slate-400 mb-1.5 flex items-center gap-1 select-none">
                        <HelpCircle size={13} className="text-indigo-400" /> 総合評価
                      </h4>
                      <p className="text-slate-200">{aiAnalysisResult["総合評価"]}</p>
                    </div>

                    {/* プロセスへの称賛ポイント */}
                    <div>
                      <h4 className="text-xs font-semibold text-slate-400 mb-1.5 flex items-center gap-1 select-none">
                        <Sparkles size={13} className="text-emerald-400" /> プロセスの称賛ポイント
                      </h4>
                      <ul className="list-none flex flex-col gap-2">
                        {aiAnalysisResult["プロセスへの称賛ポイント"].map((point, index) => (
                          <li key={index} className="text-slate-300 flex items-start gap-2">
                            <span className="text-emerald-400 mt-1 flex-shrink-0">✓</span>
                            <span>{point}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* 惜しい点（ヒント） */}
                    <div>
                      <h4 className="text-xs font-semibold text-slate-400 mb-1.5 flex items-center gap-1 select-none">
                        <Lightbulb size={13} className="text-amber-400" /> 次へのヒント
                      </h4>
                      <p className="text-amber-200/90 bg-amber-500/5 border border-amber-500/10 p-3 rounded-xl">
                        {aiAnalysisResult["惜しい点（ヒント）"]}
                      </p>
                    </div>

                  </div>
                )
              )}
            </div>

            {/* サイドバー最下部: 開発者ダンプ & 閉じるボタン */}
            <div className="p-3 border-t border-slate-800 flex flex-col gap-2 flex-shrink-0 bg-slate-900/40">
              
              <button
                onClick={() => setShowDebug(!showDebug)}
                className="w-full flex items-center justify-between text-xs text-slate-400 hover:text-white transition-colors py-1"
              >
                <span className="flex items-center gap-1.5">
                  <Code size={12} />
                  <span>ストロークログJSONダンプ</span>
                </span>
                {showDebug ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>

              {showDebug && (
                <div className="flex flex-col gap-2 mt-1 animate-fadeIn">
                  <div className="text-[9px] text-slate-500 font-mono leading-tight max-h-[100px] overflow-y-auto bg-slate-950 p-2 rounded border border-slate-900">
                    {strokes.length === 0 ? (
                      "// ストロークなし"
                    ) : (
                      JSON.stringify(
                        strokes.map(s => ({
                          strokeId: s.strokeId,
                          type: s.type,
                          startTime: s.startTime,
                          endTime: s.endTime,
                          pointsCount: s.points.length,
                          isErased: s.isErased || false,
                          erasedAt: s.erasedAt,
                          targetStrokeIds: s.targetStrokeIds
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
                className="btn py-1.5 w-full text-xs font-semibold text-slate-400 hover:text-white border border-slate-800 hover:bg-slate-800"
              >
                フィードバックを閉じる
              </button>
            </div>

          </aside>
        )}

      </div>
    </main>
  );
}
