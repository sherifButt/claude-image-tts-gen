import { renderSpendText, summarize } from "../state/spend.js";
import { getProjectPath, getSessionPath, readProjectSession, readSession, } from "../state/store.js";
export async function sessionSpend(args = {}) {
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
