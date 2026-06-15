"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import { Stroke } from "../types/canvas";
import { Play, Pause, RotateCcw, FastForward } from "lucide-react";

interface ReplayPlayerProps {
  strokes: Stroke[];
  isReplaying: boolean;
  setIsReplaying: (replaying: boolean) => void;
  setReplayedStrokes: (strokes: Stroke[]) => void;
}

export default function ReplayPlayer({
  strokes,
  isReplaying,
  setIsReplaying,
  setReplayedStrokes,
}: ReplayPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0); // 経過時間 (ms)
  const [totalDuration, setTotalDuration] = useState(0); // 総再生時間 (ms)
  const [speed, setSpeed] = useState<number>(1); // 再生速度 (1x, 2x, 4x)

  const animationFrameRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);

  // ストローク全体の開始時間と終了時間を計算
  const getTimelineRange = useCallback(() => {
    if (strokes.length === 0) return { minTime: 0, maxTime: 0, duration: 0 };

    let minTime = Infinity;
    let maxTime = -Infinity;

    strokes.forEach((stroke) => {
      if (stroke.startTime < minTime) minTime = stroke.startTime;
      // 描画の終了、もしくは消去時間のいずれか遅い方を考慮
      const strokeEnd = stroke.endTime;
      const eraseEnd = stroke.isErased && stroke.erasedAt ? stroke.erasedAt : 0;
      const finalEnd = Math.max(strokeEnd, eraseEnd);

      if (finalEnd > maxTime) maxTime = finalEnd;
    });

    // 余白として少し最後に時間を取る
    const duration = maxTime - minTime > 0 ? maxTime - minTime + 500 : 0;
    return { minTime, maxTime, duration };
  }, [strokes]);

  // ストロークデータの初期化・更新時
  useEffect(() => {
    const { duration } = getTimelineRange();
    setTotalDuration(duration);
    setCurrentTime(0);
    setIsPlaying(false);
    setIsReplaying(false);
  }, [strokes, getTimelineRange, setIsReplaying]);

  // 現在の再生時間におけるストローク状態を算出してCanvasに反映する
  const updateReplayedStrokes = useCallback(
    (timeMs: number) => {
      if (strokes.length === 0) {
        setReplayedStrokes([]);
        return;
      }

      const { minTime } = getTimelineRange();
      const currentAbsoluteTime = minTime + timeMs;

      const replayed = strokes
        .map((stroke): Stroke | null => {
          // まだ開始していないストロークは除外
          if (stroke.startTime > currentAbsoluteTime) {
            return null;
          }

          // 消去タイミングの判定 (現在時刻より前に消去されていたら、リプレイ上でも消去)
          const isErasedAtThisTime =
            !!stroke.isErased &&
            stroke.erasedAt !== undefined &&
            stroke.erasedAt <= currentAbsoluteTime;

          // 描画完了しているストローク
          if (stroke.endTime <= currentAbsoluteTime) {
            return {
              ...stroke,
              isErased: isErasedAtThisTime,
            };
          }

          // 描画中のストローク（部分的に表示）
          const elapsedInStroke = currentAbsoluteTime - stroke.startTime;
          const visiblePoints = stroke.points.filter((p) => p.t <= elapsedInStroke);

          return {
            ...stroke,
            points: visiblePoints,
            isErased: isErasedAtThisTime,
          };
        })
        .filter((s): s is Stroke => s !== null);

      setReplayedStrokes(replayed);
    },
    [strokes, getTimelineRange, setReplayedStrokes]
  );

  // currentTime の更新を検知して安全に Canvas にストロークを反映する（レンダー中のsetState防止）
  useEffect(() => {
    updateReplayedStrokes(currentTime);
  }, [currentTime, updateReplayedStrokes]);

  // 再生のアニメーションループ
  const animate = useCallback(
    (timestamp: number) => {
      if (!lastTimeRef.current) {
        lastTimeRef.current = timestamp;
      }
      const delta = timestamp - lastTimeRef.current;
      lastTimeRef.current = timestamp;

      setCurrentTime((prevTime) => {
        const nextTime = prevTime + delta * speed;
        if (nextTime >= totalDuration) {
          // 再生完了
          setIsPlaying(false);
          setIsReplaying(false);
          if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
          }
          return totalDuration;
        }
        return nextTime;
      });

      if (isPlaying) {
        animationFrameRef.current = requestAnimationFrame(animate);
      }
    },
    [isPlaying, speed, totalDuration, setIsReplaying]
  );

  // 再生・一時停止のトリガー
  useEffect(() => {
    if (isPlaying) {
      setIsReplaying(true);
      lastTimeRef.current = null;
      animationFrameRef.current = requestAnimationFrame(animate);
    } else {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isPlaying, animate, setIsReplaying]);

  const togglePlay = () => {
    if (strokes.length === 0) return;
    
    // 再生完了した状態から再度再生を押した場合は最初から
    if (currentTime >= totalDuration) {
      setCurrentTime(0);
      updateReplayedStrokes(0);
    }
    
    setIsPlaying(!isPlaying);
  };

  const handleReset = () => {
    setIsPlaying(false);
    setIsReplaying(false);
    setCurrentTime(0);
    updateReplayedStrokes(0);
    setReplayedStrokes([]);
  };

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = parseFloat(e.target.value);
    setCurrentTime(newTime);
    setIsReplaying(newTime > 0);
    updateReplayedStrokes(newTime);
    if (isPlaying && newTime >= totalDuration) {
      setIsPlaying(false);
    }
  };

  const cycleSpeed = () => {
    setSpeed((prev) => {
      if (prev === 1) return 2;
      if (prev === 2) return 5;
      return 1;
    });
  };

  // ミリ秒を秒・分フォーマットに変換するヘルパー
  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const milliseconds = Math.floor((ms % 1000) / 100);
    return `${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}.${milliseconds}`;
  };

  const isDisabled = strokes.length === 0;

  return (
    <div className="glass-panel p-4 flex flex-col gap-3 w-full">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-indigo-400">
          Process Timelapse Player
        </span>
        <div className="text-sm font-mono text-slate-300">
          {formatTime(currentTime)} / {formatTime(totalDuration)}
        </div>
      </div>

      {/* シークバー */}
      <div className="w-full flex items-center gap-2">
        <input
          type="range"
          min={0}
          max={totalDuration}
          value={currentTime}
          onChange={handleSliderChange}
          disabled={isDisabled}
          className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            background: `linear-gradient(to right, #6366f1 0%, #6366f1 ${
              totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0
            }%, #334155 ${
              totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0
            }%, #334155 100%)`,
          }}
        />
      </div>

      {/* コントロールボタン群 */}
      <div className="flex items-center justify-between mt-1">
        <div className="flex items-center gap-2">
          <button
            onClick={togglePlay}
            disabled={isDisabled}
            className={`btn p-2 rounded-full w-10 h-10 flex items-center justify-center ${
              isPlaying
                ? "bg-amber-500/20 text-amber-300 border-amber-500/30 hover:bg-amber-500/30"
                : "btn-primary"
            } disabled:opacity-40 disabled:cursor-not-allowed`}
            title={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? <Pause size={18} /> : <Play size={18} className="ml-0.5" />}
          </button>

          <button
            onClick={handleReset}
            disabled={isDisabled}
            className="btn p-2 rounded-full w-10 h-10 flex items-center justify-center text-slate-300 hover:text-white disabled:opacity-40"
            title="Reset"
          >
            <RotateCcw size={18} />
          </button>
        </div>

        <div>
          <button
            onClick={cycleSpeed}
            disabled={isDisabled}
            className="btn py-1.5 px-3 rounded-lg text-xs font-mono flex items-center gap-1.5 text-indigo-300 border-indigo-500/20 bg-indigo-500/5 hover:bg-indigo-500/10 disabled:opacity-40"
            title="Speed"
          >
            <FastForward size={14} />
            <span>{speed}x</span>
          </button>
        </div>
      </div>
    </div>
  );
}
