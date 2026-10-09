import { mkdir, readFile, rename, writeFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";

/** Values are exact serialized strings, making CAS safe across independent replicas. */
export interface DurableStore {
  get(key: string): Promise<string | null>;
  cas(key: string, previous: string | null, next: string): Promise<boolean>;
}
export class LocalStore implements DurableStore {
  constructor(private directory: string) {
    this.directory = resolve(directory);
  }
  private path(key: string) {
    return join(
      this.directory,
      createHash("sha256").update(key).digest("hex") + ".json",
    );
  }
  async get(key: string) {
    try {
      return await readFile(this.path(key), "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }
  async cas(key: string, previous: string | null, next: string) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const path = this.path(key),
      lock = path + ".lock";
    try {
      await mkdir(lock);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw e;
    }
    try {
      if ((await this.get(key)) !== previous) return false;
      const temp = path + "." + randomUUID();
      await writeFile(temp, next, { mode: 0o600 });
      await rename(temp, path);
      return true;
    } finally {
      await rm(lock, { recursive: true, force: true });
    }
  }
}
export class RedisStore implements DurableStore {
  constructor(
    private url: string,
    private token: string,
    private namespace = "slice",
  ) {
    if (new URL(url).protocol !== "https:")
      throw new Error("Redis REST requires HTTPS");
  }
  private async command(args: unknown[]) {
    const r = await fetch(this.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) throw new Error("Durable store unavailable");
    const d = (await r.json()) as { result: unknown; error?: string };
    if (d.error) throw new Error("Durable store command failed");
    return d.result;
  }
  async get(key: string) {
    return (await this.command(["GET", `${this.namespace}:${key}`])) as
      string | null;
  }
  async cas(key: string, previous: string | null, next: string) {
    const script =
      "local c=redis.call('GET',KEYS[1]); if (ARGV[1]=='0' and not c) or (ARGV[1]=='1' and c==ARGV[2]) then redis.call('SET',KEYS[1],ARGV[3]); return 1 else return 0 end";
    return (
      (await this.command([
        "EVAL",
        script,
        1,
        `${this.namespace}:${key}`,
        previous === null ? "0" : "1",
        previous ?? "",
        next,
      ])) === 1
    );
  }
}
export function storeFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): DurableStore {
  if (
    env.SLICE_STORE === "local" &&
    env.SLICE_ENV === "local" &&
    env.SLICE_DATA_DIR
  )
    return new LocalStore(env.SLICE_DATA_DIR);
  if (env.REDIS_REST_URL && env.REDIS_REST_TOKEN)
    return new RedisStore(
      env.REDIS_REST_URL,
      env.REDIS_REST_TOKEN,
      env.SLICE_STORE_NAMESPACE ?? "slice",
    );
  throw new Error(
    "Configure shared Redis REST, or explicit SLICE_ENV=local/SLICE_STORE=local/SLICE_DATA_DIR",
  );
}
