export type ExperimentSetId = "easy" | "standard" | "challenge";
export type FeedbackCondition = "process_praise" | "neutral_summary";
export const EXPERIMENT_PROTOCOL_VERSION = "adult-pilot-v1.1";

export interface ExperimentConfig {
  participantCode: string;
  setId: ExperimentSetId;
  feedbackCondition: FeedbackCondition;
}

export type ExperimentRoute =
  | { kind: "normal" }
  | { kind: "invalid"; reason: string }
  | { kind: "experiment"; config: ExperimentConfig };

export const EXPERIMENT_SETS: Record<ExperimentSetId, {
  label: string;
  core: readonly [string, string, string];
  optional: string;
}> = {
  easy: { label: "やさしい", core: ["q_03", "q_04", "q_05"], optional: "q_06" },
  standard: { label: "標準", core: ["q_03", "q_05", "q_02"], optional: "q_06" },
  challenge: { label: "挑戦", core: ["q_05", "q_02", "q_07"], optional: "q_01" },
};

export function parseExperimentRoute(search: string): ExperimentRoute {
  const query = new URLSearchParams(search);
  if (query.get("experiment") !== "1") return { kind: "normal" };
  const participantCode = query.get("participant")?.trim() ?? "";
  const setId = query.get("studySet");
  const feedback = query.get("studyFeedback");
  if (!/^[A-Za-z0-9_-]{3,32}$/.test(participantCode)) {
    return { kind: "invalid", reason: "参加者コードは英数字・_・-の3〜32文字で指定してください。" };
  }
  if (setId !== "easy" && setId !== "standard" && setId !== "challenge") {
    return { kind: "invalid", reason: "出題セットは easy・standard・challenge から指定してください。" };
  }
  if (feedback !== "praise" && feedback !== "neutral") {
    return { kind: "invalid", reason: "提示条件は praise または neutral を指定してください。" };
  }
  return {
    kind: "experiment",
    config: {
      participantCode,
      setId,
      feedbackCondition: feedback === "neutral" ? "neutral_summary" : "process_praise",
    },
  };
}

export function experimentProblemIds(config: ExperimentConfig): readonly string[] {
  const set = EXPERIMENT_SETS[config.setId];
  return [...set.core, set.optional];
}

export function experimentWorkspaceKey(config: ExperimentConfig): string {
  return `experiment_v1_${config.participantCode}_${config.setId}_${config.feedbackCondition}`;
}
