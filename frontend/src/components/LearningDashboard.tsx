"use client";

import React from "react";
import { Award, Brain, Flame, Footprints, Sparkles, TrendingUp, X } from "lucide-react";
import type { GrowthPoint, LearnerDashboardData } from "../types/canvas";

interface Props {
  data: LearnerDashboardData | null;
  loading: boolean;
  onClose: () => void;
}

const percent = (value: number) => `${Math.round(value * 100)}%`;

function linePath(history: GrowthPoint[], key: "mastery" | "autonomous_engagement" | "persistence") {
  if (history.length === 0) return "";
  return history.map((point, index) => {
    const x = history.length === 1 ? 300 : 24 + index / (history.length - 1) * 552;
    const y = 142 - point[key] * 112;
    return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

export default function LearningDashboard({ data, loading, onClose }: Props) {
  const state = data?.state;
  const xpRatio = data ? data.level_xp / data.xp_to_next_level : 0;
  return (
    <div className="growth-modal" role="dialog" aria-modal="true" aria-label="学びの成長ダッシュボード">
      <section className="growth-dashboard">
        <header className="growth-dashboard-header">
          <div>
            <span className="eyebrow"><Sparkles size={15} />学びの成長記録</span>
            <h2>できた過程が、ちゃんと力になっている</h2>
            <p>これは固定的な能力判定ではなく、このノートで観測した行動から見た現在地です。</p>
          </div>
          <button className="icon-close" onClick={onClose} aria-label="ダッシュボードを閉じる"><X /></button>
        </header>

        {loading ? (
          <div className="dashboard-loading">成長記録を読み込んでいます…</div>
        ) : !data || !state ? (
          <div className="dashboard-loading">成長記録を取得できませんでした。閉じて、もう一度「成長を見る」を押してください。</div>
        ) : (
          <div className="growth-content">
            <div className="level-hero">
              <div className="level-orb"><small>LEVEL</small><strong>{data.level}</strong></div>
              <div className="level-copy">
                <strong>{data.total_xp} XP</strong>
                <span>次のレベルまで {data.xp_to_next_level - data.level_xp} XP</span>
                <div className="xp-track"><div style={{ width: `${Math.round(xpRatio * 100)}%` }} /></div>
                <small>難しい問題で推定値が下がっても、積み上げたXPは減りません。</small>
              </div>
              <div className="streak-chip"><Flame size={20} />{data.streak_days}日<br /><small>学習記録</small></div>
            </div>

            <div className="ability-grid">
              {[
                ["今の習得度", state.mastery, "問題への身につき", "#2563eb"],
                ["自分で進める力", state.autonomous_engagement, "自発的に続ける行動", "#7c3aed"],
                ["粘り強さ", state.persistence, "止まっても戻る力", "#059669"],
                ["見守り度", 1 - state.support_need, "ヒントなしで見守れる度合い", "#ea580c"],
              ].map(([label, value, note, color]) => (
                <article className="ability-card" key={String(label)}>
                  <div className="ability-label"><Brain size={17} style={{ color: String(color) }} />{label}</div>
                  <strong>{percent(Number(value))}</strong>
                  <div className="ability-track"><div style={{ width: percent(Number(value)), background: String(color) }} /></div>
                  <small>{note}</small>
                </article>
              ))}
            </div>

            <article className="growth-chart-card">
              <div className="card-title"><TrendingUp size={18} />最近の成長カーブ</div>
              {data.history.length < 2 ? (
                <div className="empty-growth">あと1回問題を振り返ると、成長カーブが見えるようになります。</div>
              ) : (
                <>
                  <svg viewBox="0 0 600 165" role="img" aria-label="習得度、自分で進める力、粘り強さの推移">
                    {[30, 86, 142].map(y => <line key={y} x1="24" x2="576" y1={y} y2={y} stroke="#e2e8f0" strokeWidth="1" />)}
                    <path d={linePath(data.history, "mastery")} fill="none" stroke="#2563eb" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
                    <path d={linePath(data.history, "autonomous_engagement")} fill="none" stroke="#7c3aed" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
                    <path d={linePath(data.history, "persistence")} fill="none" stroke="#059669" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <div className="chart-legend"><span className="blue">習得度</span><span className="purple">自分で進める力</span><span className="green">粘り強さ</span></div>
                </>
              )}
            </article>

            <div className="growth-lower-grid">
              <article className="growth-card">
                <div className="card-title"><Footprints size={18} />積み上げた過程</div>
                <div className="journey-stats">
                  <span><strong>{data.total_analyses}</strong>問題を振り返った</span>
                  <span><strong>{data.total_strokes}</strong>本ペンを動かした</span>
                  <span><strong>{data.total_revisions}</strong>回見直した</span>
                  <span><strong>{data.total_restarts}</strong>回考えて再開した</span>
                </div>
              </article>
              <article className="growth-card">
                <div className="card-title"><Award size={18} />見つけた強み</div>
                <div className="achievement-list">
                  {data.achievements.length ? data.achievements.map(item => <span key={item}>🏅 {item}</span>) : <p>最初の問題に取り組むと、ここに強みが増えていきます。</p>}
                </div>
              </article>
            </div>

            <div className="state-reasons">
              <strong>今回の推定根拠</strong>
              <ul>{state.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
              <small>推定の確からしさ {percent(state.confidence)} ／ {state.model_version}</small>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
