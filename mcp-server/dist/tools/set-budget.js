import { renderBudgetText, writeBudget } from "../state/budget.js";
export async function setBudget(args) {
    const updates = {};
    if (args.daily !== undefined)
        updates.daily = args.daily;
    if (args.weekly !== undefined)
        updates.weekly = args.weekly;
    if (args.monthly !== undefined)
        updates.monthly = args.monthly;
    if (args.softThreshold !== undefined) {
        if (args.softThreshold < 0 || args.softThreshold > 1) {
            throw new Error("softThreshold must be between 0 and 1");
        }
        updates.softThreshold = args.softThreshold;
    }
    const budget = await writeBudget(updates);
    return {
        success: true,
        budget,
        text: renderBudgetText(budget),
    };
}
