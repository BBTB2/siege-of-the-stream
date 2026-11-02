import { randomUUID } from "node:crypto";
import { chmod, readFile, rename, unlink, writeFile } from "node:fs/promises";

export interface StoredTokens {
  clientId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
}

export async function readTokens(
  path: string,
): Promise<StoredTokens | undefined> {
  try {
    const data: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!data || typeof data !== "object") return;
    const candidate = data as Partial<StoredTokens>;
    if (
      typeof candidate.clientId !== "string" ||
      typeof candidate.accessToken !== "string" ||
      typeof candidate.refreshToken !== "string" ||
      !candidate.accessToken ||
      !candidate.refreshToken ||
      typeof candidate.expiresAt !== "number" ||
      !Number.isFinite(candidate.expiresAt) ||
      !Array.isArray(candidate.scopes) ||
      candidate.scopes.some((scope) => typeof scope !== "string")
    )
      return;
    await chmod(path, 0o600);
    return candidate as StoredTokens;
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === "ENOENT" ||
      error instanceof SyntaxError
    )
      return;
    throw new Error("Cannot read the local Twitch token file.");
  }
}

/** Atomic replacement preserves the latest one-use refresh token on restart. */
export async function writeTokens(
  path: string,
  tokens: StoredTokens,
): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(tokens), {
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporary, path);
  } catch {
    await unlink(temporary).catch(() => undefined);
    throw new Error("Cannot save the local Twitch token file.");
  }
}

export async function discardTokens(path: string): Promise<void> {
  await unlink(path).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      throw new Error("Cannot clear rejected Twitch credentials.");
  });
}
