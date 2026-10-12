// Shared contract for the swarm plugin: roles, caps, bootstrap line, per-thread state, git helpers.
// Every other module imports from here; nothing here registers handlers.

import type { PluginAPI, PluginThread, ThreadID } from '@ampcode/plugin'
import { spawn as spawnProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const PLANNER = 'swarm-planner'
export const WORKER = 'swarm-worker'
export type Role = typeof PLANNER | typeof WORKER
export const ROLES: readonly Role[] = [PLANNER, WORKER]

/** §6 invariant 8 and §4 defaults. */
export const CAPS = { liveChildren: 8, totalSpawns: 60, maxDepth: 3 } as const
export const DEFAULT_DEADLINE_MIN: Record<Role, number> = { [WORKER]: 90, [PLANNER]: 240 }

/** What a swarm thread knows about itself. Persisted to ~/.swarm/<run>/<thread>/self.json. */
export interface SwarmSelf {
	run: ThreadID
	thread: ThreadID
	parent: ThreadID | null
	role: Role
	depth: number
	deadlineMin: number
	branch: string
	title: string
}

/** One entry of ~/.swarm/<run>/<thread>/children.json (§5 spawn). */
export interface ChildEntry {
	id: ThreadID
	role: Role
	title: string
	spawnedAt: string
	deadlineMin: number
	replacedBy?: ThreadID
	/** Set when the plugin created the thread but could not deliver its first message. Not live. */
	failed?: string
}

export const runBranch = (run: string) => `swarm/${run}`
export const wipBranch = (run: string, thread: string) => `swarm-wip/${run}/${thread}`

// ---------------------------------------------------------------------------------------------
// Bootstrap line (§4). The plugin writes it; the model never composes it.

export function formatBootstrap(b: Omit<SwarmSelf, 'thread'>): string {
	return (
		`[swarm run=${b.run} parent=${b.parent} role=${b.role} depth=${b.depth} deadlineMin=${b.deadlineMin} branch=${b.branch}]\n` +
		`[swarm task: ${b.title.replace(/\s+/g, ' ').trim()}]`
	)
}

const BOOTSTRAP_RE =
	/^\[swarm run=(T-[\w-]+) parent=(T-[\w-]+) role=(swarm-planner|swarm-worker) depth=(\d+) deadlineMin=(\d+) branch=(\S+)\]/
const TITLE_RE = /^\[swarm task: (.*)\]$/m

export function parseBootstrap(thread: ThreadID, text: string): SwarmSelf | null {
	const m = BOOTSTRAP_RE.exec(text.trimStart())
	if (!m) return null
	return {
		run: m[1] as ThreadID,
		thread,
		parent: m[2] as ThreadID,
		role: m[3] as Role,
		depth: Number(m[4]),
		deadlineMin: Number(m[5]),
		branch: m[6]!,
		title: TITLE_RE.exec(text)?.[1] ?? '',
	}
}

// ---------------------------------------------------------------------------------------------
// State files. Keyed by run and thread so threads sharing one HOME (runner variant, §10a) never
// share a registry. ~/.swarm/threads/<thread>.json points a thread at its run.

export const swarmHome = () => process.env.SWARM_HOME ?? join(homedir(), '.swarm')
export const stateDir = (run: string, thread: string) => join(swarmHome(), run, thread)
export const selfPath = (run: string, thread: string) => join(stateDir(run, thread), 'self.json')
export const childrenPath = (run: string, thread: string) => join(stateDir(run, thread), 'children.json')
export const handoffsPath = (run: string, thread: string) => join(stateDir(run, thread), 'handoffs.json')
const pointerPath = (thread: string) => join(swarmHome(), 'threads', `${thread}.json`)

export function readJSON<T>(path: string, fallback: T): T {
	if (!existsSync(path)) return fallback
	return JSON.parse(readFileSync(path, 'utf8')) as T
}

export function writeJSON(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true })
	const tmp = `${path}.tmp-${process.pid}`
	writeFileSync(tmp, JSON.stringify(value, null, '\t') + '\n')
	renameSync(tmp, path)
}

export function saveSelf(self: SwarmSelf): void {
	writeJSON(selfPath(self.run, self.thread), self)
	writeJSON(pointerPath(self.thread), { run: self.run })
}

// ---------------------------------------------------------------------------------------------
// Role and self resolution.

const roleCache = new Map<string, Role | null>()

/** The swarm role of a thread, from its agent definition name; null for every non-swarm thread. */
export async function roleOf(thread: PluginThread): Promise<Role | null> {
	if (roleCache.has(thread.id)) return roleCache.get(thread.id)!
	let role: Role | null = null
	try {
		const def = (await thread.agent()).definition
		if (def.kind === 'agent-definition' && (ROLES as readonly string[]).includes(def.name ?? '')) role = def.name as Role
	} catch {
		role = null
	}
	roleCache.set(thread.id, role)
	return role
}

/**
 * Resolve this thread's swarm identity. Order: cached self.json; root planner (no parent);
 * otherwise the bootstrap line in the thread's first message. Returns null for non-swarm threads
 * or a child whose first message has not arrived yet.
 */
export async function loadSelf(thread: PluginThread): Promise<SwarmSelf | null> {
	const role = await roleOf(thread)
	if (!role) return null
	const pointer = readJSON<{ run?: string } | null>(pointerPath(thread.id), null)
	if (pointer?.run) {
		const cached = readJSON<SwarmSelf | null>(selfPath(pointer.run, thread.id), null)
		if (cached) return cached
	}
	const parent = await thread.parentThreadID()
	let self: SwarmSelf | null = null
	if (parent === null) {
		// A human-created planner is a root; a human-created worker is not part of any swarm.
		if (role !== PLANNER) return null
		self = {
			run: thread.id,
			thread: thread.id,
			parent: null,
			role,
			depth: 0,
			deadlineMin: 0,
			branch: runBranch(thread.id),
			title: 'root',
		}
	} else {
		const [first] = await thread.messages({ from: 'start', limit: 1, roles: ['user'] })
		const text = first?.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n') ?? ''
		self = parseBootstrap(thread.id, text)
		if (!self) return null
	}
	saveSelf(self)
	return self
}

// ---------------------------------------------------------------------------------------------
// Child registry and serialization.

export const readChildren = (self: SwarmSelf) => readJSON<ChildEntry[]>(childrenPath(self.run, self.thread), [])
export const writeChildren = (self: SwarmSelf, entries: ChildEntry[]) =>
	writeJSON(childrenPath(self.run, self.thread), entries)

/** Handoff source ids this planner has observed (agent.start hook), merged with the transcript scan. */
export const readHandoffs = (self: SwarmSelf) => readJSON<string[]>(handoffsPath(self.run, self.thread), [])
export function recordHandoffs(self: SwarmSelf, ids: string[]): void {
	const known = new Set(readHandoffs(self))
	const before = known.size
	for (const id of ids) known.add(id)
	if (known.size !== before) writeJSON(handoffsPath(self.run, self.thread), [...known])
}

/** `[handoff from <id>` at the start of a line; the plugin writes both real and backstop handoffs this way. */
export const HANDOFF_RE = /^\[handoff from (T-[\w-]+)/gm
export function handoffSources(text: string): string[] {
	return [...text.matchAll(HANDOFF_RE)].map((m) => m[1]!)
}

const chains = new Map<string, Promise<unknown>>()
/** In-process async mutex keyed by name: calls run one at a time, in order. */
export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
	const prev = chains.get(key) ?? Promise.resolve()
	const next = prev.then(fn, fn)
	chains.set(
		key,
		next.catch(() => undefined),
	)
	return next
}

// ---------------------------------------------------------------------------------------------
// Git. Plugin-owned git always runs with an explicit -C path, never the process cwd (§10a).

export interface RunResult {
	code: number
	stdout: string
	stderr: string
}

export function run(cmd: string, args: string[], cwd?: string, env?: Record<string, string>): Promise<RunResult> {
	return new Promise((resolve) => {
		const child = spawnProcess(cmd, args, { cwd, env: { ...process.env, ...env } })
		let stdout = ''
		let stderr = ''
		child.stdout.on('data', (d) => (stdout += d))
		child.stderr.on('data', (d) => (stderr += d))
		child.on('error', (e) => resolve({ code: 127, stdout, stderr: stderr + String(e) }))
		child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }))
	})
}

/** Non-interactive git in `root`; editors are disabled so rebase --continue never blocks. */
export const git = (root: string, ...args: string[]) =>
	run('git', ['-C', root, ...args], undefined, { GIT_EDITOR: 'true', GIT_TERMINAL_PROMPT: '0' })

export function workspaceRoot(amp: PluginAPI): string {
	const uri = amp.system.workspaceRoot
	if (!uri) throw new Error('swarm: Amp is running without a workspace; swarm threads need a repository checkout')
	return amp.helpers.filePathFromURI(uri)
}

async function gitDir(root: string): Promise<string> {
	const r = await git(root, 'rev-parse', '--absolute-git-dir')
	return r.stdout.trim()
}

/** True while a rebase or merge is stopped in `root`. */
export async function operationInProgress(root: string): Promise<boolean> {
	const dir = await gitDir(root)
	return ['rebase-merge', 'rebase-apply', 'MERGE_HEAD'].some((p) => existsSync(join(dir, p)))
}

export async function conflictedFiles(root: string): Promise<string[]> {
	const r = await git(root, 'diff', '--name-only', '--diff-filter=U')
	return r.stdout.split('\n').filter(Boolean)
}

/** Files under `paths` (relative to root) that still contain conflict markers. */
export async function filesWithMarkers(root: string, paths: string[]): Promise<string[]> {
	const out: string[] = []
	for (const p of paths) {
		const full = join(root, p)
		if (!existsSync(full)) continue
		if (/^(<{7} |={7}$|>{7} )/m.test(readFileSync(full, 'utf8'))) out.push(p)
	}
	return out
}

export const firstLine = (s: string) => s.trim().split('\n').find(Boolean) ?? ''
