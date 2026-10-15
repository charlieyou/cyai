import {
  Action,
  ActionPanel,
  Clipboard,
  Detail,
  Form,
  getPreferenceValues,
  environment,
  LocalStorage,
  showToast,
  Toast,
} from "@raycast/api";
import { useEffect, useRef, useState } from "react";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { buildRequest, type LaunchStatus, type Values } from "./options";

const defaults: Values = {
  prompt: "",
  executor: "orb",
  runnerId: "",
  runnerDir: "",
  project: "",
  mode: "medium",
  customMode: "",
  effort: "",
  visibility: "",
  title: "",
  labels: "",
};

export default function Command() {
  const preferences = getPreferenceValues<{
    apiKey?: string;
    defaultRunnerId?: string;
  }>();
  const ampEnvironment = {
    ...process.env,
    ...(preferences.apiKey?.trim() && {
      AMP_API_KEY: preferences.apiKey.trim(),
    }),
  };
  const [values, setValues] = useState<Values>(defaults);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [projects, setProjects] = useState<string[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsError, setProjectsError] = useState<string>();
  const [status, setStatus] = useState<LaunchStatus>();
  const [statusPath, setStatusPath] = useState<string>();
  const launching = useRef(false);
  const opened = useRef(false);

  async function loadProjects() {
    setProjectsLoading(true);
    setProjectsError(undefined);
    try {
      const { stdout } = await promisify(execFile)(
        join(environment.assetsPath, "amp"),
        ["projects", "list", "--json"],
        {
          cwd: homedir(),
          timeout: 15000,
          maxBuffer: 4 * 1024 * 1024,
          env: ampEnvironment,
        },
      );
      const listed: { namespace: string; name: string }[] = JSON.parse(stdout);
      if (
        !Array.isArray(listed) ||
        listed.some(
          (project) =>
            !project ||
            typeof project.namespace !== "string" ||
            typeof project.name !== "string",
        )
      ) {
        throw new Error("Amp returned an unexpected project list.");
      }
      setProjects(
        [
          ...new Set(
            listed.map((project) => `${project.namespace}/${project.name}`),
          ),
        ].sort(),
      );
    } catch (error) {
      setProjectsError(
        "Could not load projects. Check your Amp API Key in extension preferences, then use Refresh Projects in Actions.",
      );
      await showToast({
        style: Toast.Style.Failure,
        title: "Could not load Amp projects",
        message: String(error),
      });
    } finally {
      setProjectsLoading(false);
    }
  }

  useEffect(() => {
    void loadProjects();
  }, []);

  useEffect(() => {
    LocalStorage.getItem<string>("last-settings")
      .then((saved) => {
        setValues({
          ...defaults,
          runnerId: preferences.defaultRunnerId || "",
          ...(saved ? JSON.parse(saved) : {}),
          executor: "orb",
          mode: "medium",
        });
      })
      .catch(() => {
        setValues({ ...defaults, runnerId: preferences.defaultRunnerId || "" });
      })
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!statusPath) return;
    let disposed = false;
    let previousStatus: string | undefined;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const serialized = await readFile(statusPath!, "utf8");
        if (disposed) return;
        if (serialized === previousStatus) {
          timer = setTimeout(poll, 500);
          return;
        }
        previousStatus = serialized;
        const next: LaunchStatus = JSON.parse(serialized);
        setStatus(next);
        if ("threadId" in next && next.threadId && !opened.current) {
          opened.current = true;
          setBusy(false);
          await showToast({
            style: next.browserError
              ? Toast.Style.Failure
              : Toast.Style.Success,
            title: next.browserError
              ? "Thread created; browser did not open"
              : "Amp thread launched",
            message: next.browserError,
          });
        }
        if (next.state === "error") {
          setBusy(false);
          await showToast({
            style: Toast.Style.Failure,
            title: "Amp reported an error",
            message: next.message,
          });
          return;
        }
        if (next.state === "complete") return;
      } catch (error) {
        if (disposed) return;
        setBusy(false);
        await showToast({
          style: Toast.Style.Failure,
          title: "Cannot read launch status",
          message: String(error),
        });
        return;
      }
      if (!disposed) timer = setTimeout(poll, 500);
    }
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [statusPath]);

  function update(key: keyof Values, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function submit() {
    if (launching.current || !ready) return;
    let request;
    try {
      request = buildRequest(values, environment.supportPath);
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Check your settings",
        message: (error as Error).message,
      });
      return;
    }
    launching.current = true;
    setBusy(true);
    let input: string | undefined;
    try {
      const jobs = join(environment.supportPath, "launches");
      await mkdir(jobs, { recursive: true, mode: 0o700 });
      const id = randomUUID();
      input = join(jobs, `${id}.request.json`);
      const output = join(jobs, `${id}.status.json`);
      await writeFile(input, JSON.stringify(request), { mode: 0o600 });
      await writeFile(output, JSON.stringify({ state: "starting" }), {
        mode: 0o600,
      });
      await LocalStorage.setItem(
        "last-settings",
        JSON.stringify({ ...values, prompt: "", title: "" }),
      );
      const child = spawn(
        process.execPath,
        [join(environment.assetsPath, "launch-worker.mjs"), input, output],
        {
          detached: true,
          stdio: "ignore",
          env: ampEnvironment,
        },
      );
      await new Promise<void>((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
      child.once("exit", async () => {
        try {
          const latest: LaunchStatus = JSON.parse(
            await readFile(output, "utf8"),
          );
          if (latest.state === "starting" || latest.state === "running") {
            await writeFile(
              `${output}.tmp`,
              JSON.stringify({
                ...latest,
                state: "error",
                message:
                  "The launch worker stopped unexpectedly. Check Amp before retrying.",
              }),
              { mode: 0o600 },
            );
            await rename(`${output}.tmp`, output);
          }
        } catch {
          await showToast({
            style: Toast.Style.Failure,
            title: "Cannot read final launch status",
            message: "Check Amp before retrying.",
          });
        }
      });
      child.unref();
      setStatus({ state: "starting" });
      setStatusPath(output);
    } catch (error) {
      if (input) await unlink(input).catch(() => {});
      setBusy(false);
      launching.current = false;
      await showToast({
        style: Toast.Style.Failure,
        title: "Could not start Amp",
        message: String(error),
      });
    }
  }

  if (statusPath) {
    const threadId =
      status && "threadId" in status ? status.threadId : undefined;
    const url = threadId
      ? `https://ampcode.com/threads/${threadId}`
      : undefined;
    const text =
      status?.state === "error"
        ? `Amp reported an error.\n\n${status.message}\n\nCheck Amp before retrying; a thread may already exist.`
        : url
          ? `Your thread is ${status?.state === "complete" ? "ready" : "running"} in Amp. You can close Raycast.\n\n${url}`
          : "Starting Amp…\n\nThe browser will open when Amp returns the thread ID. The launch continues if you close Raycast.";
    return (
      <Detail
        isLoading={busy}
        navigationTitle="Amp Thread"
        markdown={text}
        actions={
          url ? (
            <ActionPanel>
              <Action.OpenInBrowser title="Open Thread" url={url} />
              <Action
                title="Copy Thread Link"
                onAction={() => Clipboard.copy(url)}
              />
            </ActionPanel>
          ) : undefined
        }
      />
    );
  }

  return (
    <Form
      isLoading={!ready || busy}
      navigationTitle="Start Amp Thread"
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Start Thread" onSubmit={submit} />
          <Action title="Refresh Projects" onAction={loadProjects} />
        </ActionPanel>
      }
    >
      <Form.TextArea
        id="prompt"
        title="Prompt"
        placeholder="What should Amp do?"
        value={values.prompt}
        onChange={(v) => update("prompt", v)}
        autoFocus
      />
      <Form.Dropdown
        id="executor"
        title="Run On"
        value={values.executor}
        onChange={(v) => update("executor", v)}
      >
        <Form.Dropdown.Item value="orb" title="Amp Orb" />
        <Form.Dropdown.Item value="runner" title="Connected Runner" />
      </Form.Dropdown>
      {values.executor === "runner" ? (
        <>
          <Form.TextField
            id="runnerId"
            title="Runner ID"
            value={values.runnerId}
            onChange={(v) => update("runnerId", v)}
            info="Copy the ID from Amp's runner picker. The runner must be online."
          />
          <Form.TextField
            id="runnerDir"
            title="Directory"
            placeholder="Runner's default directory"
            value={values.runnerDir}
            onChange={(v) => update("runnerDir", v)}
            info="Absolute path served by this runner, for example /Users/you/code/app. Runner threads use this checkout rather than an orb project."
          />
        </>
      ) : (
        <Form.Dropdown
          id="project"
          title="Project"
          isLoading={projectsLoading}
          value={values.project}
          onChange={(v) => update("project", v)}
          info={
            projectsError ||
            "Search projects available to your Amp account. No Project starts an orb without a repository."
          }
        >
          <Form.Dropdown.Item value="" title="No Project" />
          {values.project && !projects.includes(values.project) && (
            <Form.Dropdown.Item
              value={values.project}
              title={`${values.project} (Saved)`}
            />
          )}
          {projects.map((project) => (
            <Form.Dropdown.Item key={project} value={project} title={project} />
          ))}
        </Form.Dropdown>
      )}
      <Form.Dropdown
        id="mode"
        title="Mode"
        value={values.mode}
        onChange={(v) => update("mode", v)}
      >
        {["low", "medium", "high", "ultra"].map((mode) => (
          <Form.Dropdown.Item key={mode} value={mode} title={mode} />
        ))}
        <Form.Dropdown.Item value="custom" title="Custom Mode…" />
      </Form.Dropdown>
      {values.mode === "custom" && (
        <Form.TextField
          id="customMode"
          title="Mode Key"
          placeholder="e.g. claude-opus-5-5"
          value={values.customMode}
          onChange={(v) => update("customMode", v)}
          info="The mode must be available on the selected executor."
        />
      )}
      <Form.Separator />
      <Form.Dropdown
        id="effort"
        title="Reasoning Effort"
        value={values.effort}
        onChange={(v) => update("effort", v)}
      >
        <Form.Dropdown.Item value="" title="Mode Default" />
        {["none", "minimal", "low", "medium", "high", "xhigh", "max"].map(
          (effort) => (
            <Form.Dropdown.Item key={effort} value={effort} title={effort} />
          ),
        )}
      </Form.Dropdown>
      <Form.Dropdown
        id="visibility"
        title="Visibility"
        value={values.visibility}
        onChange={(v) => update("visibility", v)}
      >
        <Form.Dropdown.Item value="" title="Amp Default" />
        <Form.Dropdown.Item value="private" title="Private" />
        <Form.Dropdown.Item value="workspace" title="Workspace" />
        <Form.Dropdown.Item
          value="unlisted"
          title="Unlisted — Anyone With the Link"
        />
      </Form.Dropdown>
      <Form.TextField
        id="title"
        title="Title"
        placeholder="Let Amp choose"
        value={values.title}
        onChange={(v) => update("title", v)}
      />
      <Form.TextField
        id="labels"
        title="Labels"
        placeholder="bugfix, frontend"
        value={values.labels}
        onChange={(v) => update("labels", v)}
      />
    </Form>
  );
}
