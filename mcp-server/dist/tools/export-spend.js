import { readSession } from "../state/store.js";
import { StructuredError } from "../util/errors.js";
export async function exportSpend(args = {}) {
    const format = args.format ?? "csv";
    if (format !== "csv" && format !== "json") {
        throw new StructuredError("VALIDATION_ERROR", `Invalid format "${args.format}"`, "Use format='csv' or format='json'.");
    }
    if (args.month !== undefined && !/^\d{4}-\d{2}$/.test(args.month)) {
        throw new StructuredError("VALIDATION_ERROR", `Invalid month "${args.month}"`, "Use month='YYYY-MM' (e.g. '2026-04').");
    }
    const session = await readSession();
    const filtered = args.month
        ? session.calls.filter((c) => c.ts.startsWith(args.month))
        : session.calls;
    const total = filtered.reduce((s, c) => s + c.cost, 0);
    const text = format === "csv" ? toCsv(filtered) : JSON.stringify(filtered, null, 2);
    return {
        success: true,
        format,
        rowCount: filtered.length,
        totalCost: roundUsd(total),
        currency: session.currency,
        text,
    };
}
function toCsv(calls) {
    const header = "timestamp,tool,modality,provider,model,tier,units,unit,price_per_unit,cost,batch,cached,project,project_path,files";
    const rows = calls.map((c) => [
        c.ts,
        c.tool,
        c.modality,
        c.provider,
        c.model,
        c.tier,
        String(c.units),
        c.unit,
        String(c.pricePerUnit),
        String(c.cost),
        c.isBatchPrice ? "yes" : "no",
        c.cached ? "yes" : "no",
        c.project ?? "",
        escapeCsv(c.projectPath ?? ""),
        escapeCsv(c.files.join(";")),
    ].join(","));
    return [header, ...rows].join("\n") + "\n";
}
function escapeCsv(s) {
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
}
function roundUsd(n) {
    return Math.round(n * 1_000_000) / 1_000_000;
}
