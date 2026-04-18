import { renderSpendText, summarize } from "../state/spend.js";
import {
  getProjectPath,
  getSessionPath,
  readProjectSession,
  readSession,
} from "../state/store.js";
import type { SpendSummary } from "../state/types.js";

export interface SessionSpendArgs {
  /** When true, scope to the current project instead of the global session. */
  project?: boolean;
}

export interface SessionSpendOutput {
  success: true;
  scope: "global" | "project";
  sessionPath: string;
  summary: SpendSummary;
  text: string;
}

export async function sessionSpend(args: SessionSpendArgs = {}): Promise<SessionSpendOutput> {
  const useProject = args.project === true;
  const session = useProject ? await readProjectSession() : await readSession();
  const summary = summarize(session);
  const sessionPath = useProject ? getProjectPath() : getSessionPath();
  const scopeLabel = useProject ? `Project: ${process.cwd()}\n` : "";
  return {
    success: true,
    scope: useProject ? "project" : "global",
    sessionPath,
    summary,
    text: scopeLabel + renderSpendText(summary),
  };
}
