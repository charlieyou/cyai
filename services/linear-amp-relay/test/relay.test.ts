import { beforeEach, expect, test } from 'bun:test'
import { createHmac } from 'node:crypto'
import { matchProject, parseOption, pullRequestURLs, resolveProject, scanTranscript, toProjects, verifySignature, type ExportedMessage } from '../src/core'
import { createRelay, type Amp, type Linear, type Session, type State } from '../src/relay'

const projects = toProjects([
	{ namespace: 'me', name: 'poker', repositoryURL: 'https://github.com/charlieyou/poker' },
	{ namespace: 'me', name: 'cyai', repositoryURL: 'https://github.com/charlieyou/cyai', remoteURLs: ['git@github.com:charlieyou/cyai.git'] },
])

// --- core --------------------------------------------------------------------

test('verifySignature checks the HMAC of the raw body', () => {
	const body = new TextEncoder().encode('{"a":1}')
	const sig = createHmac('sha256', 's').update(body).digest('hex')
	expect(verifySignature(body, sig, 's')).toBe(true)
	expect(verifySignature(body, sig, 'other')).toBe(false)
	expect(verifySignature(body, null, 's')).toBe(false)
	expect(verifySignature(body, 'zz', 's')).toBe(false)
})

test('parseOption prefers the comment over the description', () => {
	expect(parseOption(['please [repo=a/b]', '[repo=c/d]'], 'repo')).toBe('a/b')
	expect(parseOption([undefined, 'Fix [ Repo = c/d ] and [mode=high]'], 'repo')).toBe('c/d')
	expect(parseOption(['[project=me/poker]'], 'repo')).toBe('me/poker')
	expect(parseOption(['[mode=high]'], 'mode')).toBe('high')
	expect(parseOption(['no options'], 'repo')).toBeUndefined()
})

test('resolveProject: explicit option, then a single mention, then default, else candidates', () => {
	const ref = (r: ReturnType<typeof resolveProject>) => ('project' in r ? r.project.ref : r.candidates.map(p => p.ref))
	expect(ref(resolveProject(['[repo=charlieyou/cyai] see charlieyou/poker'], projects))).toBe('me/cyai')
	expect(ref(resolveProject(['[repo=poker]'], projects))).toBe('me/poker')
	expect(ref(resolveProject(['[repo=https://github.com/charlieyou/poker]'], projects))).toBe('me/poker')
	expect(ref(resolveProject(['bug in https://github.com/charlieyou/poker/blob/main/x.ts'], projects))).toBe('me/poker')
	expect(ref(resolveProject(['touches charlieyou/poker and charlieyou/cyai'], projects))).toEqual(['me/poker', 'me/cyai'])
	expect(ref(resolveProject(['nothing here'], projects, 'charlieyou/cyai'))).toBe('me/cyai')
	expect(ref(resolveProject(['nothing here'], projects))).toEqual(['me/poker', 'me/cyai'])
	expect(matchProject('https://github.com/charlieyou/cyai', projects)?.ref).toBe('me/cyai')
	expect(matchProject('unknown/repo', projects)).toBeUndefined()
})

const user = (text = ''): ExportedMessage => ({ role: 'user', content: [{ type: 'text', text }] })
const done = (text: string): ExportedMessage => ({ role: 'assistant', state: { type: 'complete', stopReason: 'end_turn' }, content: [{ type: 'text', text }] })
const tool = (name: string, input: unknown = {}): ExportedMessage => ({ role: 'assistant', state: { type: 'complete', stopReason: 'tool_use' }, content: [{ type: 'tool_use', name, input }] })

test('scanTranscript reports every finished turn, idleness, and tool names only', () => {
	expect(scanTranscript([user(), tool('shell_command', { command: 'curl -H "Authorization: Bearer s3cret"' })], 0))
		.toEqual({ replies: [], idle: false, progress: 'shell_command' })
	const two = [user(), done('A'), user(), tool('edit_file'), { role: 'user', content: [] }, done('B')]
	expect(scanTranscript(two, 0)).toEqual({ replies: [{ index: 1, ok: true, text: 'A' }, { index: 5, ok: true, text: 'B' }], idle: true, progress: undefined })
	expect(scanTranscript(two, 2).replies.map(r => r.text)).toEqual(['B'])
	expect(scanTranscript([user(), { role: 'assistant', state: { type: 'error', error: { message: 'boom' } }, content: [] }], 0).replies)
		.toEqual([{ index: 1, ok: false, text: 'boom' }])
	expect(scanTranscript([user(), { role: 'assistant', state: { type: 'streaming' }, content: [] }], 0)).toEqual({ replies: [], idle: false, progress: undefined })
	expect(pullRequestURLs('https://github.com/a/b/pull/12 and https://github.com/a/b/pull/12')).toEqual(['https://github.com/a/b/pull/12'])
})

// --- relay -------------------------------------------------------------------

const SECRET = 'whsec'
let state: State
let transcript: ExportedMessage[]
let suggestions: { repo: string; confidence: number }[]
let calls: { fn: string; args: any[] }[]
let failing: Set<string>
let saveFails: boolean
let saveGate: Promise<void> | undefined
let queued: string[]
let clock: number
let relay: ReturnType<typeof createRelay>

const amp: Amp = {
	listProjects: async () => projects,
	createThread: async o => { calls.push({ fn: 'createThread', args: [o] }); transcript = [user('prompt')]; return 'T-1' },
	send: async (id, m) => {
		if (failing.has('send')) throw new Error('send failed')
		calls.push({ fn: 'send', args: [id, m] })
		if (failing.has('send-after-queue')) {
			// Ambiguous failure: the message was accepted, but the CLI reported an error.
			failing.delete('send-after-queue')
			queued.push(m)
			throw new Error('connection reset')
		}
		// Like Amp: a message sent to a busy thread is queued and lands after the current reply.
		if (failing.has('busy')) queued.push(m)
		else transcript = [...transcript, user(m)]
	},
	messages: async () => transcript,
	archive: async id => { calls.push({ fn: 'archive', args: [id] }) },
	enableMultiplayer: async id => { calls.push({ fn: 'enableMultiplayer', args: [id] }) },
	threadURL: id => `https://ampcode.com/threads/${id}`,
}
const linear: Linear = {
	activity: async (...args) => {
		if (failing.has(`activity:${(args[1] as any).type}`)) throw new Error('linear down')
		calls.push({ fn: 'activity', args })
	},
	addURLs: async (...args) => { calls.push({ fn: 'addURLs', args }) },
	suggest: async (...args) => { calls.push({ fn: 'suggest', args }); return suggestions },
	branchName: async id => { if (failing.has('branch')) throw new Error('no'); return `amp/${id}-fix-it` },
}
const makeRelay = () => createRelay({
	amp, linear, state, webhookSecret: SECRET, log() {}, now: () => clock, multiplayer: true,
	save: async () => {
		const gate = saveGate
		if (gate) await gate
		if (saveFails) throw new Error('disk full')
	},
})

beforeEach(() => {
	state = { sessions: {}, deliveries: [], pending: [] }
	transcript = []
	suggestions = []
	calls = []
	failing = new Set()
	saveFails = false
	saveGate = undefined
	queued = []
	clock = 1_000_000
	relay = makeRelay()
})

let n = 0
function sign(payload: unknown, secret = SECRET) {
	const body = new TextEncoder().encode(JSON.stringify(payload))
	return { body, sig: createHmac('sha256', secret).update(body).digest('hex') }
}
function receive(payload: object, opts: { secret?: string; delivery?: string } = {}) {
	// Linear's `webhookId` identifies the webhook, not the delivery, so it is the same for every event.
	const { body, sig } = sign({ webhookTimestamp: clock, webhookId: 'hook-1', ...payload }, opts.secret)
	return relay.receive(body, sig, opts.delivery ?? `d${++n}`)
}
async function deliver(payload: object, opts: { secret?: string; delivery?: string } = {}) {
	const r = await receive(payload, opts)
	await r.work
	return r.status
}
const created = (id: string, description: string, comment?: string) => ({
	type: 'AgentSessionEvent', action: 'created', promptContext: `<issue>${description}</issue>`,
	agentSession: { id, issue: { id: `issue-${id}`, identifier: 'ENG-1', title: 'Fix it', description }, comment: comment && { body: comment } },
})
const prompted = (id: string, activityId: string, body: string, signal?: string) => ({
	type: 'AgentSessionEvent', action: 'prompted', agentSession: { id }, agentActivity: { id: activityId, content: { type: 'prompt', body }, signal },
})
const activities = () => calls.filter(c => c.fn === 'activity').map(c => ({ ...c.args[1], ...c.args[2] }))
const responses = () => activities().filter(a => a.type === 'response').map(a => a.body)

test('rejects bad signatures and malformed or stale payloads', async () => {
	expect(await deliver(created('s', '[repo=poker]'), { secret: 'wrong' })).toBe(401)
	for (const bad of [null, [], { ...created('s', ''), webhookTimestamp: 'x' }, { ...created('s', ''), webhookTimestamp: null },
		{ ...created('s', ''), webhookTimestamp: clock - 10 * 60_000 }, { type: 'AgentSessionEvent', action: 'created', webhookTimestamp: clock },
		{ ...prompted('s', 'a', 'x'), agentActivity: {}, webhookTimestamp: clock }]) {
		const { body, sig } = sign(bad)
		expect((await relay.receive(body, sig, 'x')).status).toBe(400)
	}
	expect(state.pending).toEqual([])
	expect(calls).toEqual([])
})

test('deduplicates by delivery, not webhook ID', async () => {
	await deliver(created('s1', '[repo=poker]'), { delivery: 'same' })
	await deliver(created('s1', '[repo=poker]'), { delivery: 'same' })
	await deliver(created('s2', '[repo=cyai]'))
	await deliver(prompted('s1', 'a1', 'more'))
	await deliver(prompted('s1', 'a1', 'more'))
	expect(calls.filter(c => c.fn === 'createThread').map(c => c.args[0].project)).toEqual(['me/poker', 'me/cyai'])
	expect(calls.filter(c => c.fn === 'send')).toHaveLength(1)
	expect(state.pending).toEqual([])
})

test('a webhook that cannot be persisted is refused so Linear retries it', async () => {
	saveFails = true
	expect(await deliver(created('s1', '[repo=poker]'), { delivery: 'd-x' })).toBe(503)
	expect(state.pending).toEqual([])
	saveFails = false
	expect(await deliver(created('s1', '[repo=poker]'), { delivery: 'd-x' })).toBe(200)
	expect(calls.filter(c => c.fn === 'createThread')).toHaveLength(1)
})

test('pending events survive a restart and are processed by tick', async () => {
	state.pending.push({ id: 'd1', sessionId: 's1', payload: { ...created('s1', '[repo=poker]'), webhookTimestamp: clock }, attempts: 0 })
	relay = makeRelay()
	await relay.recover()
	await relay.tick()
	expect(calls.find(c => c.fn === 'createThread')!.args[0].project).toBe('me/poker')
	expect(state.pending).toEqual([])
})

test('delegation with [repo=...] starts a thread and posts each reply once', async () => {
	await deliver(created('s1', 'Fix the bug [repo=charlieyou/poker]', 'please [mode=high]'))
	expect(activities()[0]).toEqual({ type: 'thought', body: 'Choosing an Amp project for this issue…' })
	const create = calls.find(c => c.fn === 'createThread')!.args[0]
	expect(create).toMatchObject({ project: 'me/poker', title: 'ENG-1: Fix it', mode: 'high' })
	expect(create.prompt).toContain('<issue>Fix the bug')
	expect(create.prompt).toContain('on the branch `amp/issue-s1-fix-it`')
	expect(create.prompt).toContain('gh pr create --draft')
	expect(calls.find(c => c.fn === 'addURLs')!.args[1]).toEqual([{ label: 'Amp thread', url: 'https://ampcode.com/threads/T-1' }])
	expect(calls.find(c => c.fn === 'enableMultiplayer')!.args).toEqual(['T-1'])

	await relay.tick()
	expect(responses()).toEqual([])
	transcript = [...transcript, tool('shell_command', { command: 'echo TOKEN=s3cret' })]
	await relay.tick()
	expect(activities().at(-1)).toEqual({ type: 'action', action: 'Working', parameter: 'shell_command', ephemeral: true })
	expect(JSON.stringify(calls)).not.toContain('s3cret')

	transcript = [...transcript, user(), done('Fixed. https://github.com/charlieyou/poker/pull/7')]
	await relay.tick()
	expect(responses()).toEqual(['Fixed. https://github.com/charlieyou/poker/pull/7'])
	expect(calls.at(-1)).toEqual({ fn: 'addURLs', args: ['s1', [{ label: 'Pull request', url: 'https://github.com/charlieyou/poker/pull/7' }]] })
	expect(state.sessions.s1.status).toBe('idle')
	await relay.tick()
	expect(responses()).toHaveLength(1)

	await deliver(prompted('s1', 'a1', 'Also add a test'))
	expect(calls.filter(c => c.fn === 'send')).toEqual([{ fn: 'send', args: ['T-1', 'Also add a test'] }])
	await relay.tick()
	expect(responses()).toHaveLength(1)
	transcript = [...transcript, done('Test added.')]
	await relay.tick()
	expect(responses().at(-1)).toBe('Test added.')
})

test('two turns that finish between polls are both posted', async () => {
	await deliver(created('s1', '[repo=poker]'))
	await deliver(prompted('s1', 'a1', 'second'))
	transcript = [user('prompt'), done('first answer'), user('second'), done('second answer')]
	await relay.tick()
	expect(responses()).toEqual(['first answer', 'second answer'])
})

test('a reply that fails to post is retried, not lost', async () => {
	await deliver(created('s1', '[repo=poker]'))
	transcript = [...transcript, done('result')]
	failing.add('activity:response')
	await relay.tick()
	expect(responses()).toEqual([])
	expect(state.sessions.s1.outbox).toHaveLength(1)
	failing.delete('activity:response')
	await relay.tick()
	expect(responses()).toEqual(['result'])
	expect(state.sessions.s1.outbox).toEqual([])
})

test('a follow-up that fails to send stays pending and is retried', async () => {
	await deliver(created('s1', '[repo=poker]'))
	transcript = [...transcript, done('first')]
	await relay.tick()
	failing.add('send')
	await deliver(prompted('s1', 'a1', 'again'))
	expect(state.pending).toHaveLength(1)
	expect(state.sessions.s1.status).toBe('running') // the attempt may have queued the message
	failing.delete('send')
	await relay.tick()
	expect(calls.filter(c => c.fn === 'send')).toEqual([{ fn: 'send', args: ['T-1', 'again'] }])
	expect(state.pending).toEqual([])
	expect(state.sessions.s1.status).toBe('running')
})

test('without a repo it asks with a picker, then starts in the chosen project', async () => {
	suggestions = [{ repo: 'charlieyou/cyai', confidence: 0.5 }]
	await deliver(created('s2', 'Something is broken'))
	expect(calls.find(c => c.fn === 'suggest')!.args).toEqual(['issue-s2', 's2', ['charlieyou/poker', 'charlieyou/cyai']])
	const ask = activities().find(a => a.type === 'elicitation')!
	expect(ask.signal).toBe('select')
	expect(ask.signalMetadata.options.map((o: any) => o.label)).toEqual(['charlieyou/cyai', 'charlieyou/poker'])

	await deliver(prompted('s2', 'a2', 'nonsense'))
	expect(activities().at(-1)!.type).toBe('elicitation')
	await deliver(prompted('s2', 'a3', 'https://github.com/charlieyou/cyai'))
	expect(calls.find(c => c.fn === 'createThread')!.args[0].project).toBe('me/cyai')
})

test('one confident Linear suggestion is used without asking', async () => {
	suggestions = [{ repo: 'charlieyou/poker', confidence: 0.93 }, { repo: 'charlieyou/cyai', confidence: 0.2 }]
	await deliver(created('s3', 'Something is broken'))
	expect(activities().some(a => a.type === 'elicitation')).toBe(false)
	expect(calls.find(c => c.fn === 'createThread')!.args[0].project).toBe('me/poker')
})

test('stop archives the thread', async () => {
	await deliver(created('s4', '[repo=poker]'))
	await deliver(prompted('s4', 'a4', '', 'stop'))
	expect(calls.find(c => c.fn === 'archive')!.args).toEqual(['T-1'])
	expect(activities().at(-1)!.type).toBe('response')
	await deliver(prompted('s4', 'a5', 'keep going'))
	expect(activities().at(-1)!.type).toBe('error')
	expect(calls.some(c => c.fn === 'send')).toBe(false)
})

test('recover marks interrupted starts as failed', async () => {
	const s: Session = { issue: 'i', sources: [], prompt: '', status: 'starting', reported: 0, inflight: [], inflightBase: 0, outbox: [], seen: [], updatedAt: clock }
	state.sessions.x = s
	await relay.recover()
	expect(s.status).toBe('failed')
	expect(activities()[0].type).toBe('error')
})

test('a duplicate delivery waits for the first admission and shares its outcome', async () => {
	let release!: () => void
	saveGate = new Promise(r => { release = r })
	saveFails = true
	const first = receive(created('s1', '[repo=poker]'), { delivery: 'dup' })
	const second = receive(created('s1', '[repo=poker]'), { delivery: 'dup' })
	await relay.tick()
	expect(calls).toEqual([])
	release()
	expect((await first).status).toBe(503)
	expect((await second).status).toBe(503)
	expect(state.pending).toEqual([])
	expect(state.deliveries).toEqual([])
})

test('follow-ups reach the thread in order even when one fails first', async () => {
	await deliver(created('s1', '[repo=poker]'))
	transcript = [...transcript, done('first')]
	await relay.tick()
	failing.add('send')
	await deliver(prompted('s1', 'a', 'A'))
	failing.delete('send')
	expect(state.pending.map(e => e.payload.agentActivity.id)).toEqual(['a'])
	await deliver(prompted('s1', 'b', 'B')) // wakes the session: retries A first, then B
	expect(calls.filter(c => c.fn === 'send').map(c => c.args[1])).toEqual(['A', 'B'])
	expect(state.pending).toEqual([])
})

test('a session whose first save fails is recreated on retry', async () => {
	let saves = 0
	saveGate = undefined
	const realSaveFails = () => saves++ === 1 // admission save succeeds, onCreated's first save fails
	relay = createRelay({ amp, linear, state, webhookSecret: SECRET, log() {}, now: () => clock,
		save: async () => { if (realSaveFails()) throw new Error('disk full') } })
	await deliver(created('s1', '[repo=poker]'))
	expect(state.sessions.s1).toBeUndefined()
	expect(state.pending).toHaveLength(1)
	await relay.tick()
	expect(calls.filter(c => c.fn === 'createThread')).toHaveLength(1)
	expect(state.sessions.s1.status).toBe('running')
})

test('a project reply whose start checkpoint fails is retried as a project reply', async () => {
	await deliver(created('s2', 'Something is broken'))
	expect(state.sessions.s2.status).toBe('awaiting-project')
	let fail = false
	relay = createRelay({ amp, linear, state, webhookSecret: SECRET, log() {}, now: () => clock,
		save: async () => { if (fail) { fail = false; throw new Error('disk full') } } })
	const r = await receive(prompted('s2', 'a1', 'charlieyou/cyai'))
	fail = true // the admission save already ran; fail the next one (start's checkpoint)
	await r.work
	expect(state.sessions.s2.status).toBe('awaiting-project')
	expect(calls.some(c => c.fn === 'createThread')).toBe(false)
	await relay.tick()
	expect(calls.find(c => c.fn === 'createThread')!.args[0].project).toBe('me/cyai')
	expect(state.sessions.s2.seen).toContain('a1')
	expect(calls.some(c => c.fn === 'send')).toBe(false)
})

test('a follow-up queued behind a busy turn keeps the session running until its reply', async () => {
	await deliver(created('s1', '[repo=poker]'))
	transcript = [...transcript, tool('shell_command')]
	failing.add('busy')
	await deliver(prompted('s1', 'a1', 'also this'))
	clock += 61 * 60_000 // a long turn must not expire the queued follow-up
	transcript = [...transcript, { role: 'user', content: [{ type: 'tool_result' }] }, done('first done')]
	await relay.tick()
	expect(responses()).toEqual(['first done'])
	expect(state.sessions.s1.status).toBe('running')
	transcript = [...transcript, user(queued.shift()), done('second done')]
	await relay.tick()
	expect(responses()).toEqual(['first done', 'second done'])
	expect(state.sessions.s1.status).toBe('idle')
})

test('a later follow-up never bypasses an earlier one that is still failing', async () => {
	await deliver(created('s1', '[repo=poker]'))
	failing.add('send')
	await deliver(prompted('s1', 'a', 'A'))
	await deliver(prompted('s1', 'b', 'B'))
	await relay.tick()
	expect(state.pending.map(e => e.payload.agentActivity.id)).toEqual(['a', 'b'])
	failing.delete('send')
	await relay.tick()
	expect(calls.filter(c => c.fn === 'send').map(c => c.args[1])).toEqual(['A', 'B'])
})

test('an ambiguous failed send does not end polling before a later follow-up is answered', async () => {
	for (const second of ['B', 'A']) { // also when the later follow-up has the same text
		state.sessions = {}; state.pending = []; calls = []; queued = []; failing = new Set()
		await deliver(created('s1', '[repo=poker]'))
		transcript = [...transcript, tool('shell_command')]
		failing.add('busy')
		failing.add('send-after-queue')
		await deliver(prompted('s1', 'a', 'A')) // queued, but reported as failed
		await relay.tick() // retry: A is queued again
		await deliver(prompted('s1', 'b', second))
		expect(queued).toEqual(['A', 'A', second])
		const land = (text: string) => { transcript = [...transcript, user(queued.shift()), done(text)] }
		transcript = [...transcript, { role: 'user', content: [{ type: 'tool_result' }] }, done('initial')]
		land('A once')
		land('A twice')
		await relay.tick()
		expect(state.sessions.s1.status).toBe('running')
		land('second answer')
		await relay.tick()
		expect(responses()).toEqual(['initial', 'A once', 'A twice', 'second answer'])
		expect(state.sessions.s1.status).toBe('idle')
	}
})

test('a follow-up that never lands stops polling after an hour', async () => {
	await deliver(created('s1', '[repo=poker]'))
	transcript = [...transcript, done('first')]
	failing.add('send')
	await deliver(prompted('s1', 'a', 'lost'))
	while (state.pending.length) await relay.tick() // retries until the event is dropped
	expect(activities().at(-1)!.type).toBe('error')
	await relay.tick()
	expect(state.sessions.s1.status).toBe('running')
	clock += 61 * 60_000
	await relay.tick()
	expect(state.sessions.s1.status).toBe('idle')
	expect(responses()).toEqual(['first'])
})

test('without a branch name the prompt still asks for a draft PR named after the issue', async () => {
	failing.add('branch')
	await deliver(created('s1', '[repo=poker]'))
	const prompt = calls.find(c => c.fn === 'createThread')!.args[0].prompt
	expect(prompt).not.toContain('on the branch')
	expect(prompt).toContain('includes the Linear issue identifier')
})
