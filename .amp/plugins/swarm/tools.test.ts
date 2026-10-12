import type { PluginAPI, PluginThread, PluginToolContext, PluginToolDefinition, ThreadID, ThreadMessage } from '@ampcode/plugin'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { type ChildEntry, PLANNER, type Role, WORKER, formatBootstrap, loadSelf, readChildren, writeChildren } from './core'
import type { SwarmAgents } from './modes'
import { registerTools } from './tools'

let tmp: string
beforeAll(() => {
	tmp = mkdtempSync(join(tmpdir(), 'swarm-tools-'))
	process.env.SWARM_HOME = join(tmp, 'state')
})
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

const newId = () => `T-${crypto.randomUUID()}` as ThreadID

function sh(cwd: string, ...args: string[]): string {
	const r = Bun.spawnSync(['git', '-C', cwd, ...args])
	if (r.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr.toString()}`)
	return r.stdout.toString().trim()
}

function write(root: string, rel: string, text: string) {
	mkdirSync(dirname(join(root, rel)), { recursive: true })
	writeFileSync(join(root, rel), text)
}

/** A bare origin with main and swarm/<run>, and a clone factory checked out on swarm/<run>. */
function makeRepos(run: string) {
	const dir = mkdtempSync(join(tmp, 'git-'))
	const origin = join(dir, 'origin.git')
	sh(dir, 'init', '-q', '--bare', '-b', 'main', origin)
	const seed = join(dir, 'seed')
	sh(dir, 'clone', '-q', origin, seed)
	sh(seed, 'config', 'user.email', 'seed@example.com')
	sh(seed, 'config', 'user.name', 'seed')
	write(seed, 'README.md', 'app\n')
	write(seed, 'docs/decisions/index.md', '# Decisions\n\n- storage: TBD\n')
	write(seed, 'docs/decisions/café.md', '- cache: TBD\n') // Git quotes non-ASCII names unless -z
	sh(seed, 'add', '-A')
	sh(seed, 'commit', '-q', '-m', 'seed')
	sh(seed, 'push', '-q', 'origin', 'HEAD:refs/heads/main', `HEAD:refs/heads/swarm/${run}`)
	const clone = (name: string) => {
		const root = join(dir, name)
		sh(dir, 'clone', '-q', origin, root)
		sh(root, 'config', 'user.email', `${name}@example.com`)
		sh(root, 'config', 'user.name', name)
		sh(root, 'checkout', '-q', '--track', '-b', `swarm/${run}`, `origin/swarm/${run}`)
		return root
	}
	return { origin, clone, branch: `swarm/${run}` }
}

interface FakeThread {
	thread: PluginThread
	userTexts: string[]
	appended: string[]
	labels: string[]
	state: string | Error
	appendFails: boolean
}

function fakeThread(id: ThreadID, role: string | null, parent: ThreadID | null, userTexts: string[] = []): FakeThread {
	const f = { userTexts, appended: [], labels: [], state: 'running', appendFails: false } as unknown as FakeThread
	f.thread = {
		id,
		agent: async () => ({ definition: { kind: 'agent-definition', name: role ?? 'other' } }),
		parentThreadID: async () => parent,
		state: {
			get: async () => {
				if (f.state instanceof Error) throw f.state
				return f.state
			},
		},
		// Spike S3: `full: true` returns nothing on current Amp; the default view works.
		messages: async (o: { full?: boolean; offset?: number; limit?: number } = {}) => {
			if (o.full) return []
			const offset = o.offset ?? 0
			return f.userTexts.slice(offset, offset + Math.min(o.limit ?? 10, 20)).map(
				(text, i) => ({ role: 'user', id: `m${offset + i}`, content: [{ type: 'text', text }] }) as unknown as ThreadMessage,
			)
		},
		addLabels: async (labels: string[]) => {
			f.labels.push(...labels)
			return f.labels
		},
		appendUserMessage: async (m: { content: string }) => {
			if (f.appendFails) throw new Error('append rejected')
			f.appended.push(m.content)
			f.userTexts.push(m.content)
		},
	} as unknown as PluginThread
	return f
}

function setup(root = tmp) {
	const tools = new Map<string, PluginToolDefinition>()
	const threads = new Map<string, FakeThread>()
	const created: { role: Role; opts: unknown; fake: FakeThread }[] = []
	let appendFails = false
	const amp = {
		system: { workspaceRoot: pathToFileURL(root).href },
		helpers: { filePathFromURI: (u: string) => fileURLToPath(u) },
		registerTool: (d: PluginToolDefinition) => void tools.set(d.name, d),
		threads: {
			get: (id: string) =>
				threads.get(id)?.thread ?? {
					state: { get: () => Promise.reject(new Error('thread not found')) },
					appendUserMessage: () => Promise.reject(new Error('thread not found')),
				},
		},
	} as unknown as PluginAPI
	const agent = (role: Role) => ({
		createThread: async (opts: { parentThreadID: ThreadID }) => {
			const fake = fakeThread(newId(), role, opts.parentThreadID)
			fake.appendFails = appendFails
			threads.set(fake.thread.id, fake)
			created.push({ role, opts, fake })
			return fake.thread
		},
	})
	registerTools(amp, { planner: agent(PLANNER), worker: agent(WORKER) } as unknown as SwarmAgents)
	const add = (f: FakeThread) => (threads.set(f.thread.id, f), f)
	const call = (name: string, f: FakeThread, input: Record<string, unknown> = {}) =>
		tools.get(name)!.execute(input, { thread: f.thread } as PluginToolContext) as Promise<string>
	return { add, call, created, setAppendFails: (v: boolean) => (appendFails = v) }
}

const handoffMsg = (id: string) => `[handoff from ${id} (swarm-worker): task]\ndone`

describe('publish_docs', () => {
	test('commits docs only and pushes to swarm/<run>; a second call makes no new commit', async () => {
		const run = newId()
		const repos = makeRepos(run)
		const root = repos.clone('planner')
		const { add, call } = setup(root)
		const planner = add(fakeThread(run, PLANNER, null))

		write(root, 'docs/decisions/storage.md', 'Use SQLite.\n')
		write(root, 'scratch.txt', 'not docs\n')
		expect(await call('publish_docs', planner)).toContain('published')
		expect(sh(repos.origin, 'show', `${repos.branch}:docs/decisions/storage.md`)).toBe('Use SQLite.')
		expect(sh(repos.origin, 'ls-tree', '-r', '--name-only', repos.branch)).not.toContain('scratch.txt')

		const tip = sh(repos.origin, 'rev-parse', repos.branch)
		await call('publish_docs', planner)
		expect(sh(repos.origin, 'rev-parse', repos.branch)).toBe(tip)
	})

	test('docs conflict: returns the file, children() reports blocked with statuses, resolved second call lands', async () => {
		const run = newId()
		const repos = makeRepos(run)
		const root = repos.clone('planner')
		const other = repos.clone('other')
		const { add, call } = setup(root)
		const handedOff = newId()
		const overdue = add(fakeThread(newId(), WORKER, run))
		const gone = newId()
		const planner = add(fakeThread(run, PLANNER, null, ['spec', handoffMsg(handedOff)]))
		const self = (await loadSelf(planner.thread))!
		const longAgo = new Date(Date.now() - 3 * 3600_000).toISOString()
		writeChildren(self, [
			{ id: handedOff, role: WORKER, title: 'a', spawnedAt: longAgo, deadlineMin: 90 },
			{ id: overdue.thread.id, role: WORKER, title: 'b', spawnedAt: longAgo, deadlineMin: 90 },
			{ id: gone, role: WORKER, title: 'c', spawnedAt: new Date().toISOString(), deadlineMin: 90 },
		])

		const file = 'docs/decisions/café.md'
		write(other, file, '- cache: redis\n')
		sh(other, 'commit', '-qam', 'other decision')
		sh(other, 'push', '-q', 'origin', `HEAD:${repos.branch}`)

		write(root, file, '- cache: memcached\n')
		const first = await call('publish_docs', planner)
		expect(first).toContain('conflict')
		expect(first).toContain(file)
		expect(readFileSync(join(root, file), 'utf8')).toContain('<<<<<<<')

		const kids = await call('children', planner)
		expect(kids.split('\n')[0]).toBe(`refresh: blocked (${file})`)
		const statuses = JSON.parse(kids.slice(kids.indexOf('\n') + 1)) as Record<string, unknown>[]
		expect(statuses.map((s) => [s.handoffReceived, s.overdue])).toEqual([
			[true, false],
			[false, true],
			[false, false],
		])
		expect(statuses[1]!.state).toBe('running')
		expect(String(statuses[2]!.state)).toStartWith('unknown: ')

		// Still unresolved: refused again, nothing lands.
		expect(await call('publish_docs', planner)).toContain(file)
		expect(sh(repos.origin, 'show', `${repos.branch}:${file}`)).toBe('- cache: redis')

		write(root, file, '- cache: memcached (supersedes redis)\n')
		expect(await call('publish_docs', planner)).toContain('published')
		expect(sh(repos.origin, 'show', `${repos.branch}:${file}`)).toBe('- cache: memcached (supersedes redis)')
		expect(sh(repos.origin, 'log', '--format=%s', repos.branch)).toContain('other decision')
		expect((await call('children', planner)).split('\n')[0]).toBe('refresh: ok')
	})

	test('children() reports blocked when its autostash restore conflicts; publish_docs refuses markers, then lands', async () => {
		const run = newId()
		const repos = makeRepos(run)
		const root = repos.clone('planner')
		const other = repos.clone('other')
		const { add, call } = setup(root)
		const planner = add(fakeThread(run, PLANNER, null))
		const file = 'docs/decisions/index.md'

		write(other, file, '# Decisions\n\n- storage: sqlite\n')
		sh(other, 'commit', '-qam', 'other decision')
		sh(other, 'push', '-q', 'origin', `HEAD:${repos.branch}`)
		write(root, file, '# Decisions\n\n- storage: postgres\n') // unpublished edit

		const kids = await call('children', planner)
		expect(kids.split('\n')[0]).toBe(`refresh: blocked (${file})`)
		expect(JSON.parse(kids.slice(kids.indexOf('\n') + 1))).toEqual([])
		expect(await call('publish_docs', planner)).toContain(`- ${file}`)
		expect(sh(repos.origin, 'show', `${repos.branch}:${file}`)).toContain('sqlite')

		write(root, file, '# Decisions\n\n- storage: postgres\n')
		expect(await call('publish_docs', planner)).toContain('published')
		expect(sh(repos.origin, 'show', `${repos.branch}:${file}`)).toBe('# Decisions\n\n- storage: postgres')
	})

	test('a commit whose push failed is pushed by the next call without a new commit', async () => {
		const run = newId()
		const repos = makeRepos(run)
		const root = repos.clone('planner')
		const { add, call } = setup(root)
		const planner = add(fakeThread(run, PLANNER, null))
		sh(repos.origin, 'config', 'core.hooksPath', 'hooks') // override any global hooksPath
		const hook = join(repos.origin, 'hooks', 'pre-receive')
		writeFileSync(hook, '#!/bin/sh\nexit 1\n')
		chmodSync(hook, 0o755)

		write(root, 'docs/plans/root.md', 'pass 1\n')
		await expect(call('publish_docs', planner)).rejects.toThrow(/push failed.*call publish_docs again/i)
		const pending = sh(root, 'rev-parse', 'HEAD')
		expect(sh(root, 'show', '--format=', '--name-only', 'HEAD')).toBe('docs/plans/root.md')

		rmSync(hook)
		expect(await call('publish_docs', planner)).toContain('published')
		expect(sh(repos.origin, 'rev-parse', repos.branch)).toBe(pending)
	})
})

describe('spawn', () => {
	const spawnWorker = (call: ReturnType<typeof setup>['call'], f: FakeThread, extra: Record<string, unknown> = {}) =>
		call('spawn', f, { role: WORKER, title: 'task', instructions: 'Do the task.', ...extra })

	test('bootstraps the child and enforces the live cap; handoffs, failures and replaces free slots', async () => {
		const { add, call, created, setAppendFails } = setup()
		const run = newId()
		const planner = add(fakeThread(run, PLANNER, null))

		await expect(spawnWorker(call, planner, { deadlineMin: 0.5 })).rejects.toThrow(/whole number/)
		expect(created).toHaveLength(0)
		expect(await spawnWorker(call, planner)).toContain('paced')
		const [first] = created
		expect(first!.opts).toEqual({ parentThreadID: run, executor: 'orb' })
		expect(first!.fake.labels).toEqual([`swarm-${run.slice(-12)}`])
		expect(first!.fake.appended[0]).toBe(
			`[swarm run=${run} parent=${run} role=swarm-worker depth=1 deadlineMin=90 branch=swarm/${run}]\n[swarm task: task]\n\nDo the task.`,
		)

		setAppendFails(true)
		await expect(spawnWorker(call, planner)).rejects.toThrow(/could not deliver/)
		setAppendFails(false)
		for (let i = 0; i < 7; i++) await spawnWorker(call, planner)
		// 8 live (the failed one does not count).
		await expect(spawnWorker(call, planner)).rejects.toThrow('wait for handoffs or replace an overdue child')

		planner.userTexts.push(handoffMsg(first!.fake.thread.id))
		await spawnWorker(call, planner)
		await expect(spawnWorker(call, planner)).rejects.toThrow('wait for handoffs or replace an overdue child')

		const self = (await loadSelf(planner.thread))!
		const victim = readChildren(self).find((c) => !c.failed && c.id !== first!.fake.thread.id)!
		await expect(spawnWorker(call, planner, { replaces: newId() })).rejects.toThrow(/not one of your children/)
		await spawnWorker(call, planner, { replaces: victim.id })
		const entries = readChildren(self)
		expect(entries.find((c) => c.id === victim.id)!.replacedBy).toBe(entries.at(-1)!.id)
		expect(entries.filter((c) => c.failed)).toHaveLength(1)
		expect(entries).toHaveLength(11)
	})

	test('total and depth caps; workers cannot spawn', async () => {
		const { add, call } = setup()
		const run = newId()
		const planner = add(fakeThread(run, PLANNER, null))
		const self = (await loadSelf(planner.thread))!
		const spent: ChildEntry[] = Array.from({ length: 60 }, () => ({
			id: newId(),
			role: WORKER,
			title: 't',
			spawnedAt: new Date().toISOString(),
			deadlineMin: 90,
			replacedBy: newId(),
		}))
		writeChildren(self, spent)
		await expect(spawnWorker(call, planner)).rejects.toThrow('cap reached: report remaining scope as blocked in your handoff')

		const boot = (role: Role, depth: number) =>
			formatBootstrap({ run, parent: run, role, depth, deadlineMin: 240, branch: `swarm/${run}`, title: 'slice' }) + '\n\ngo'
		const deep = add(fakeThread(newId(), PLANNER, run, [boot(PLANNER, 3)]))
		await expect(spawnWorker(call, deep)).rejects.toThrow('cap reached: report remaining scope as blocked in your handoff')
		const mid = add(fakeThread(newId(), PLANNER, run, [boot(PLANNER, 2)]))
		expect(await spawnWorker(call, mid)).toContain('depth 3')

		const worker = add(fakeThread(newId(), WORKER, run, [boot(WORKER, 1)]))
		await expect(spawnWorker(call, worker)).rejects.toThrow(/only available to swarm-planner/)
	})
})

describe('handoff', () => {
	test('delivers to the parent; refuses on the root and on non-swarm threads', async () => {
		const { add, call } = setup()
		const run = newId()
		const root = add(fakeThread(run, PLANNER, null))
		await expect(call('handoff', root, { report: 'done' })).rejects.toThrow(
			'you are the root; report to the human in your final message',
		)
		const boot = formatBootstrap({ run, parent: run, role: WORKER, depth: 1, deadlineMin: 90, branch: `swarm/${run}`, title: 'Add parser' })
		const worker = add(fakeThread(newId(), WORKER, run, [boot + '\n\nDo it.']))
		await call('handoff', worker, { report: 'pushed abc123' })
		expect(root.appended).toEqual([`[handoff from ${worker.thread.id} (swarm-worker): Add parser]\npushed abc123`])

		const stranger = add(fakeThread(newId(), null, run))
		await expect(call('handoff', stranger, { report: 'x' })).rejects.toThrow(/not part of a swarm/)
	})
})
