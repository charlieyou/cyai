// Owner: tools child. spawn, children, publish_docs, handoff (§5).

import type { PluginAPI, PluginThread, PluginToolContext } from '@ampcode/plugin'

import {
	CAPS,
	type ChildEntry,
	DEFAULT_DEADLINE_MIN,
	PLANNER,
	ROLES,
	type Role,
	type SwarmSelf,
	filesWithMarkers,
	firstLine,
	formatBootstrap,
	git,
	handoffSources,
	loadSelf,
	operationInProgress,
	readChildren,
	readHandoffs,
	recordHandoffs,
	roleOf,
	withLock,
	workspaceRoot,
	writeChildren,
} from './core'
import type { SwarmAgents } from './modes'

const LIVE_CAP_ERROR = 'wait for handoffs or replace an overdue child'
const CAP_REACHED_ERROR = 'cap reached: report remaining scope as blocked in your handoff'
const PACING_NOTE = 'Orb starts may be paced (20 burst, then one per 5 min); the child starts when its orb is ready.'
/** Transcript scan bound: 50 pages of 20 user messages. */
const MAX_SCAN_PAGES = 50

async function requirePlanner(ctx: PluginToolContext, tool: string): Promise<SwarmSelf> {
	if ((await roleOf(ctx.thread)) !== PLANNER) throw new Error(`${tool} is only available to swarm-planner threads`)
	const self = await loadSelf(ctx.thread)
	if (!self) throw new Error(`${tool}: this thread is not part of a swarm run (no bootstrap line)`)
	return self
}

/**
 * Child ids that have handed off to this thread, from user messages starting `[handoff from <id>`.
 * `messages({ full: true })` returns nothing on current Amp (spike S3), so fall back to the default
 * view, which loses messages behind a compaction; the agent.start record covers those.
 */
async function scanTranscriptHandoffs(thread: PluginThread): Promise<string[]> {
	for (const full of [true, false]) {
		const ids: string[] = []
		let seen = 0
		for (let page = 0; page < MAX_SCAN_PAGES; page++) {
			const msgs = await thread.messages({ ...(full ? { full } : {}), from: 'start', offset: page * 20, limit: 20, roles: ['user'] })
			seen += msgs.length
			for (const m of msgs) {
				for (const c of m.content) if (c.type === 'text') ids.push(...handoffSources(c.text))
			}
			if (msgs.length < 20) break
		}
		if (seen > 0) return ids
	}
	return []
}

/** Union of recorded handoffs and the transcript scan; scan failures fall back to the record. */
async function handedOff(self: SwarmSelf, thread: PluginThread): Promise<{ ids: Set<string>; scanError?: string }> {
	const ids = new Set(readHandoffs(self))
	try {
		const scanned = await scanTranscriptHandoffs(thread)
		recordHandoffs(self, scanned)
		for (const id of scanned) ids.add(id)
		return { ids }
	} catch (e) {
		return { ids, scanError: e instanceof Error ? e.message : String(e) }
	}
}

const isLive = (c: ChildEntry, handed: Set<string>) => !c.replacedBy && !c.failed && !handed.has(c.id)

/** NUL-separated path listing (`-z`), so names Git would quote (core.quotePath) stay real paths. */
async function paths(root: string, cmd: string, ...args: string[]): Promise<string[]> {
	return (await git(root, cmd, '-z', ...args)).stdout.split('\0').filter(Boolean)
}
const unmerged = (root: string) => paths(root, 'diff', '--name-only', '--diff-filter=U')

/** Files changed in the work tree or index under docs/, relative to HEAD, plus untracked ones. */
async function changedDocs(root: string): Promise<string[]> {
	return [
		...(await paths(root, 'diff', '--name-only', 'HEAD', '--', 'docs')),
		...(await paths(root, 'ls-files', '--others', '--exclude-standard', '--', 'docs')),
	]
}

function conflictResult(files: string[]): string {
	return (
		`publish_docs: conflict. Resolve the conflict markers in these files with edit_file, keeping both intents, ` +
		`then call publish_docs again:\n${files.map((f) => `- ${f}`).join('\n')}`
	)
}

export function registerTools(amp: PluginAPI, agents: SwarmAgents): void {
	amp.registerTool({
		name: 'spawn',
		description:
			'Delegate a task to a new child thread in its own orb. role swarm-worker executes one task; swarm-planner owns a slice and delegates it further. ' +
			'`instructions` must be self-contained: the child sees only them. Pass `replaces` with an overdue or errored child id to replace it. Returns the child thread id.',
		inputSchema: {
			type: 'object',
			properties: {
				role: { type: 'string', enum: [...ROLES], description: 'swarm-worker for a task, swarm-planner for a slice' },
				title: { type: 'string', description: 'Short task title' },
				instructions: { type: 'string', description: 'Complete task instructions for the child' },
				deadlineMin: {
					type: 'integer',
					minimum: 1,
					description: `Minutes before the child counts as overdue (default ${DEFAULT_DEADLINE_MIN['swarm-worker']} for workers, ${DEFAULT_DEADLINE_MIN['swarm-planner']} for planners)`,
				},
				replaces: { type: 'string', description: 'Id of an existing child this one replaces' },
			},
			required: ['role', 'title', 'instructions'],
		},
		async execute(input, ctx) {
			const self = await requirePlanner(ctx, 'spawn')
			const role = input.role as Role
			if (!ROLES.includes(role)) throw new Error(`spawn: role must be one of ${ROLES.join(', ')}`)
			const title = typeof input.title === 'string' ? input.title.trim() : ''
			const instructions = typeof input.instructions === 'string' ? input.instructions.trim() : ''
			if (!title || !instructions) throw new Error('spawn: title and instructions are required')
			const deadlineMin = input.deadlineMin === undefined ? DEFAULT_DEADLINE_MIN[role] : Number(input.deadlineMin)
			if (!Number.isSafeInteger(deadlineMin) || deadlineMin <= 0) throw new Error('spawn: deadlineMin must be a positive whole number of minutes')
			const replaces = input.replaces === undefined ? undefined : String(input.replaces)

			return withLock(`spawn:${ctx.thread.id}`, async () => {
				const depth = self.depth + 1
				if (depth > CAPS.maxDepth) throw new Error(`spawn: ${CAP_REACHED_ERROR} (depth ${depth} > ${CAPS.maxDepth})`)
				const entries = readChildren(self)
				if (entries.length >= CAPS.totalSpawns) throw new Error(`spawn: ${CAP_REACHED_ERROR} (${entries.length} spawns)`)
				const old = replaces === undefined ? undefined : entries.find((c) => c.id === replaces)
				if (replaces !== undefined && !old) throw new Error(`spawn: replaces ${replaces} is not one of your children`)
				const others = entries.filter((c) => c !== old)
				// Recorded handoffs first; the transcript scan only matters when they leave us at the cap.
				let live = others.filter((c) => isLive(c, new Set(readHandoffs(self)))).length
				if (live >= CAPS.liveChildren) {
					const { ids } = await handedOff(self, ctx.thread)
					live = others.filter((c) => isLive(c, ids)).length
				}
				if (live >= CAPS.liveChildren) throw new Error(`spawn: ${LIVE_CAP_ERROR} (${live} live children)`)

				const child = await agents[role === PLANNER ? 'planner' : 'worker'].createThread({
					parentThreadID: ctx.thread.id,
					executor: 'orb',
				})
				const entry: ChildEntry = { id: child.id, role, title, spawnedAt: new Date().toISOString(), deadlineMin }
				entries.push(entry)
				writeChildren(self, entries)

				const notes: string[] = []
				try {
					await child.addLabels([`swarm-${self.run.slice(-12)}`])
				} catch (e) {
					notes.push(`labeling failed: ${e instanceof Error ? e.message : e}`)
				}
				const bootstrap = formatBootstrap({
					run: self.run,
					parent: self.thread,
					role,
					depth,
					deadlineMin,
					branch: self.branch,
					title,
				})
				try {
					await child.appendUserMessage({ type: 'user-message', content: `${bootstrap}\n\n${instructions}` })
				} catch (e) {
					entry.failed = e instanceof Error ? e.message : String(e)
					writeChildren(self, entries)
					throw new Error(`spawn: created ${child.id} but could not deliver its instructions (${entry.failed}); it is marked failed and does not count as live. Call spawn again.`)
				}
				if (old) {
					old.replacedBy = child.id
					writeChildren(self, entries)
				}
				return [
					`spawned ${child.id} (${role}, depth ${depth}, deadline ${deadlineMin} min${old ? `, replaces ${old.id}` : ''})`,
					PACING_NOTE,
					...notes,
				].join('\n')
			})
		},
	})

	amp.registerTool({
		name: 'children',
		description:
			'Pull the latest swarm branch and list your children with live state, handoffReceived, overdue and replacedBy. Call at the start of every turn.',
		inputSchema: { type: 'object', properties: {} },
		async execute(_input, ctx) {
			const self = await requirePlanner(ctx, 'children')
			const root = workspaceRoot(amp)
			// Blocked = a stopped rebase/merge, or unmerged files without one (an autostash that
			// conflicted on restore: the pull itself exits 0).
			const blocked = async () => {
				const files = await unmerged(root)
				if (files.length || (await operationInProgress(root)))
					return `refresh: blocked (${files.join(', ') || 'operation in progress'})`
				return null
			}
			const refresh = await withLock(`git:${root}`, async () => {
				try {
					const before = await blocked()
					if (before) return before
					const pull = await git(root, 'pull', '--rebase', '--autostash', 'origin', self.branch)
					const after = await blocked()
					if (after) return after
					if (pull.code === 0) return 'refresh: ok'
					return `refresh: failed (${firstLine(pull.stderr || pull.stdout)})`
				} catch (e) {
					return `refresh: failed (${e instanceof Error ? e.message : e})`
				}
			})

			const { ids, scanError } = await handedOff(self, ctx.thread)
			const now = Date.now()
			const statuses = await Promise.all(
				readChildren(self).map(async (c) => {
					let state: string
					try {
						state = await amp.threads.get(c.id).state.get()
					} catch (e) {
						state = `unknown: ${e instanceof Error ? e.message : e}`
					}
					const handoffReceived = ids.has(c.id)
					return {
						id: c.id,
						role: c.role,
						title: c.title,
						state,
						handoffReceived,
						overdue: !handoffReceived && now > Date.parse(c.spawnedAt) + c.deadlineMin * 60_000,
						...(c.replacedBy ? { replacedBy: c.replacedBy } : {}),
						...(c.failed ? { failed: c.failed } : {}),
					}
				}),
			)
			return [
				refresh,
				...(scanError ? [`handoff scan: failed (${scanError}); using recorded handoffs only`] : []),
				JSON.stringify(statuses, null, 2),
			].join('\n')
		},
	})

	amp.registerTool({
		name: 'publish_docs',
		description:
			'Commit your docs/** edits and push them to the swarm branch. On a conflict, returns the files to fix; edit them and call again. If the push fails, call again.',
		inputSchema: { type: 'object', properties: {} },
		async execute(_input, ctx) {
			const self = await requirePlanner(ctx, 'publish_docs')
			const root = workspaceRoot(amp)
			return withLock(`git:${root}`, async () => {
				if (await operationInProgress(root)) {
					const pending = [...new Set([...(await unmerged(root)), ...(await changedDocs(root))])]
					const marked = await filesWithMarkers(root, pending)
					if (marked.length) return conflictResult(marked)
					await git(root, 'add', '-A', '--', 'docs')
					const cont = await git(root, 'rebase', '--continue')
					if (cont.code !== 0) {
						if (await operationInProgress(root)) {
							const files = await unmerged(root)
							if (files.length) return conflictResult(files)
						}
						throw new Error(`publish_docs: rebase --continue failed: ${firstLine(cont.stderr || cont.stdout)}`)
					}
				} else {
					await git(root, 'add', '-A', '--', 'docs')
					const staged = await paths(root, 'diff', '--cached', '--name-only', '--', 'docs')
					if (staged.length) {
						const marked = await filesWithMarkers(root, staged)
						if (marked.length)
							return `publish_docs: refused; these docs still contain conflict markers. Fix them and call again:\n${marked.map((f) => `- ${f}`).join('\n')}`
						// Pathspec commit: only docs/ lands even if something else were staged.
						const commit = await git(root, 'commit', '-m', `docs: ${self.title} (${self.thread})`, '--', 'docs')
						if (commit.code !== 0) throw new Error(`publish_docs: commit failed: ${firstLine(commit.stderr || commit.stdout)}`)
					}
				}

				const pull = await git(root, 'pull', '--rebase', 'origin', self.branch)
				if (pull.code !== 0) {
					if (await operationInProgress(root)) return conflictResult(await unmerged(root))
					throw new Error(`publish_docs: pull failed: ${firstLine(pull.stderr || pull.stdout)}; call publish_docs again`)
				}
				const push = await git(root, 'push', 'origin', `HEAD:${self.branch}`)
				if (push.code !== 0)
					throw new Error(`publish_docs: push failed (${firstLine(push.stderr)}); your docs commit is kept locally. Call publish_docs again.`)
				const head = (await git(root, 'rev-parse', '--short', 'HEAD')).stdout.trim()
				return `published: ${self.branch} is at ${head}`
			})
		},
	})

	amp.registerTool({
		name: 'handoff',
		description:
			'Send your single final report to the thread that spawned you: what was done, deviations, concerns, where the work is (commits or wip ref), and anything blocked.',
		inputSchema: {
			type: 'object',
			properties: { report: { type: 'string', description: 'The full handoff report' } },
			required: ['report'],
		},
		async execute(input, ctx) {
			const report = typeof input.report === 'string' ? input.report.trim() : ''
			if (!report) throw new Error('handoff: report is required')
			const self = await loadSelf(ctx.thread)
			if (!self) throw new Error('handoff: this thread is not part of a swarm run')
			const parent = await ctx.thread.parentThreadID()
			if (self.parent === null || parent === null)
				throw new Error('handoff: you are the root; report to the human in your final message')
			try {
				await amp.threads
					.get(parent)
					.appendUserMessage({ type: 'user-message', content: `[handoff from ${self.thread} (${self.role}): ${self.title}]\n${report}` })
			} catch (e) {
				throw new Error(`handoff: delivery to ${parent} failed (${e instanceof Error ? e.message : e}); call handoff again`)
			}
			return `handoff delivered to ${parent}`
		},
	})
}
