import type { AmpOptions } from "@ampcode/sdk";

export interface Values {
  prompt: string;
  executor: "runner" | "orb";
  runnerId: string;
  runnerDir: string;
  project: string;
  mode: string;
  customMode: string;
  effort: string;
  visibility: string;
  title: string;
  labels: string;
}

export function buildRequest(values: Values, cwd: string) {
  if (!values.prompt.trim()) throw new Error("Enter a prompt.");
  const mode =
    values.mode === "custom" ? values.customMode.trim() : values.mode;
  if (!mode) throw new Error("Enter a custom mode key.");
  if (values.executor === "runner" && !values.runnerId.trim()) {
    throw new Error("Enter a runner ID from Amp.");
  }
  const runnerDir = values.runnerDir.trim();
  if (values.executor === "runner" && runnerDir && !runnerDir.startsWith("/")) {
    throw new Error(
      "Use an absolute runner directory, not ~ or a relative path.",
    );
  }
  if (values.title.trim().length > 256)
    throw new Error("Keep the title to 256 characters or fewer.");
  const labels = values.labels
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean);
  if (
    labels.length > 20 ||
    labels.some(
      (label) => label.length > 32 || !/^[a-z0-9][a-z0-9-]*$/i.test(label),
    )
  ) {
    throw new Error(
      "Use up to 20 comma-separated labels, each at most 32 characters, with letters, numbers, and hyphens.",
    );
  }
  const options: AmpOptions = {
    cwd,
    executor: values.executor,
    mode,
    noArchiveAfterExecute: true,
    ...(values.executor === "runner"
      ? { runnerId: values.runnerId.trim(), ...(runnerDir && { runnerDir }) }
      : values.project.trim()
        ? { project: values.project.trim() }
        : {}),
    ...(values.effort && { effort: values.effort as AmpOptions["effort"] }),
    ...(values.visibility && {
      visibility: values.visibility as AmpOptions["visibility"],
    }),
    ...(values.title.trim() && { title: values.title.trim() }),
    ...(labels.length && { labels }),
  };
  return { prompt: values.prompt, options };
}

export type LaunchStatus = (
  | { state: "starting" }
  | { state: "running" | "complete"; threadId: string }
  | { state: "error"; message: string; threadId?: string }
) & { browserError?: string };
