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
  const [currentTime, setCurrentTime] = useState(0); 
  const [totalDuration, setTotalDuration] = useState(0); 
  const [speed, setSpeed] = useState<number>(1); 

  const animationFrameRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);

  const getTimelineRange = useCallback(() => {
    if (strokes.length === 0) return { minTime: 0, maxTime: 0, duration: 0 };

    let minTime = Infinity;
    let maxTime = -Infinity;

    strokes.forEach((stroke) => {
      if (stroke.startTime < minTime) minTime = stroke.startTime;
      const strokeEnd = stroke.endTime;
      const eraseEnd = stroke.isErased && stroke.erasedAt ? stroke.erasedAt : 0;
      const finalEnd = Math.max(strokeEnd, eraseEnd);

      if (finalEnd > maxTime) maxTime = finalEnd;
    });

    const duration = maxTime - minTime > 0 ? maxTime - minTime + 500 : 0;
    return { minTime, maxTime, duration };
  }, [strokes]);

  useEffect(() => {
    const { duration } = getTimelineRange();
    setTotalDuration(duration);
    setCurrentTime(0);
    setIsPlaying(false);
    setIsReplaying(false);
  }, [strokes, getTimelineRange, setIsReplaying]);

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
          if (stroke.startTime > currentAbsoluteTime) {
            return null;
          }

          const isErasedAtThisTime =
            !!stroke.isErased &&
            stroke.erasedAt !== undefined &&
            stroke.erasedAt <= currentAbsoluteTime;

          if (stroke.endTime <= currentAbsoluteTime) {
            return {
              ...stroke,
              isErased: isErasedAtThisTime,
            };
          }

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

  useEffect(() => {
    updateReplayedStrokes(currentTime);
  }, [currentTime, updateReplayedStrokes]);

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

  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  };

  const isDisabled = strokes.length === 0;

  return (
    <div className="flex items-center gap-3 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-900/60 shadow-inner h-10 w-[300px] md:w-[360px]">
      <button
        onClick={togglePlay}
        disabled={isDisabled}
        className={`p-1.5 rounded-full flex items-center justify-center transition-colors ${
          isPlaying
            ? "bg-amber-500/20 text-amber-300 hover:bg-amber-500/30"
            : "bg-indigo-600 text-white hover:bg-indigo-700"
        } disabled:opacity-40 disabled:cursor-not-allowed`}
        title={isPlaying ? "Pause" : "Play"}
      >
        {isPlaying ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
      </button>

      <button
        onClick={handleReset}
        disabled={isDisabled}
        className="p-1.5 rounded-full text-slate-400 hover:text-white transition-colors disabled:opacity-40"
        title="Reset"
      >
        <RotateCcw size={14} />
      </button>

      {/* シークバー */}
      <div className="flex-1 flex items-center gap-2 min-w-0">
        <input
          type="range"
          min={0}
          max={totalDuration}
          value={currentTime}
          onChange={handleSliderChange}
          disabled={isDisabled}
          className="flex-1 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500 disabled:opacity-40"
          style={{
            background: `linear-gradient(to right, #6366f1 0%, #6366f1 ${
              totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0
            }%, #334155 ${
              totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0
            }%, #334155 100%)`,
          }}
        />
        <span className="text-[10px] font-mono text-slate-400 select-none whitespace-nowrap">
          {formatTime(currentTime)}/{formatTime(totalDuration)}
        </span>
      </div>

      <button
        onClick={cycleSpeed}
        disabled={isDisabled}
        className="py-0.5 px-1.5 rounded text-[10px] font-mono text-indigo-300 border border-indigo-500/30 bg-indigo-500/5 hover:bg-indigo-500/10 transition-colors disabled:opacity-40"
        title="Speed"
      >
        {speed}x
      </button>
    </div>
  );
}
