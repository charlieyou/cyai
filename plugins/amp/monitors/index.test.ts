import { afterEach, expect, test, spyOn } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import type { PluginAPI, PluginToolContext, PluginToolDefinition } from '@ampcode/plugin'
import plugin from './index'

const tools = new Map<string, PluginToolDefinition>()
const events: { thread: string; content: string; steer: boolean }[] = []
const rejected = new Set<string>()
const blocked = new Map<string, () => void>()
let sequence = 0
const contexts: PluginToolContext[] = []
plugin({
	system: { workspaceRoot: new URL('file:///tmp') },
	helpers: { filePathFromURI: () => '/tmp' },
	logger: { log() {} },
	registerTool(tool: PluginToolDefinition) { tools.set(tool.name, tool) },
	threads: { get(id: string) { return {
		id,
		async appendUserMessage(message: { content: string }, options: { steer: boolean }) {
			if (rejected.has(id)) throw new Error('offline')
			if (blocked.has(id)) await new Promise<void>(resolve => blocked.set(id, resolve))
			events.push({ thread: id, content: message.content, steer: options.steer })
		},
	} } },
} as unknown as PluginAPI)

function context() {
	const ctx = { thread: { id: `T-test-${++sequence}` } } as unknown as PluginToolContext
	contexts.push(ctx)
	return ctx
}
async function call(name: string, ctx: PluginToolContext, input = {}) {
	return await tools.get(name)!.execute(input, ctx) as string
}
async function start(ctx: PluginToolContext, command: string, options = {}) {
	return JSON.parse(await call('monitor_start', ctx, { command, description: 'test watcher', ...options }))
}
async function list(ctx: PluginToolContext) { return JSON.parse(await call('monitor_list', ctx)) }
function messages(ctx: PluginToolContext) { return events.filter(e => e.thread === ctx.thread.id) }
async function until(check: () => boolean | Promise<boolean>, timeout = 2500) {
	const end = Date.now() + timeout
	while (!await check()) {
		if (Date.now() > end) throw new Error('Timed out waiting for test condition')
		await Bun.sleep(15)
	}
}
afterEach(async () => {
	for (const ctx of contexts.splice(0)) {
		for (const m of await list(ctx)) await call('monitor_stop', ctx, { id: m.id })
		const release = blocked.get(ctx.thread.id)
		blocked.delete(ctx.thread.id); release?.()
	}
})

test('batches live stdout, handles split lines and final fragments, isolates stderr', async () => {
	const ctx = context()
	await start(ctx, "printf 'hel'; sleep 0.05; printf 'lo\\nworld\\n'; printf 'diagnostic' >&2; sleep 0.5; printf 'last'")
	await until(() => messages(ctx).length === 1)
	expect(messages(ctx)[0].content).toContain('hello\\nworld\\n')
	expect(messages(ctx)[0].steer).toBe(true)
	expect((await list(ctx))[0].status).toBe('running')
	await until(() => messages(ctx).length === 3)
	expect(messages(ctx)[1].content).toContain('last')
	expect(messages(ctx).some(e => e.content.includes('diagnostic"'))).toBe(false)
	expect((await list(ctx))[0].stderr_tail).toBe('diagnostic')
})

test('silent persistent watchers stay silent; stop is idempotent and thread-scoped', async () => {
	const ctx = context(), other = context()
	const m = await start(ctx, 'sleep 30', { persistent: true })
	await Bun.sleep(250)
	expect(messages(ctx)).toHaveLength(0)
	expect(await list(other)).toEqual([])
	await expect(call('monitor_stop', other, { id: m.id })).rejects.toThrow('No such monitor')
	await call('monitor_stop', ctx, { id: m.id })
	await call('monitor_stop', ctx, { id: m.id })
	await until(() => messages(ctx).length === 1)
	expect((await list(ctx))[0].status).toBe('stopped by request')
})

test('timeout terminates the watcher, reports once', async () => {
	const ctx = context()
	await start(ctx, 'sleep 30', { timeout_ms: 50 })
	await until(() => messages(ctx).length === 1)
	expect((await list(ctx))[0].status).toBe('timed out')
})

test('starts without a confirmation UI', async () => {
	const ctx = context()
	await start(ctx, 'echo automatic')
	await until(() => messages(ctx).length === 2)
	expect(messages(ctx)[0].content).toContain('automatic')
	expect((await list(ctx))[0].status).toBe('exited: 0')
})

test('invalid input never launches commands', async () => {
	const ctx = context()
	await expect(start(ctx, 'true', { persistent: true, timeout_ms: 50 })).rejects.toThrow('not both')
	await expect(start(ctx, 'true', { timeout_ms: 3600001 })).rejects.toThrow('timeout_ms')
	await expect(start(ctx, 'true', { workdir: 'relative' })).rejects.toThrow('absolute')
	expect(await list(ctx)).toEqual([])
})

test('nonzero exit and invalid workdir produce diagnostics', async () => {
	const ctx = context()
	await start(ctx, 'echo problem >&2; exit 7')
	await until(async () => (await list(ctx))[0].status === 'exited: 7')
	expect((await list(ctx))[0].stderr_tail).toContain('problem')
	await start(ctx, 'true', { workdir: '/nonexistent-monitor-test-directory' })
	await until(async () => (await list(ctx))[1].status !== 'running')
	expect((await list(ctx))[1].status).toBe('failed to launch')
})

test('oversized stdout stops instead of flooding the thread', async () => {
	const ctx = context()
	await start(ctx, "head -c 20000 /dev/zero | tr '\\0' x; sleep 30")
	await until(async () => (await list(ctx))[0].status !== 'running')
	expect((await list(ctx))[0].status).toContain('16 KiB')
	expect(messages(ctx).every(e => e.content.length < 1000)).toBe(true)
})

test('delivery failure stops the watcher without retrying the append', async () => {
	const ctx = context(); rejected.add(ctx.thread.id)
	await start(ctx, "printf 'event\\n'; sleep 30")
	await until(async () => Boolean((await list(ctx))[0].delivery_error))
	expect((await list(ctx))[0].status).toContain('delivery failed')
	expect(messages(ctx)).toHaveLength(0)
})

test('slow delivery has a bounded queue and stops the producer', async () => {
	const ctx = context(); blocked.set(ctx.thread.id, () => {})
	await start(ctx, "while true; do echo event; sleep 0.23; done")
	await until(async () => (await list(ctx))[0].status !== 'running')
	expect((await list(ctx))[0].status).toContain('queue limit')
})

test('enforces the per-thread active monitor limit', async () => {
	const ctx = context()
	for (let i = 0; i < 5; i++) await start(ctx, 'sleep 30', { persistent: true })
	await expect(start(ctx, 'sleep 30')).rejects.toThrow('limit')
})

test('stop escalates to KILL for a shell that ignores TERM', async () => {
	const ctx = context()
	const m = await start(ctx, "trap '' TERM; echo $$; while true; do sleep 0.1; done", { persistent: true })
	await until(() => messages(ctx).length === 1)
	const pid = Number(JSON.parse(messages(ctx)[0].content.split('\n').at(-1)!))
	expect(pid).toBeGreaterThan(0)
	await call('monitor_stop', ctx, { id: m.id })
	await until(() => {
		try { process.kill(pid, 0); return false } catch { return true }
	})
	expect(messages(ctx)).toHaveLength(2)
})

test('sustained stdout is stopped after 30 batches per minute', async () => {
	const ctx = context()
	await start(ctx, 'while true; do echo event; sleep 0.23; done')
	await until(async () => (await list(ctx))[0].status !== 'running', 10000)
	expect((await list(ctx))[0].status).toContain('rate/queue limit')
	await until(() => messages(ctx).length === 31)
}, 12000)

function descendantCommand(pidFile: string, retainStdio: boolean, naturalExit: boolean) {
	return `bash -c 'trap "" TERM; echo $$ > "$1"; while true; do sleep 0.1; done' -- ${JSON.stringify(pidFile)} ${retainStdio ? '' : '</dev/null >/dev/null 2>&1'} &
while [ ! -s ${JSON.stringify(pidFile)} ]; do sleep 0.01; done
${naturalExit ? 'exit 7' : 'sleep 30'}`
}
async function readPID(path: string) {
	let pid = 0
	await until(() => {
		try { pid = Number(readFileSync(path, 'utf8')); return pid > 0 } catch { return false }
	})
	return pid
}
function terminated(pid: number) {
	const result = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' })
	if (result.error) throw result.error
	return result.status === 1 || result.stdout.trim().startsWith('Z')
}

for (const retainStdio of [false, true]) {
	for (const naturalExit of [false, true]) {
		test(`guardian kills resistant descendant: stdio=${retainStdio}, natural exit=${naturalExit}`, async () => {
			const dir = mkdtempSync(join(tmpdir(), 'amp-monitor-test-'))
			const ctx = context()
			const numericKill = spyOn(process, 'kill')
			try {
				// Natural exit must retain exit 7 even when cleanup outlasts this deadline.
				const m = await start(ctx, descendantCommand(join(dir, 'pid'), retainStdio, naturalExit), { timeout_ms: 500 })
				const pid = await readPID(join(dir, 'pid'))
				if (!naturalExit) await call('monitor_stop', ctx, { id: m.id })
				await until(() => terminated(pid), 4000)
				await until(async () => (await list(ctx))[0].status === (naturalExit ? 'exited: 7' : 'stopped by request'))
				expect(numericKill).not.toHaveBeenCalled()
			} finally {
				numericKill.mockRestore()
				rmSync(dir, { recursive: true, force: true })
			}
		})
	}
}

for (const shutdown of ['exit', 'SIGTERM', 'SIGKILL'] as const) {
	test(`guardian survives plugin host ${shutdown} long enough to clean up descendants`, async () => {
		const dir = mkdtempSync(join(tmpdir(), 'amp-monitor-host-test-'))
		const pidFile = join(dir, 'pid')
		const script = `
import plugin from ${JSON.stringify(join(import.meta.dir, 'index.ts'))};
let start;
plugin({ system: { workspaceRoot: null }, logger: { log() {} },
  registerTool(t) { if (t.name === 'monitor_start') start = t.execute },
  threads: { get(id) { return { id, async appendUserMessage() {} } } }
});
await start(${JSON.stringify({ command: descendantCommand(pidFile, false, false), description: 'host shutdown', workdir: dir, persistent: true })},
  { thread: { id: 'T-host-test' } });
${shutdown === 'exit' ? `while (!(await Bun.file(${JSON.stringify(pidFile)}).exists())) await Bun.sleep(10); process.exit(0);` : 'setInterval(() => {}, 1000);'}
`
		const host = Bun.spawn(['bun', '-e', script], { stdout: 'ignore', stderr: 'pipe' })
		try {
			const pid = await readPID(pidFile)
			if (shutdown !== 'exit') host.kill(shutdown)
			await host.exited
			await until(() => terminated(pid), 4000)
			expect(await new Response(host.stderr).text()).toBe('')
		} finally {
			if (host.exitCode === null) host.kill()
			rmSync(dir, { recursive: true, force: true })
		}
	})
}
