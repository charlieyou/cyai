import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { promisify } from "node:util";
import { buildRequest, type LaunchStatus, type Values } from "./options";

test("bundled runtime runs without any CLI on PATH", async () => {
  const { stdout } = await promisify(execFile)(
    join(process.cwd(), "assets/amp"),
    ["--version"],
    {
      env: { ...process.env, PATH: "" },
      timeout: 10000,
    },
  );
  assert.match(stdout, /\d+\.\d+\./);
});

const values: Values = {
  prompt:
    "Inspect 'quotes', $HOME and $(touch /tmp/should-not-exist)\nwithout changing files.",
  executor: "runner",
  runnerId: " runner-123 ",
  runnerDir: "/srv/project with spaces",
  project: "stale/project",
  mode: "custom",
  customMode: " my-mode ",
  effort: "high",
  visibility: "private",
  title: "Check configuration",
  labels: "review, bug-fix",
};

test("runner and orb selections cannot leak each other's hidden fields", () => {
  assert.deepEqual(buildRequest(values, "/tmp").options, {
    cwd: "/tmp",
    executor: "runner",
    runnerId: "runner-123",
    runnerDir: "/srv/project with spaces",
    mode: "my-mode",
    effort: "high",
    visibility: "private",
    title: "Check configuration",
    labels: ["review", "bug-fix"],
    noArchiveAfterExecute: true,
  });
  const orb = buildRequest(
    { ...values, executor: "orb", mode: "medium", project: "team/app" },
    "/tmp",
  );
  assert.equal(orb.options.project, "team/app");
  assert.equal(orb.options.mode, "medium");
  assert.equal("runnerId" in orb.options, false);
  assert.equal("runnerDir" in orb.options, false);
  assert.equal(
    buildRequest({ ...values, executor: "orb", project: "" }, "/tmp").options
      .project,
    undefined,
  );
  const minimal = buildRequest(
    {
      ...values,
      runnerDir: "",
      effort: "",
      visibility: "",
      title: "",
      labels: "",
    },
    "/tmp",
  );
  for (const field of ["runnerDir", "effort", "visibility", "title", "labels"])
    assert.equal(field in minimal.options, false);
});

test("invalid submissions fail before creating any thread", () => {
  for (const change of [
    { prompt: "  " },
    { runnerId: "" },
    { runnerDir: "~/repo" },
    { customMode: " " },
    { title: "x".repeat(257) },
    { labels: "bad label" },
    { labels: "x".repeat(33) },
  ]) {
    assert.throws(() => buildRequest({ ...values, ...change }, "/tmp"));
  }
  assert.doesNotThrow(() =>
    buildRequest(
      { ...values, title: "x".repeat(256), labels: "x".repeat(32) },
      "/tmp",
    ),
  );
});

const fixture = `
import { readFileSync, writeFileSync } from 'node:fs';
if (process.argv.includes('--version')) { console.log('0.0.0-20261015000000-gabcdef'); process.exit(0); }
const prompt = readFileSync(0, 'utf8');
writeFileSync(process.env.CAPTURE_PATH, JSON.stringify({ args: process.argv.slice(2), prompt, cwd: process.cwd() }));
const session_id = 'T-12345678-1234-1234-1234-123456789abc';
if (process.env.FAIL_BEFORE_INIT) { console.error('Runner is offline'); process.exit(1); }
console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id, cwd: '/srv/project with spaces', tools: [], mcp_servers: [] }));
setTimeout(() => {
  console.log(JSON.stringify(process.env.FAIL_AFTER_INIT
    ? { type: 'result', subtype: 'error_during_execution', session_id, is_error: true, error: 'Remote task failed' }
    : { type: 'result', subtype: 'success', session_id, is_error: false, result: 'Done' }));
}, 900);
`;

for (const { failure, selection } of [
  ...["", "FAIL_BEFORE_INIT", "FAIL_AFTER_INIT"].map((failure) => ({
    failure,
    selection: values,
  })),
  ...["team/app", ""].map((project) => ({
    failure: "",
    selection: { ...values, executor: "orb" as const, mode: "medium", project },
  })),
]) {
  test(`SDK worker survives launcher exit: ${selection.executor} ${selection.project} ${failure || "success"}`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "amp-raycast-test-"));
    try {
      const worker = join(directory, "worker.mjs");
      const cli = join(directory, "amp");
      const input = join(directory, "request.json");
      const output = join(directory, "status.json");
      const capture = join(directory, "capture.json");
      await copyFile(join(process.cwd(), "assets/launch-worker.mjs"), worker);
      await writeFile(cli, `#!${process.execPath}\n${fixture}`);
      await chmod(cli, 0o755);
      await writeFile(
        input,
        JSON.stringify(buildRequest(selection, directory)),
        {
          mode: 0o600,
        },
      );
      const parent = spawn(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `
        import { spawn } from 'node:child_process';
        const child = spawn(process.execPath, process.argv.slice(1), { detached: true, stdio: 'ignore' });
        child.unref();
      `,
          worker,
          input,
          output,
        ],
        {
          env: {
            ...process.env,
            PATH: "",
            AMP_CLI_PATH: "/must-not-use-a-separate-cli",
            CAPTURE_PATH: capture,
            ...(failure && { [failure]: "1" }),
          },
          stdio: "ignore",
        },
      );
      await new Promise<void>((resolve, reject) => {
        parent.on("error", reject);
        parent.on("exit", (code) =>
          code === 0 ? resolve() : reject(new Error(`Launcher exited ${code}`)),
        );
      });
      let final: LaunchStatus | undefined;
      let sawRunning = false;
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        try {
          final = JSON.parse(await readFile(output, "utf8"));
        } catch {}
        if (final?.state === "running") sawRunning = true;
        if (final?.state === "complete" || final?.state === "error") break;
        await delay(50);
      }
      assert.ok(final, "Worker must return a status");
      if (failure) {
        assert.equal(final.state, "error");
        if (final.state === "error") {
          assert.match(
            final.message,
            failure === "FAIL_BEFORE_INIT"
              ? /Runner is offline/
              : /Remote task failed/,
          );
          assert.equal(Boolean(final.threadId), failure === "FAIL_AFTER_INIT");
        }
      } else {
        assert.deepEqual(final, {
          state: "complete",
          threadId: "T-12345678-1234-1234-1234-123456789abc",
        });
        assert.ok(
          sawRunning,
          "Thread link must be available before execution ends",
        );
      }
      await assert.rejects(stat(input), { code: "ENOENT" });
      assert.equal((await stat(output)).mode & 0o777, 0o600);
      const sent = JSON.parse(await readFile(capture, "utf8"));
      assert.equal(sent.prompt, `${values.prompt}\n`);
      assert.equal(sent.cwd, await realpath(directory));
      assert.deepEqual(sent.args, [
        "--execute",
        "--stream-json",
        ...(selection.executor === "runner"
          ? [
              "--executor",
              "runner:runner-123",
              "--runner-dir",
              "/srv/project with spaces",
            ]
          : [
              "--orb-execute",
              ...(selection.project ? ["--project", "team/app"] : []),
            ]),
        "--no-archive-after-execute",
        "--visibility",
        "private",
        "--mode",
        selection.executor === "runner" ? "my-mode" : "medium",
        "--effort",
        "high",
        "--label",
        "review",
        "--label",
        "bug-fix",
        "--title",
        "Check configuration",
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}
