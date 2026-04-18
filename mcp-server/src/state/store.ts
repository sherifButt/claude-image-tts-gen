import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import lockfile from "proper-lockfile";
import type { CallEntry, Session } from "./types.js";

export function getStateDir(): string {
  return process.env.STATE_DIR ?? join(homedir(), ".claude-image-tts-gen");
}

export function getSessionPath(): string {
  return join(getStateDir(), "session.json");
}

async function ensureSessionFile(filePath: string): Promise<void> {
  if (existsSync(filePath)) return;
  await mkdir(dirname(filePath), { recursive: true });
  const empty: Session = {
    startedAt: new Date().toISOString(),
    currency: "USD",
    totalCost: 0,
    callCount: 0,
    calls: [],
  };
  await writeFile(filePath, JSON.stringify(empty, null, 2) + "\n", "utf8");
}

async function withLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  await ensureSessionFile(filePath);
  const release = await lockfile.lock(filePath, {
    retries: { retries: 10, minTimeout: 50, maxTimeout: 500 },
    stale: 5000,
  });
  try {
    return await fn();
  } finally {
    await release();
  }
}

export async function readSession(): Promise<Session> {
  const filePath = getSessionPath();
  await ensureSessionFile(filePath);
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as Session;
}

export async function appendCall(entry: CallEntry): Promise<Session> {
  const filePath = getSessionPath();
  return withLock(filePath, async () => {
    const raw = await readFile(filePath, "utf8");
    const session = JSON.parse(raw) as Session;
    session.calls.push(entry);
    session.callCount = session.calls.length;
    session.totalCost = roundUsd(session.totalCost + entry.cost);
    await writeFile(filePath, JSON.stringify(session, null, 2) + "\n", "utf8");
    return session;
  });
}

function roundUsd(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
