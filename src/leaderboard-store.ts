import { readFileSync } from "node:fs";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import type { Leader } from "./game/model.js";

const maximum = Number.MAX_SAFE_INTEGER;
const sum = (a: number, b: number) => Math.min(maximum, a + b);
const score = (leader: Pick<Leader, "damage" | "heals" | "blocks">) =>
  Math.min(maximum, leader.damage + leader.heals + leader.blocks * 25);

function validate(value: unknown): Leader {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid leaderboard entry.");
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    !/^viewer:[^\x00-\x1f]{1,64}$/.test(row.id) ||
    typeof row.username !== "string" ||
    !row.username.trim() ||
    row.username.length > 25 ||
    /[\x00-\x1f]/.test(row.username)
  )
    throw new Error("Invalid leaderboard identity.");
  for (const field of ["damage", "heals", "blocks", "score"])
    if (!Number.isSafeInteger(row[field]) || (row[field] as number) < 0)
      throw new Error("Invalid leaderboard totals.");
  const leader: Leader = {
    id: row.id,
    username: row.username,
    damage: row.damage as number,
    heals: row.heals as number,
    blocks: row.blocks as number,
    score: row.score as number,
  };
  if (leader.score !== score(leader))
    throw new Error("Invalid leaderboard score.");
  return leader;
}

function entries(values: unknown[]): Map<string, Leader> {
  const result = new Map<string, Leader>();
  for (const value of values) {
    const leader = validate(value);
    if (result.has(leader.id))
      throw new Error("Duplicate leaderboard identity.");
    result.set(leader.id, leader);
  }
  return result;
}

async function atomicWrite(path: string, contents: string) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(temporary, contents, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

/** Disk I/O lives outside the pure engine; each completed round is added by its owner. */
export class LeaderboardStore {
  private leaders = new Map<string, Leader>();
  private pending = Promise.resolve();
  private error: string | undefined;

  constructor(private readonly path?: string) {
    if (!path) return;
    try {
      const data: unknown = JSON.parse(readFileSync(path, "utf8"));
      if (
        !data ||
        typeof data !== "object" ||
        !("version" in data) ||
        data.version !== 1 ||
        !("leaders" in data) ||
        !Array.isArray(data.leaders)
      )
        throw new Error("Invalid leaderboard document.");
      this.leaders = entries(data.leaders);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error(
          "Unable to load all-time leaderboard; existing file was preserved.",
        );
    }
  }

  get(): Leader[] {
    return [...this.leaders.values()]
      .map((leader) => ({ ...leader }))
      .sort(
        (a, b) =>
          b.score - a.score || b.damage - a.damage || a.id.localeCompare(b.id),
      );
  }

  addRound(leaders: Leader[]): void {
    const viewers = entries(
      leaders.filter((leader) => leader.id.startsWith("viewer:")),
    );
    const next = new Map(this.leaders);
    for (const [id, incoming] of viewers) {
      const previous = next.get(id);
      const totals = previous
        ? {
            ...incoming,
            damage: sum(previous.damage, incoming.damage),
            heals: sum(previous.heals, incoming.heals),
            blocks: sum(previous.blocks, incoming.blocks),
          }
        : incoming;
      next.set(id, { ...totals, score: score(totals) });
    }
    this.leaders = next;
    this.save();
  }

  reset(): void {
    this.leaders = new Map();
    this.save();
  }

  getError(): string | undefined {
    return this.error;
  }

  async flush(): Promise<void> {
    await this.pending;
    if (this.error) throw new Error(this.error);
  }

  private save(): void {
    const path = this.path;
    if (!path) return;
    const contents = JSON.stringify({ version: 1, leaders: this.get() });
    this.pending = this.pending.then(async () => {
      try {
        await atomicWrite(path, contents);
        this.error = undefined;
      } catch {
        // Keep the chain fulfilled: later saves can recover without unhandled rejections.
        this.error = "Unable to save all-time leaderboard.";
      }
    });
  }
}
