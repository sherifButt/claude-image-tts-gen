import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import lockfile from "proper-lockfile";
import { renderSpendText, summarize } from "./spend.js";
import { getStateDir, readSession } from "./store.js";
const DEFAULT_BUDGET = {
    daily: 5.0,
    weekly: null,
    monthly: null,
    currency: "USD",
    softThreshold: 0.8,
};
export function getBudgetPath() {
    return join(getStateDir(), "budget.json");
}
async function ensureBudgetFile(filePath) {
    if (existsSync(filePath))
        return;
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(DEFAULT_BUDGET, null, 2) + "\n", "utf8");
}
async function withLock(filePath, fn) {
    await ensureBudgetFile(filePath);
    const release = await lockfile.lock(filePath, {
        retries: { retries: 10, minTimeout: 50, maxTimeout: 500 },
        stale: 5000,
    });
    try {
        return await fn();
    }
    finally {
        await release();
    }
}
export async function readBudget() {
    const filePath = getBudgetPath();
    await ensureBudgetFile(filePath);
    const raw = await readFile(filePath, "utf8");
    return { ...DEFAULT_BUDGET, ...JSON.parse(raw) };
}
export async function writeBudget(updates) {
    const filePath = getBudgetPath();
    return withLock(filePath, async () => {
        const current = await readBudget();
        const merged = { ...current, ...updates };
        await writeFile(filePath, JSON.stringify(merged, null, 2) + "\n", "utf8");
        return merged;
    });
}
export async function checkBudget(addCost) {
    if (addCost <= 0)
        return { block: null, warning: null };
    const budget = await readBudget();
    const session = await readSession();
    const summary = summarize(session);
    const periods = [
        { period: "daily", cap: budget.daily, current: summary.totals.today.cost },
        { period: "weekly", cap: budget.weekly, current: summary.totals.thisWeek.cost },
        { period: "monthly", cap: budget.monthly, current: summary.totals.thisMonth.cost },
    ];
    let block = null;
    let warning = null;
    for (const { period, cap, current } of periods) {
        if (cap === null)
            continue;
        const projected = roundUsd(current + addCost);
        const pctUsed = projected / cap;
        if (projected > cap && !block) {
            block = {
                period,
                cap,
                currentSpend: current,
                projectedSpend: projected,
                pctUsed,
                threshold: budget.softThreshold,
                currency: budget.currency,
                reason: "would_exceed_cap",
            };
        }
        else if (pctUsed >= budget.softThreshold && !warning) {
            warning = {
                period,
                cap,
                currentSpend: current,
                projectedSpend: projected,
                pctUsed,
                threshold: budget.softThreshold,
                currency: budget.currency,
            };
        }
    }
    return { block, warning };
}
export function formatBudgetBlockError(block) {
    return (`Budget cap exceeded: ${block.period} cap is ` +
        `${block.currency} ${block.cap.toFixed(2)}, current spend ${block.currency} ${block.currentSpend.toFixed(4)}, ` +
        `projected ${block.currency} ${block.projectedSpend.toFixed(4)} would exceed it. ` +
        `Adjust cap with set_budget or wait for the period to reset.`);
}
export function formatBudgetWarning(w) {
    return (`Budget warning: ${(w.pctUsed * 100).toFixed(0)}% of ${w.period} cap used ` +
        `(${w.currency} ${w.projectedSpend.toFixed(4)} / ${w.currency} ${w.cap.toFixed(2)}).`);
}
export function renderBudgetText(budget) {
    const fmt = (v) => (v === null ? "(no cap)" : `${budget.currency} ${v.toFixed(2)}`);
    return [
        `Budget caps:`,
        `  daily:   ${fmt(budget.daily)}`,
        `  weekly:  ${fmt(budget.weekly)}`,
        `  monthly: ${fmt(budget.monthly)}`,
        `  soft warning threshold: ${(budget.softThreshold * 100).toFixed(0)}%`,
    ].join("\n");
}
function roundUsd(n) {
    return Math.round(n * 1_000_000) / 1_000_000;
}
// re-export to avoid unused import warning when only renderSpendText/summarize are used elsewhere
export { renderSpendText, summarize };
