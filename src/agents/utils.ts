import { execSync } from "node:child_process";

/**
 * Resolve the path to the Claude Code executable.
 * Needed because the agent SDK can't find it when CLAUDECODE env is unset
 * (which we must do to avoid "nested session" errors).
 */
let _claudePath: string | undefined;

export function getClaudePath(): string {
  if (_claudePath) return _claudePath;
  try {
    _claudePath = execSync("which claude", { stdio: "pipe" }).toString().trim();
  } catch {
    _claudePath = "claude"; // fallback, hope it's in PATH
  }
  return _claudePath;
}
