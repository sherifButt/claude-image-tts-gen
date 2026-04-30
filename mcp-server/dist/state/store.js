import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import lockfile from "proper-lockfile";
export function getStateDir() {
    return process.env.STATE_DIR ?? join(homedir(), ".claude-image-tts-gen");
}
export function getSessionPath() {
    return join(getStateDir(), "session.json");
}
export function getProjectKey(cwd = process.cwd()) {
    return createHash("sha1").update(cwd).digest("hex").slice(0, 10);
}
export function getProjectPath(cwd = process.cwd()) {
    return join(getStateDir(), "projects", `${getProjectKey(cwd)}.json`);
}
async function ensureSessionFile(filePath) {
    if (existsSync(filePath))
        return;
    await mkdir(dirname(filePath), { recursive: true });
    const empty = {
        startedAt: new Date().toISOString(),
        currency: "USD",
        totalCost: 0,
        callCount: 0,
        calls: [],
    };
    await writeFile(filePath, JSON.stringify(empty, null, 2) + "\n", "utf8");
}
async function withLock(filePath, fn) {
    await ensureSessionFile(filePath);
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
export async function readSession() {
    const filePath = getSessionPath();
    await ensureSessionFile(filePath);
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
}
export async function appendCall(entry) {
    // Stamp the entry with project info if not already set.
    if (entry.project === undefined)
        entry.project = getProjectKey();
    if (entry.projectPath === undefined)
        entry.projectPath = process.cwd();
    const filePath = getSessionPath();
    const session = await withLock(filePath, async () => {
        const raw = await readFile(filePath, "utf8");
        const session = JSON.parse(raw);
        session.calls.push(entry);
        session.callCount = session.calls.length;
        session.totalCost = roundUsd(session.totalCost + entry.cost);
        await writeFile(filePath, JSON.stringify(session, null, 2) + "\n", "utf8");
        return session;
    });
    // Mirror to per-project ledger (best-effort; doesn't block on failure).
    await appendToProject(entry).catch(() => undefined);
    return session;
}
async function ensureProjectFile(filePath) {
    if (existsSync(filePath))
        return;
    await mkdir(dirname(filePath), { recursive: true });
    const empty = {
        startedAt: new Date().toISOString(),
        currency: "USD",
        totalCost: 0,
        callCount: 0,
        calls: [],
    };
    await writeFile(filePath, JSON.stringify(empty, null, 2) + "\n", "utf8");
}
async function appendToProject(entry) {
    const filePath = getProjectPath(entry.projectPath ?? process.cwd());
    await ensureProjectFile(filePath);
    const release = await lockfile.lock(filePath, {
        retries: { retries: 10, minTimeout: 50, maxTimeout: 500 },
        stale: 5000,
    });
    try {
        const raw = await readFile(filePath, "utf8");
        const project = JSON.parse(raw);
        project.calls.push(entry);
        project.callCount = project.calls.length;
        project.totalCost = roundUsd(project.totalCost + entry.cost);
        await writeFile(filePath, JSON.stringify(project, null, 2) + "\n", "utf8");
    }
    finally {
        await release();
    }
}
export async function readProjectSession(cwd = process.cwd()) {
    const filePath = getProjectPath(cwd);
    await ensureProjectFile(filePath);
    return JSON.parse(await readFile(filePath, "utf8"));
}
function roundUsd(n) {
    return Math.round(n * 1_000_000) / 1_000_000;
}
