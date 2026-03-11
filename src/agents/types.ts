export type Severity = "critical" | "warning" | "nit" | "pre-existing";

export type Category = "bug" | "security" | "style" | "performance";

export interface Finding {
  id: string;
  file: string;
  startLine: number;
  endLine: number;
  severity: Severity;
  category: Category;
  title: string;
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
}

export interface ModelConfig {
  model: string;
  effort: "low" | "medium" | "high" | "max";
  apiKey?: string;
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
