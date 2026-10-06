import { createHash } from 'node:crypto'
import {
	type ExportedMessage, type Project,
	matchProject, parseOption, pullRequestURLs, resolveProject, scanTranscript, threadPrompt, verifySignature,
} from './core'

const MAX_BODY = 20_000
const TIMESTAMP_TOLERANCE_MS = 5 * 60_000
const SUGGESTION_CONFIDENCE = 0.8
const MAX_ATTEMPTS = 5
const GIVE_UP_MS = 60 * 60_000

export type Outgoing = { ok: boolean; text: string; posted?: boolean }

export type Session = {
	issue: string
	issueId?: string
	sources: (string | undefined)[]
	prompt: string
	mode?: string
	project?: string
	threadID?: string
	status: 'new' | 'awaiting-project' | 'starting' | 'running' | 'idle' | 'stopped' | 'failed'
	/** Transcript index from which turn-ending replies have not yet been queued for Linear. */
	reported: number
	/**
	 * Follow-ups sent since the session was last idle, and how many user messages the transcript had
	 * before the first of them. A follow-up sent to a busy thread is queued and only appears after the
	 * current reply, so the session is not idle until all of these texts have landed. Extra copies
	 * (from an ambiguous failed send) are harmless; a text that never matches only costs polling,
	 * because replies are posted whether or not the session is idle.
	 */
	inflight: string[]
	inflightBase: number
	/** Replies waiting to be posted to Linear, oldest first. */
	outbox: Outgoing[]
	/** Prompt activity IDs already relayed to the thread. */
	seen: string[]
	lastProgress?: string
	updatedAt: number
}

export type PendingEvent = { id: string; sessionId: string; payload: any; attempts: number }

const userTexts = (messages: ExportedMessage[]) => messages
	.filter(m => m.role === 'user' && (m.content ?? []).some(b => b.type === 'text'))
	.map(m => (m.content ?? []).filter(b => b.type === 'text').map(b => b.text ?? '').join('\n').trim())

/** Whether every text in `expected` (counting repeats) appears in `landed`. */
function landedAll(landed: string[], expected: string[]): boolean {
	const counts = new Map<string, number>()
	for (const t of landed) counts.set(t, (counts.get(t) ?? 0) + 1)
	return expected.every(t => {
		const left = counts.get(t.trim()) ?? 0
		counts.set(t.trim(), left - 1)
		return left > 0
	})
}

export type State = {
	sessions: Record<string, Session>
	/** Recent Linear-Delivery IDs, for transport-level deduplication. */
	deliveries: string[]
	/** Accepted webhook events not yet fully processed; persisted before acknowledging Linear. */
	pending: PendingEvent[]
}

export interface Amp {
	listProjects(): Promise<Project[]>
	/** Start an orb thread and resolve with its ID once the first message is in the thread. */
	createThread(o: { project: string; prompt: string; title: string; mode?: string }): Promise<string>
	/** Add a user message to an orb thread (queued if a turn is running); resolves once it is in the thread. */
	send(threadID: string, message: string): Promise<void>
	messages(threadID: string): Promise<ExportedMessage[]>
	archive(threadID: string): Promise<void>
	/** Let workspace members contribute to the thread (Amp multiplayer, at most 7 days). */
	enableMultiplayer(threadID: string): Promise<void>
	threadURL(threadID: string): string
}

export interface Linear {
	activity(sessionId: string, content: Record<string, unknown>, extra?: Record<string, unknown>): Promise<void>
	addURLs(sessionId: string, urls: { label: string; url: string }[]): Promise<void>
	/** Rank candidate `owner/name` repositories for an issue. */
	suggest(issueId: string, sessionId: string, repos: string[]): Promise<{ repo: string; confidence: number }[]>
}

export type RelayOptions = {
	amp: Amp
	linear: Linear
	state: State
	/** Persist `state`; must reject on failure. */
	save(): Promise<void>
	webhookSecret: string
	defaultProject?: string
	defaultMode?: string
	/** Turn on multiplayer ("Contribute") for new threads. */
	multiplayer?: boolean
	log?(...args: unknown[]): void
	now?(): number
}

export function createRelay(o: RelayOptions) {
	const { amp, linear, state, save } = o
	const log = o.log ?? console.log
	const now = o.now ?? Date.now
	const queues = new Map<string, Promise<void>>()
	/** Admissions whose persistence has not finished; duplicates wait on them and workers skip them. */
	const admitting = new Map<string, Promise<number>>()

	/** Serialize work per Linear session; different sessions run concurrently. Never rejects. */
	const enqueue = (key: string, fn: () => Promise<void>) => {
		const next = (queues.get(key) ?? Promise.resolve()).then(fn).catch(e => log('session', key, 'failed', e))
		queues.set(key, next)
		void next.then(() => { if (queues.get(key) === next) queues.delete(key) })
		return next
	}
	const quietly = async (what: string, fn: () => Promise<unknown>) => {
		try { await fn() } catch (e) { log(`${what} failed`, e) }
	}
	const label = (p: Project) => p.repo ?? p.ref
	const touch = (s: Session, patch: Partial<Session>) => Object.assign(s, patch, { updatedAt: now() })

	// --- starting a thread ---------------------------------------------------------

	/**
	 * Start the thread. Throws only if the 'starting' checkpoint cannot be saved, in which case nothing
	 * happened and the session is unchanged. `activityId` (the prompt that chose the project) is
	 * marked handled in that same checkpoint, so a retry can never replay it as a follow-up.
	 */
	const start = async (id: string, project: Project, how: string, activityId?: string) => {
		const s = state.sessions[id]
		const before = { project: s.project, status: s.status, seen: s.seen, updatedAt: s.updatedAt }
		touch(s, { project: project.ref, status: 'starting', seen: activityId ? [...s.seen, activityId].slice(-50) : s.seen })
		try {
			await save()
		} catch (e) {
			Object.assign(s, before)
			throw e
		}
		// From here on, in-memory state is authoritative; later saves will persist it.
		await quietly('activity', () => linear.activity(id, { type: 'thought', body: `Using \`${label(project)}\` (from ${how}). Starting an Amp orb…` }))
		let threadID: string
		try {
			threadID = await amp.createThread({ project: project.ref, prompt: threadPrompt(project, s.prompt), title: s.issue, mode: s.mode })
		} catch (e) {
			touch(s, { status: 'failed' })
			await quietly('save', save)
			await quietly('activity', () => linear.activity(id, { type: 'error', body: `Could not start an Amp thread: ${String(e).slice(0, 1000)}` }))
			return
		}
		touch(s, { threadID, status: 'running', reported: 0, inflight: [], inflightBase: 0 })
		await quietly('save', save)
		if (o.multiplayer) await quietly('multiplayer', () => amp.enableMultiplayer(threadID))
		await quietly('session URL', () => linear.addURLs(id, [{ label: 'Amp thread', url: amp.threadURL(threadID) }]))
	}

	const chooseProject = async (id: string) => {
		const s = state.sessions[id]
		const projects = await amp.listProjects()
		const resolved = resolveProject(s.sources, projects, o.defaultProject)
		if ('project' in resolved) return start(id, resolved.project, resolved.how)

		let candidates = resolved.candidates
		if (s.issueId) {
			const repos = candidates.map(p => p.repo).filter((r): r is string => !!r)
			const ranked = (await linear.suggest(s.issueId, id, repos).catch(e => (log('suggestions failed', e), [])))
				.sort((a, b) => b.confidence - a.confidence)
				.map(r => ({ ...r, project: candidates.find(p => p.repo === r.repo.toLowerCase()) }))
				.filter((r): r is typeof r & { project: Project } => !!r.project)
			const [top, second] = ranked
			if (top && top.confidence >= SUGGESTION_CONFIDENCE && !(second && second.confidence >= SUGGESTION_CONFIDENCE))
				return start(id, top.project, 'Linear repository suggestions')
			candidates = [...ranked.map(r => r.project), ...candidates.filter(c => !ranked.some(r => r.project === c))]
		}
		touch(s, { status: 'awaiting-project' })
		await save()
		await linear.activity(id, {
			type: 'elicitation',
			body: 'Which Amp project should I work in? Pick one or reply with `owner/repo`. Next time, add `[repo=owner/repo]` to the issue description.',
		}, {
			signal: 'select',
			signalMetadata: { options: candidates.slice(0, 15).map(p => ({ label: label(p), value: p.repo ? `https://github.com/${p.repo}` : p.ref })) },
		})
	}

	// --- webhook events ------------------------------------------------------------

	/** Handlers throw only when a retry is safe: nothing irreversible happened yet. */
	const onCreated = async (payload: any) => {
		const session = payload.agentSession
		if (state.sessions[session.id]) return
		const issue = session.issue
		const comment = session.comment?.body as string | undefined
		const sources = [comment, issue?.description]
		state.sessions[session.id] = {
			issue: issue ? `${issue.identifier}: ${issue.title}` : 'Linear request',
			issueId: issue?.id,
			sources,
			prompt: payload.promptContext ?? [issue?.title, issue?.description, comment].filter(Boolean).join('\n\n'),
			mode: parseOption(sources, 'mode') ?? o.defaultMode,
			status: 'new', reported: 0, inflight: [], inflightBase: 0, outbox: [], seen: [], updatedAt: now(),
		}
		try {
			await save()
		} catch (e) {
			delete state.sessions[session.id] // so the retry starts over
			throw e
		}
		try {
			await linear.activity(session.id, { type: 'thought', body: 'Choosing an Amp project for this issue…' })
			await chooseProject(session.id)
		} catch (e) {
			touch(state.sessions[session.id], { status: 'failed' })
			await quietly('save', save)
			await quietly('activity', () => linear.activity(session.id, { type: 'error', body: `Could not start: ${String(e).slice(0, 1000)}` }))
		}
	}

	const send = async (id: string, body: string) => {
		const s = state.sessions[id]
		const landed = userTexts(await amp.messages(s.threadID!)).length
		// Record every attempt before making it: a send that reports failure may still have queued the
		// message, and that copy must not be mistaken for a later follow-up with the same text.
		const before = { status: s.status, inflight: s.inflight, inflightBase: s.inflightBase, lastProgress: s.lastProgress, updatedAt: s.updatedAt }
		touch(s, {
			status: 'running',
			inflightBase: s.inflight.length ? s.inflightBase : landed,
			inflight: [...s.inflight, body],
			lastProgress: undefined,
		})
		try {
			await save()
		} catch (e) {
			Object.assign(s, before)
			throw e
		}
		await amp.send(s.threadID!, body)
	}

	const onPrompted = async (payload: any) => {
		const id = payload.agentSession.id
		const act = payload.agentActivity
		const s = state.sessions[id]
		if (!s) {
			await linear.activity(id, { type: 'error', body: 'The Amp relay has no record of this session. Mention me again to start a new thread.' })
			return
		}
		if (s.seen.includes(act.id)) return
		const done = async () => {
			s.seen = [...s.seen, act.id].slice(-50)
			await save()
		}
		const body = String(act.content?.body ?? act.body ?? '')

		if (act.signal === 'stop') {
			if (s.threadID && s.status !== 'stopped') await amp.archive(s.threadID)
			touch(s, { status: 'stopped' })
			await done()
			await quietly('activity', () => linear.activity(id, { type: 'response', body: 'Stopped: the Amp thread was archived. Unarchive it in Amp to look at or continue the work, or mention me again to start over.' }))
			return
		}
		switch (s.status) {
			case 'awaiting-project': {
				const project = matchProject(body, await amp.listProjects())
				if (project) return start(id, project, 'your reply', act.id)
				await linear.activity(id, { type: 'elicitation', body: `I could not match \`${body.slice(0, 200)}\` to an Amp project. Reply with \`owner/repo\`.` })
				await done()
				return
			}
			case 'running':
			case 'idle':
				await send(id, body)
				await done()
				await quietly('activity', () => linear.activity(id, { type: 'thought', body: 'Sent to the Amp thread.' }))
				return
			case 'stopped':
				await linear.activity(id, { type: 'error', body: 'This session was stopped and its Amp thread archived. Mention me again to start a new one.' })
				await done()
				return
			default:
				await linear.activity(id, { type: 'error', body: 'The Amp thread for this session did not start. Mention me again to retry.' })
				await done()
		}
	}

	/**
	 * Process a session's committed pending events oldest-first. A failed event stays at the head and
	 * blocks later ones until a retry succeeds, so follow-ups reach the thread in order.
	 */
	const drain = (sessionId: string) => enqueue(sessionId, async () => {
		for (;;) {
			const ev = state.pending.find(e => e.sessionId === sessionId)
			if (!ev || admitting.has(ev.id)) return
			try {
				if (ev.payload.action === 'created') await onCreated(ev.payload)
				else if (ev.payload.action === 'prompted') await onPrompted(ev.payload)
				state.pending = state.pending.filter(e => e !== ev)
				await save()
			} catch (e) {
				ev.attempts++
				log('event', ev.id, 'attempt', ev.attempts, 'failed', e)
				if (ev.attempts < MAX_ATTEMPTS) {
					await quietly('save', save)
					return
				}
				state.pending = state.pending.filter(x => x !== ev)
				await quietly('save', save)
				await quietly('activity', () => linear.activity(sessionId, { type: 'error', body: `The Amp relay could not process this request: ${String(e).slice(0, 500)}` }))
			}
		}
	})

	// --- watching threads ------------------------------------------------------------

	const flush = async (id: string) => {
		const s = state.sessions[id]
		while (s.outbox.length) {
			const reply = s.outbox[0]
			if (!reply.posted) {
				await linear.activity(id, { type: reply.ok ? 'response' : 'error', body: (reply.text || '(no reply)').slice(0, MAX_BODY) })
				reply.posted = true
				await save()
			}
			const prs = pullRequestURLs(reply.text)
			if (prs.length) await linear.addURLs(id, prs.map(url => ({ label: 'Pull request', url })))
			s.outbox.shift()
			await save()
		}
	}

	const poll = async (id: string) => {
		const s = state.sessions[id]
		if (s.status === 'running' && s.threadID) {
			const messages = await amp.messages(s.threadID)
			const scan = scanTranscript(messages, s.reported)
			let progress: string | undefined
			if (scan.replies.length) {
				s.outbox.push(...scan.replies.map(r => ({ ok: r.ok, text: r.text })))
				s.reported = scan.replies.at(-1)!.index + 1
			}
			// Activity (a turn in progress or a new reply) restarts the give-up clock below.
			if (!scan.idle || scan.replies.length) touch(s, {})
			// Idle once every attempted follow-up has landed. If the thread has sat idle for an hour with
			// no new activity, the missing ones (failed sends) are never coming.
			if (scan.idle && (landedAll(userTexts(messages).slice(s.inflightBase), s.inflight) || now() - s.updatedAt > GIVE_UP_MS))
				touch(s, { status: 'idle', inflight: [], lastProgress: undefined })
			else if (scan.progress && scan.progress !== s.lastProgress) progress = s.lastProgress = scan.progress
			await save()
			if (progress) await quietly('progress', () => linear.activity(id, { type: 'action', action: 'Working', parameter: progress }, { ephemeral: true }))
		}
		await flush(id)
	}

	// --- public API ------------------------------------------------------------------

	return {
		/**
		 * Verify, persist, and acknowledge a Linear webhook. A non-200 status tells Linear to retry.
		 * Processing continues after this resolves; `work` is exposed for tests.
		 */
		async receive(body: Uint8Array, signature: string | null, deliveryId: string | null): Promise<{ status: number; work?: Promise<void> }> {
			if (!verifySignature(body, signature, o.webhookSecret)) return { status: 401 }
			let payload: any
			try { payload = JSON.parse(new TextDecoder().decode(body)) } catch { return { status: 400 } }
			if (!payload || typeof payload !== 'object') return { status: 400 }
			const ts = payload.webhookTimestamp
			if (typeof ts !== 'number' || !Number.isFinite(ts) || Math.abs(now() - ts) > TIMESTAMP_TOLERANCE_MS) return { status: 400 }
			if (payload.type !== 'AgentSessionEvent' || !['created', 'prompted'].includes(payload.action)) return { status: 200 }
			const sessionId = payload.agentSession?.id
			if (typeof sessionId !== 'string' || (payload.action === 'prompted' && typeof payload.agentActivity?.id !== 'string'))
				return { status: 400 }

			const id = deliveryId || createHash('sha256').update(body).digest('hex')
			const inFlight = admitting.get(id)
			if (inFlight) return { status: await inFlight }
			if (state.deliveries.includes(id)) return { status: 200 }
			const event: PendingEvent = { id, sessionId, payload, attempts: 0 }
			state.pending.push(event)
			state.deliveries = [...state.deliveries, id].slice(-1000)
			const admission = save().then(() => 200, e => {
				log('could not persist event', id, e)
				state.pending = state.pending.filter(x => x !== event)
				state.deliveries = state.deliveries.filter(x => x !== id)
				return 503
			})
			admitting.set(id, admission)
			const status = await admission
			admitting.delete(id)
			return status === 200 ? { status, work: drain(sessionId) } : { status }
		},

		/** Retry pending events, poll running threads, and post queued replies. Call periodically. */
		async tick() {
			const work: Promise<void>[] = []
			const watched = (id: string) => !!state.sessions[id] && (state.sessions[id].status === 'running' || state.sessions[id].outbox.length > 0)
			const ids = new Set([...state.pending.map(e => e.sessionId), ...Object.keys(state.sessions).filter(watched)])
			for (const id of ids) {
				// Skip sessions with work in flight so one slow session never delays the others.
				if (queues.has(id)) continue
				if (watched(id)) work.push(enqueue(id, () => poll(id)))
				if (state.pending.some(e => e.sessionId === id)) work.push(drain(id))
			}
			await Promise.all(work)
		},

		/** Call once at startup, before accepting webhooks. */
		async recover() {
			for (const [id, s] of Object.entries(state.sessions)) {
				// A thread mid-start may or may not exist; report rather than risk a duplicate.
				if (s.status === 'starting' || s.status === 'new') {
					touch(s, { status: 'failed' })
					await quietly('activity', () => linear.activity(id, { type: 'error', body: 'The Amp relay restarted while starting this thread. Mention me again to retry.' }))
				}
				if (s.status !== 'running' && !s.outbox.length && now() - s.updatedAt > 30 * 86_400_000) delete state.sessions[id]
			}
			await save()
		},
	}
}
