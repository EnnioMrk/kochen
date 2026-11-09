import { execFile } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { JobFailure } from "./errors";

export type RunOptions = {
  timeoutMs?: number;
  maxBuffer?: number;
  cwd?: string;
  input?: string;
};

export class MissingToolError extends Error {
  readonly tool: string;
  constructor(tool: string) {
    super(`tool_missing:${tool}`);
    this.name = "MissingToolError";
    this.tool = tool;
  }
}

export class ToolError extends Error {
  readonly tool: string;
  readonly code: number | null;
  constructor(tool: string, message: string, code: number | null = null) {
    super(`tool_failed:${tool}:${message}`);
    this.name = "ToolError";
    this.tool = tool;
    this.code = code;
  }
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Resolve a binary from PATH (or accept an absolute path). */
export async function resolveTool(command: string): Promise<string | null> {
  if (command.includes("/")) {
    return (await isExecutable(command)) ? command : null;
  }
  const paths = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const dir of paths) {
    const candidate = join(dir, command);
    if (await isExecutable(candidate)) return candidate;
  }
  return null;
}

export async function requireTool(command: string): Promise<string> {
  const resolved = await resolveTool(command);
  if (!resolved) throw new MissingToolError(command);
  return resolved;
}

/** Run an external binary without a shell. Throws MissingToolError / ToolError. */
export async function run(
  command: string,
  args: string[],
  options: RunOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  const binary = await requireTool(command);
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      args,
      {
        timeout: options.timeoutMs ?? 120_000,
        maxBuffer: options.maxBuffer ?? 32 * 1024 * 1024,
        cwd: options.cwd,
        encoding: "utf8",
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          const code = typeof error.code === "number" ? error.code : null;
          const message = (stderr || error.message || "command_failed").slice(0, 2000);
          reject(new ToolError(command, message, code));
          return;
        }
        resolve({ stdout: stdout ?? "", stderr: stderr ?? "" });
      },
    );
  });
}

/** Spawn a process and wait for the exit code without buffering stdout. */
export async function runQuiet(
  command: string,
  args: string[],
  options: RunOptions = {},
): Promise<void> {
  await run(command, args, options);
}

/**
 * Run a tool, turning a missing binary into a user-facing German failure
 * instead of a crash.
 */
export async function runOrFail(
  command: string,
  args: string[],
  missingMessage: string,
  options: RunOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  try {
    return await run(command, args, options);
  } catch (error) {
    if (error instanceof MissingToolError) {
      throw new JobFailure("tool_missing", missingMessage);
    }
    throw error;
  }
}
