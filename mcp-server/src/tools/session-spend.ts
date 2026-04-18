import { renderSpendText, summarize } from "../state/spend.js";
import { getSessionPath, readSession } from "../state/store.js";
import type { SpendSummary } from "../state/types.js";

export interface SessionSpendOutput {
  success: true;
  sessionPath: string;
  summary: SpendSummary;
  text: string;
}

export async function sessionSpend(): Promise<SessionSpendOutput> {
  const session = await readSession();
  const summary = summarize(session);
  return {
    success: true,
    sessionPath: getSessionPath(),
    summary,
    text: renderSpendText(summary),
  };
}
