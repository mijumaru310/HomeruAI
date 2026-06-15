"use client";

import React, { useState } from "react";
import Canvas from "../components/Canvas";
import ReplayPlayer from "../components/ReplayPlayer";
import { Stroke } from "../types/canvas";
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
  Award
} from "lucide-react";

// AIフィードバックのモックデータ
const mockAiFeedback = {
  "総合評価": "最後まで諦めずに、補助線を引いて異なるアプローチを試したプロセスが非常に素晴らしいです！最終的な計算ミスはありますが、三角形の面積の公式と三平方の定理の理解は完璧にできています。",
  "プロセスへの称賛ポイント": [
    "直角三角形であること（6:8:10 = 3:4:5）に気づき、底辺と高さを正しく特定しようとした点。",
    "一度底辺と高さを逆に書いて消しゴムで修正した形跡があり、自分のミスに素早く気付いて自己修復できた柔軟性。",
    "計算途中で10秒以上ペンが止まった時間（迷い）がありましたが、そこから逃げずに最後まで解ききった粘り強さ。"
  ],
  "惜しい点（ヒント）": "底辺が6、高さが8のときの面積計算（6 × 8 ÷ 2）の最後の割り算をもう一度見直してみましょう。掛け算は48で合っていますよ！",
  "思考タイプラベル": "粘り強い探索者 🔍"
};

export default function Home() {
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [replayedStrokes, setReplayedStrokes] = useState<Stroke[]>([]);
  const [isReplaying, setIsReplaying] = useState(false);
  
  const [tool, setTool] = useState<"pen" | "eraser">("pen");
  const [brushColor, setBrushColor] = useState<string>("#1e293b"); // 紙のノートに合うダークカラー
  const [brushWidth, setBrushWidth] = useState<number>(4);
  const [eraserWidth, setEraserWidth] = useState<number>(30);
  
  const [aiAnalysisResult, setAiAnalysisResult] = useState<typeof mockAiFeedback | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showDebug, setShowDebug] = useState(false);

  // キャンバスの全クリア
  const handleClear = () => {
    if (window.confirm("ノートをすべて消去して書き直しますか？")) {
      setStrokes([]);
      setReplayedStrokes([]);
      setIsReplaying(false);
      setAiAnalysisResult(null);
    }
  };

  // AI分析シミュレーション
  const handleAnalyze = () => {
    if (strokes.length === 0) {
      alert("分析する手書きプロセスがありません。まずはキャンバスに解答を記述してください。");
      return;
    }
    
    setIsAnalyzing(true);
    setAiAnalysisResult(null);
    
    // 1.5秒のモックローディング
    setTimeout(() => {
      setIsAnalyzing(false);
      setAiAnalysisResult(mockAiFeedback);
    }, 1800);
  };

  // ペンカラーのバリエーション
  const colors = [
    { value: "#1e293b", label: "Dark" },  // メインペン
    { value: "#2563eb", label: "Blue" },  // 思考整理用
    { value: "#ef4444", label: "Red" },   // 強調・自己採点用
  ];

  return (
    <main className="w-full h-screen overflow-hidden flex flex-col md:flex-row p-4 gap-4 bg-slate-950 text-slate-100">
      
      {/* 1. キャンバスエリア (左側) */}
      <div className="flex-1 h-[60vh] md:h-full flex flex-col gap-3">
        <div className="flex items-center justify-between px-2">
          <div className="flex items-center gap-2">
            <span className="bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 text-xs px-2.5 py-1 rounded-full font-medium">
              Target: iPad + Apple Pencil
            </span>
            <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">
              HomeruAI <span className="text-indigo-400 text-sm font-normal">Workspace</span>
            </h1>
          </div>
          <div className="text-xs text-slate-400 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>筆記プロセス記録中 ({strokes.length} strokes)</span>
          </div>
        </div>

        <div className="flex-1 w-full rounded-2xl overflow-hidden border border-slate-800 shadow-2xl relative">
          <Canvas
            strokes={isReplaying ? replayedStrokes : strokes}
            setStrokes={setStrokes}
            tool={tool}
            brushColor={brushColor}
            brushWidth={brushWidth}
            eraserWidth={eraserWidth}
            bgImageUrl="/question.png"
            isReplaying={isReplaying}
          />

          {isReplaying && (
            <div className="absolute top-4 left-4 z-20 bg-indigo-500/90 text-white text-xs px-3 py-1.5 rounded-full font-semibold flex items-center gap-1.5 shadow-lg backdrop-blur-sm animate-pulse">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
              </span>
              REPLAYING TIMELAPSE
            </div>
          )}
        </div>
      </div>

      {/* 2. コントロール & フィードバックエリア (右側) */}
      <div className="w-full md:w-[380px] h-[38vh] md:h-full flex flex-col gap-4 overflow-y-auto pr-1">
        
        {/* コントロールエリア */}
        <div className="glass-panel p-4 flex flex-col gap-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-indigo-400">
              Drawing Controls
            </span>
            <button
              onClick={handleClear}
              className="btn btn-danger py-1 px-2.5 rounded-md text-xs flex items-center gap-1"
              title="Clear Canvas"
            >
              <Trash2 size={12} />
              <span>クリア</span>
            </button>
          </div>

          {/* ツール選択 */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setTool("pen")}
              disabled={isReplaying}
              className={`btn ${
                tool === "pen" && !isReplaying ? "btn-primary" : ""
              } disabled:opacity-50`}
            >
              <PenTool size={16} />
              <span>ペン</span>
            </button>
            <button
              onClick={() => setTool("eraser")}
              disabled={isReplaying}
              className={`btn ${
                tool === "eraser" && !isReplaying ? "btn-primary" : ""
              } disabled:opacity-50`}
            >
              <Eraser size={16} />
              <span>消しゴム</span>
            </button>
          </div>

          {/* ペン詳細設定 */}
          {tool === "pen" && (
            <div className="flex flex-col gap-2.5 animate-fadeIn">
              <div className="flex items-center justify-between text-xs text-slate-300">
                <span>線の色:</span>
                <span className="font-semibold">{colors.find(c => c.value === brushColor)?.label}</span>
              </div>
              <div className="flex gap-2">
                {colors.map((c) => (
                  <button
                    key={c.value}
                    onClick={() => setBrushColor(c.value)}
                    className="w-8 h-8 rounded-full border-2 transition-all flex items-center justify-center"
                    style={{
                      backgroundColor: c.value === "#1e293b" ? "#ffffff" : c.value,
                      borderColor: brushColor === c.value ? "#818cf8" : "transparent",
                      boxShadow: brushColor === c.value ? "0 0 10px rgba(99, 102, 241, 0.5)" : "none",
                    }}
                  >
                    {c.value === "#1e293b" && (
                      <span className="w-4 h-4 rounded-full bg-slate-800"></span>
                    )}
                  </button>
                ))}
              </div>

              <div className="flex flex-col gap-1 mt-1">
                <div className="flex justify-between text-xs text-slate-400">
                  <span>太さ:</span>
                  <span>{brushWidth}px</span>
                </div>
                <input
                  type="range"
                  min="2"
                  max="15"
                  value={brushWidth}
                  onChange={(e) => setBrushWidth(parseInt(e.target.value))}
                  className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                />
              </div>
            </div>
          )}

          {/* 消しゴム詳細設定 */}
          {tool === "eraser" && (
            <div className="flex flex-col gap-2 animate-fadeIn">
              <div className="flex justify-between text-xs text-slate-400">
                <span>消しゴムサイズ:</span>
                <span>{eraserWidth}px</span>
              </div>
              <input
                type="range"
                min="10"
                max="80"
                value={eraserWidth}
                onChange={(e) => setEraserWidth(parseInt(e.target.value))}
                className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
            </div>
          )}
        </div>

        {/* リプレイプレイヤー */}
        <ReplayPlayer
          strokes={strokes}
          isReplaying={isReplaying}
          setIsReplaying={setIsReplaying}
          setReplayedStrokes={setReplayedStrokes}
        />

        {/* 分析実行ボタン */}
        <button
          onClick={handleAnalyze}
          disabled={strokes.length === 0 || isAnalyzing || isReplaying}
          className="btn btn-accent py-3 w-full font-bold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed text-sm uppercase tracking-wider"
        >
          <Sparkles size={18} className={isAnalyzing ? "animate-spin" : ""} />
          {isAnalyzing ? "AIでプロセス分析中..." : "思考プロセスをAI分析"}
        </button>

        {/* AIフィードバックエリア */}
        {(isAnalyzing || aiAnalysisResult) && (
          <div className="glass-panel p-4 flex flex-col gap-4 border-indigo-500/20 bg-slate-900/50">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                <Award size={14} />
                AI Process Analysis
              </span>
              {aiAnalysisResult && (
                <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs px-2 py-0.5 rounded-full font-semibold">
                  {aiAnalysisResult["思考タイプラベル"]}
                </span>
              )}
            </div>

            {isAnalyzing ? (
              <div className="flex flex-col items-center justify-center py-8 gap-3">
                <div className="w-8 h-8 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin"></div>
                <span className="text-sm text-indigo-300 font-medium animate-pulse">
                  試行錯誤（消去・停止）の跡を解析しています...
                </span>
              </div>
            ) : (
              aiAnalysisResult && (
                <div className="flex flex-col gap-4 text-sm leading-relaxed animate-fadeIn">
                  {/* 総合評価 */}
                  <div>
                    <h4 className="text-xs font-semibold text-slate-400 mb-1 flex items-center gap-1">
                      <HelpCircle size={13} className="text-indigo-400" /> 総合評価
                    </h4>
                    <p className="text-slate-200">{aiAnalysisResult["総合評価"]}</p>
                  </div>

                  {/* 称賛ポイント */}
                  <div>
                    <h4 className="text-xs font-semibold text-slate-400 mb-1 flex items-center gap-1">
                      <Sparkles size={13} className="text-emerald-400" /> プロセス称賛
                    </h4>
                    <ul className="list-none flex flex-col gap-1.5">
                      {aiAnalysisResult["プロセスへの称賛ポイント"].map((point, index) => (
                        <li key={index} className="text-slate-300 flex items-start gap-1.5">
                          <span className="text-emerald-400 mt-1">✓</span>
                          <span>{point}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* 惜しい点・ヒント */}
                  <div>
                    <h4 className="text-xs font-semibold text-slate-400 mb-1 flex items-center gap-1">
                      <Lightbulb size={13} className="text-amber-400" /> 次へのヒント
                    </h4>
                    <p className="text-amber-200/90 bg-amber-500/5 border border-amber-500/10 p-2.5 rounded-lg">
                      {aiAnalysisResult["惜しい点（ヒント）"]}
                    </p>
                  </div>
                </div>
              )
            )}
          </div>
        )}

        {/* 開発者デバッグログ（手書きログJSONダンプ確認用） */}
        <div className="glass-panel p-3 flex flex-col gap-2">
          <button
            onClick={() => setShowDebug(!showDebug)}
            className="w-full flex items-center justify-between text-xs text-slate-400 hover:text-white transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <Code size={12} />
              <span>ログデータ確認 (JSON Log Dump)</span>
            </span>
            {showDebug ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>

          {showDebug && (
            <div className="flex flex-col gap-2 mt-2 border-t border-slate-800 pt-2 animate-fadeIn">
              <div className="text-[10px] text-slate-500 font-mono leading-tight max-h-[150px] overflow-y-auto bg-slate-950 p-2 rounded border border-slate-900">
                {strokes.length === 0 ? (
                  "// ストロークはありません。キャンバスに描くとJSONがここに蓄積されます。"
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
              <div className="text-[10px] text-slate-400 leading-normal">
                ※ 各ストロークは `strokeId`, `type`, `startTime`, `endTime` およびポインターの全座標履歴を保持しています。
              </div>
            </div>
          )}
        </div>

      </div>
    </main>
  );
}
