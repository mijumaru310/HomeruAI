"use client";

import { useState } from "react";
import { discardPendingStudyEventsForLearner } from "../../../utils/adaptiveLearning";
import { experimentWorkspaceKey, legacyExperimentWorkspaceKey, type ExperimentConfig, type ExperimentSetId, type FeedbackCondition } from "../../../utils/experimentMode";
import { deleteWorkspace } from "../../../utils/notebookStorage";

const sets: ExperimentSetId[] = ["easy", "standard", "challenge"];
const conditions: FeedbackCondition[] = ["process_praise", "neutral_summary"];

export default function ResearchCleanupPage() {
  const [code, setCode] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function removeLocalData() {
    const participantCode = code.trim();
    if (!/^[A-Za-z0-9_-]{3,32}$/.test(participantCode) || confirmation !== participantCode) {
      setMessage("参加者コードと確認欄を一致させてください。");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      // Close the participant tab first so its autosave cannot recreate a deleted notebook.
      for (const setId of sets) {
        for (const feedbackCondition of conditions) {
          const config: ExperimentConfig = { participantCode, setId, feedbackCondition };
          await deleteWorkspace(experimentWorkspaceKey(config));
          await deleteWorkspace(legacyExperimentWorkspaceKey(config));
        }
      }
      const removedEvents = discardPendingStudyEventsForLearner(`study_${participantCode}`);
      setMessage(`このブラウザのノートを削除し、未送信ログ ${removedEvents} 件を破棄しました。サーバー側の削除は別途行ってください。`);
      setCode("");
      setConfirmation("");
    } catch (error) {
      setMessage(`削除を完了できませんでした: ${error instanceof Error ? error.message : "不明なエラー"}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 660, margin: "3rem auto", padding: "1.5rem", lineHeight: 1.7 }}>
      <h1>研究用・端末データの削除</h1>
      <p>研究者が、参加者の画面をすべて閉じてから、その参加者が使った同じiPad・同じブラウザで操作してください。この画面は認証機能ではありません。</p>
      <p>参加者コードに対応する全問題セット・全提示条件の端末内ノートと、未送信の操作ログを削除します。サーバーの研究データや外部アンケート回答は削除されません。</p>
      <label htmlFor="cleanup-code">参加者コード</label>
      <input id="cleanup-code" value={code} onChange={event => setCode(event.target.value)} autoComplete="off" style={{ display: "block", width: "100%", padding: "0.7rem", marginBottom: "1rem" }} />
      <label htmlFor="cleanup-confirm">確認のため同じコードを入力</label>
      <input id="cleanup-confirm" value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" style={{ display: "block", width: "100%", padding: "0.7rem", marginBottom: "1rem" }} />
      <button type="button" disabled={busy} onClick={() => void removeLocalData()} style={{ padding: "0.75rem 1rem" }}>
        {busy ? "削除中…" : "この端末の参加者データを削除"}
      </button>
      {message && <p role="status">{message}</p>}
    </main>
  );
}
