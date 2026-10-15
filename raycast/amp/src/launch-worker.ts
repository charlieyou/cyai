import { execute, type ExecuteOptions } from "@ampcode/sdk";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { LaunchStatus } from "./options";

process.env.AMP_CLI_PATH = fileURLToPath(new URL("./amp", import.meta.url));
const [requestPath, statusPath] = process.argv.slice(2);
let threadId: string | undefined;

async function status(value: LaunchStatus) {
  await writeFile(`${statusPath}.tmp`, JSON.stringify(value), { mode: 0o600 });
  await rename(`${statusPath}.tmp`, statusPath);
}

try {
  const request: ExecuteOptions = JSON.parse(
    await readFile(requestPath, "utf8"),
  );
  await unlink(requestPath);
  for await (const message of execute(request)) {
    if (!threadId && /^T-[a-f0-9-]+$/i.test(message.session_id)) {
      threadId = message.session_id;
      await status({ state: "running", threadId });
    }
    if (message.type === "result" && message.is_error) {
      throw new Error(message.error);
    }
  }
  if (!threadId) throw new Error("Amp ended without returning a thread ID.");
  await status({ state: "complete", threadId });
} catch (error) {
  await unlink(requestPath).catch(() => {});
  await status({
    state: "error",
    message: error instanceof Error ? error.message : String(error),
    threadId,
  });
  process.exitCode = 1;
}
