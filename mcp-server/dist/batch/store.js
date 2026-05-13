import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import lockfile from "proper-lockfile";
import { getStateDir } from "../state/store.js";
export function getBatchDir() {
    return join(getStateDir(), "batch");
}
export function getBatchPath(jobId) {
    return join(getBatchDir(), `${jobId}.json`);
}
export function newJobId() {
    return randomUUID().slice(0, 8);
}
async function ensureFile(filePath) {
    if (existsSync(filePath))
        return;
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, "{}", "utf8");
}
async function withLock(filePath, fn) {
    await ensureFile(filePath);
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
export async function saveJob(job) {
    const filePath = getBatchPath(job.jobId);
    await withLock(filePath, async () => {
        await writeFile(filePath, JSON.stringify(job, null, 2) + "\n", "utf8");
    });
}
export async function loadJob(jobId) {
    const filePath = getBatchPath(jobId);
    if (!existsSync(filePath)) {
        throw new Error(`No batch job with id "${jobId}" at ${filePath}`);
    }
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
}
export async function updateJob(jobId, updater) {
    const filePath = getBatchPath(jobId);
    return withLock(filePath, async () => {
        const raw = await readFile(filePath, "utf8");
        const current = JSON.parse(raw);
        const next = { ...updater(current), updatedAt: new Date().toISOString() };
        await writeFile(filePath, JSON.stringify(next, null, 2) + "\n", "utf8");
        return next;
    });
}
export async function listJobs() {
    const dir = getBatchDir();
    if (!existsSync(dir))
        return [];
    const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
    const jobs = [];
    for (const file of files) {
        try {
            const raw = await readFile(join(dir, file), "utf8");
            jobs.push(JSON.parse(raw));
        }
        catch {
            // skip unreadable files
        }
    }
    return jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
