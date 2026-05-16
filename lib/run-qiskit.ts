import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface RunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  parsed?: unknown;
  durationMs: number;
}

const MAX_OUTPUT_BYTES = 64 * 1024;
const TIMEOUT_MS = 60_000;

/**
 * Pythonインタプリタを子プロセスで起動し、渡されたQiskitコードを実行する。
 * stdoutの最後のJSON-likeな行をparseして parsed に格納する。
 *
 * 注: PoCではホストのPythonを直接呼ぶ。本番ではVercel Sandboxに置換する。
 */
export async function runQiskit(code: string): Promise<RunResult> {
  const started = Date.now();
  const dir = await mkdtemp(join(tmpdir(), "namekoq-"));
  const file = join(dir, "main.py");
  await writeFile(file, code, "utf8");

  const python = process.env.PYTHON_BIN ?? "python3";

  try {
    const result = await new Promise<RunResult>((resolve) => {
      const child = spawn(python, [file], {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
      });

      let stdout = "";
      let stderr = "";
      let killed = false;

      const timer = setTimeout(() => {
        killed = true;
        child.kill("SIGKILL");
      }, TIMEOUT_MS);

      child.stdout.on("data", (chunk) => {
        if (stdout.length < MAX_OUTPUT_BYTES) {
          stdout += chunk.toString("utf8");
        }
      });
      child.stderr.on("data", (chunk) => {
        if (stderr.length < MAX_OUTPUT_BYTES) {
          stderr += chunk.toString("utf8");
        }
      });

      child.on("close", (exitCode) => {
        clearTimeout(timer);
        const durationMs = Date.now() - started;
        const parsed = extractJsonTail(stdout);
        const ok = exitCode === 0 && !killed;
        resolve({
          ok,
          stdout: stdout.slice(-MAX_OUTPUT_BYTES),
          stderr: killed
            ? stderr + `\n[killed: exceeded ${TIMEOUT_MS / 1000}s timeout]`
            : stderr.slice(-MAX_OUTPUT_BYTES),
          parsed,
          durationMs,
        });
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        resolve({
          ok: false,
          stdout,
          stderr:
            stderr +
            `\n[spawn error: ${err.message}. Is python3 installed? Set PYTHON_BIN env to override.]`,
          durationMs: Date.now() - started,
        });
      });
    });
    return result;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * stdoutの最後の行に出力されたJSON-likeなdictをパースする。
 * Pythonの dict は シングルクォートを使うので、JSON互換に正規化を試みる。
 */
function extractJsonTail(stdout: string): unknown {
  const lines = stdout.trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith("{") || !line.endsWith("}")) continue;
    try {
      return JSON.parse(line);
    } catch {
      // Python dict ('foo': 1) → JSON ("foo": 1) を雑に試す
      const normalized = line
        .replace(/'/g, '"')
        .replace(/\bTrue\b/g, "true")
        .replace(/\bFalse\b/g, "false")
        .replace(/\bNone\b/g, "null");
      try {
        return JSON.parse(normalized);
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}
