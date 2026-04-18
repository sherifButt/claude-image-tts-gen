import type { CallEntry, PeriodTotal, Session, SpendSummary } from "./types.js";

const RECENT_LIMIT = 10;

export function summarize(session: Session, now: Date = new Date()): SpendSummary {
  const todayStart = startOfUtcDay(now);
  const weekStart = startOfUtcWeek(now);
  const monthStart = startOfUtcMonth(now);

  const today: PeriodTotal = empty();
  const thisWeek: PeriodTotal = empty();
  const thisMonth: PeriodTotal = empty();
  const allTime: PeriodTotal = empty();
  const byProvider: Record<string, PeriodTotal> = {};
  const byTier: Record<string, PeriodTotal> = {};

  for (const call of session.calls) {
    const ts = new Date(call.ts);

    add(allTime, call);
    if (ts >= todayStart) add(today, call);
    if (ts >= weekStart) add(thisWeek, call);
    if (ts >= monthStart) add(thisMonth, call);

    if (!byProvider[call.provider]) byProvider[call.provider] = empty();
    add(byProvider[call.provider], call);

    if (!byTier[call.tier]) byTier[call.tier] = empty();
    add(byTier[call.tier], call);
  }

  const recentCalls = session.calls.slice(-RECENT_LIMIT).reverse();

  return {
    currency: session.currency,
    totals: { today, thisWeek, thisMonth, allTime },
    byProvider,
    byTier,
    recentCalls,
  };
}

export function formatTotal(t: PeriodTotal, currency: string): string {
  return `${currency} ${t.cost.toFixed(4)} (${t.callCount} calls)`;
}

export function renderSpendText(summary: SpendSummary): string {
  const c = summary.currency;
  const lines = [
    `Spend summary (${c}):`,
    `  today:      ${formatTotal(summary.totals.today, c)}`,
    `  this week:  ${formatTotal(summary.totals.thisWeek, c)}`,
    `  this month: ${formatTotal(summary.totals.thisMonth, c)}`,
    `  all time:   ${formatTotal(summary.totals.allTime, c)}`,
    ``,
    `By provider:`,
  ];
  for (const [provider, total] of Object.entries(summary.byProvider)) {
    lines.push(`  ${provider}: ${formatTotal(total, c)}`);
  }
  lines.push(``, `By tier:`);
  for (const [tier, total] of Object.entries(summary.byTier)) {
    lines.push(`  ${tier}: ${formatTotal(total, c)}`);
  }
  if (summary.recentCalls.length > 0) {
    lines.push(``, `Recent calls (newest first):`);
    for (const call of summary.recentCalls) {
      lines.push(
        `  ${call.ts}  ${call.provider}/${call.tier}  ${call.model}  ` +
          `${call.units}${call.unit === "image" ? "img" : "ch"}  ${c} ${call.cost.toFixed(4)}` +
          `${call.isBatchPrice ? " [batch]" : ""}` +
          `${call.cached ? " [cache]" : ""}`,
      );
    }
  }
  return lines.join("\n");
}

function add(target: PeriodTotal, call: CallEntry): void {
  target.cost = roundUsd(target.cost + call.cost);
  target.callCount += 1;
}

function empty(): PeriodTotal {
  return { cost: 0, callCount: 0 };
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function startOfUtcWeek(d: Date): Date {
  const day = startOfUtcDay(d);
  const dow = day.getUTCDay(); // 0 = Sunday
  const diff = (dow + 6) % 7; // make Monday the first day
  day.setUTCDate(day.getUTCDate() - diff);
  return day;
}

function startOfUtcMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function roundUsd(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
