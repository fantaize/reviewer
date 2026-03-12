export type Severity = "normal" | "nit" | "pre-existing";

export type Category = "bug" | "security" | "style" | "performance";

export interface Finding {
  id: string;
  file: string;
  startLine: number;
  endLine: number;
  severity: Severity;
  category: Category;
  title: string;
  summary: string;
  description: string;
  reasoning: string;
  suggestedFix?: string;
  confidence?: number;
  agentSource: string;
}

export interface VerifiedFinding extends Finding {
  confidence: number;
  verifierReasoning: string;
}

export interface AgentResult {
  agentName: string;
  findings: Finding[];
  duration: number;
  error?: string;
}

export interface ChangedFile {
  filename: string;
  status: "added" | "modified" | "removed" | "renamed";
  additions: number;
  deletions: number;
  patch?: string;
}

export interface ReviewConfig {
  rules: string[];
  ignorePatterns: string[];
  customInstructions: string;
  confidenceThreshold: number;
  /** Hierarchical CLAUDE.md instructions keyed by directory path */
  claudeMdFiles: ClaudeMdEntry[];
}

export interface ClaudeMdEntry {
  /** Directory path relative to repo root (empty string for root) */
  path: string;
  /** Raw markdown content */
  content: string;
}

export interface ModelConfig {
  model: string;
  effort: "low" | "medium" | "high" | "max";
  apiKey?: string;
  verifierModel?: string;
}

export interface PRContext {
  owner: string;
  repo: string;
  pullNumber: number;
  title: string;
  body: string;
  baseSha: string;
  headSha: string;
  diff: string;
  changedFiles: ChangedFile[];
  reviewConfig: ReviewConfig;
  installationId: number;
  repoDir?: string;
  modelConfig: ModelConfig;
}
