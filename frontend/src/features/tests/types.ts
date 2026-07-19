import type { TestRunner } from "../../../bindings/ide/models";

export type TestStatus = "pending" | "running" | "passed" | "failed" | "skipped";

export type TestNode = {
  id: string;
  parentId: string;
  name: string;
  file: string;
  isSuite: boolean;
  status: TestStatus;
  durationMs: number;
  failure: string;
};

export type TestRunSummary = {
  runnerId: string;
  status: "running" | "completed" | "cancelled" | "error";
  startedAt: number;
  finishedAt: number;
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  error?: string;
};

export type RunnersPayload = { runners: TestRunner[] };
export type StartPayload = { summary: TestRunSummary };
export type TreePayload = { runnerId: string; nodes: TestNode[] };
export type UpdatePayload = { runnerId: string; node: TestNode };
export type LogPayload = { runnerId: string; chunk: string };
export type DonePayload = { summary: TestRunSummary };

export type { TestRunner };
