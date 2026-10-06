import { spawn } from 'node:child_process'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { toProjects, type ExportedMessage, type Project } from './core'
import { createRelay, type Amp, type Linear, type State } from './relay'

const LINEAR_API = process.env.LINEAR_API_URL ?? 'https://api.linear.app'
const LINEAR_SCOPES = 'read,write,app:assignable,app:mentionable'
const RUN_TIMEOUT_MS = 2 * 60_000
const DELIVER_TIMEOUT_MS = 5 * 60_000
const HTTP_TIMEOUT_MS = 8_000

function required(name: string): string {
	const v = process.env[name]
	if (!v) throw new Error(`Missing ${name}`)
	return v
}

// --- Amp, through the CLI (authenticated by AMP_API_KEY) ----------------------

export function cliAmp(bin = 'amp', ampURL = 'https://ampcode.com'): Amp {
	const run = (args: string[], timeoutMs = RUN_TIMEOUT_MS) => new Promise<string>((resolve, reject) => {
		const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
		let out = '', err = ''
		const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`amp ${args.slice(0, 2).join(' ')} timed out`)) }, timeoutMs)
		child.stdout.on('data', d => { out += d })
		child.stderr.on('data', d => { err = (err + d).slice(-2000) })
		child.on('error', e => { clearTimeout(timer); reject(e) })
		child.on('close', code => {
			clearTimeout(timer)
			code === 0 ? resolve(out) : reject(new Error(`amp ${args.slice(0, 2).join(' ')} exited ${code}: ${err}`))
		})
	})

	/**
	 * Run a remote execute command until the message is echoed back as in the thread, then detach.
	 * The orb keeps working after this process exits, so no process is held open for a whole turn.
	 * Anything short of that echo is a failure, even if a thread ID was printed.
	 */
	const deliver = (args: string[]) => new Promise<string>((resolve, reject) => {
		const child = spawn(bin, [...args, '--stream-json', '--no-archive-after-execute'], { stdio: ['ignore', 'pipe', 'pipe'] })
		let id: string | undefined, buf = '', err = '', settled = false
		const settle = (fn: () => void) => { if (!settled) { settled = true; clearTimeout(timer); child.kill(); fn() } }
		const fail = (why: string) => settle(() => reject(new Error(`${why}${id ? ` (thread ${id})` : ''}${err ? `: ${err.trim()}` : ''}`)))
		const timer = setTimeout(() => fail('Timed out waiting for the Amp thread'), DELIVER_TIMEOUT_MS)
		child.stderr.on('data', d => { err = (err + d).slice(-2000) })
		child.stdout.on('data', d => {
			buf += d
			for (let i; (i = buf.indexOf('\n')) >= 0;) {
				const line = buf.slice(0, i); buf = buf.slice(i + 1)
				let msg: any
				try { msg = JSON.parse(line) } catch { continue }
				if (msg.type === 'system' && msg.subtype === 'init') id = msg.session_id
				if (msg.type === 'user' && id) return settle(() => resolve(id!))
			}
		})
		child.on('error', e => settle(() => reject(e)))
		child.on('close', code => fail(`amp exited ${code} before the message reached the thread`))
	})

	let projects: { at: number; list: Promise<Project[]> } | undefined
	return {
		listProjects() {
			if (!projects || Date.now() - projects.at > 5 * 60_000) {
				const list = run(['projects', 'list', '--json']).then(out => toProjects(JSON.parse(out)))
				list.catch(() => { projects = undefined })
				projects = { at: Date.now(), list }
			}
			return projects.list
		},
		createThread: ({ project, prompt, title, mode }) =>
			deliver(['--orb-execute', '--project', project, '--title', title, ...(mode ? ['--mode', mode] : []), '--execute', prompt]),
		send: async (threadID, message) => { await deliver(['threads', 'continue', threadID, '--orb-execute', '--execute', message]) },
		messages: async threadID => (JSON.parse(await run(['threads', 'export', threadID])) as { messages: ExportedMessage[] }).messages,
		archive: async threadID => { await run(['threads', 'archive', threadID]) },
		threadURL: threadID => new URL(`/threads/${threadID}`, ampURL).toString(),
	}
}

// --- Linear (app actor via client credentials) -------------------------------

export function linearClient(clientID: string, clientSecret: string, state: { token?: { value: string; expiresAt: number } }, save: () => Promise<void>): Linear {
	const token = async (refresh: boolean) => {
		if (!refresh && state.token && state.token.expiresAt > Date.now() + 60_000) return state.token.value
		const res = await fetch(`${LINEAR_API}/oauth/token`, {
			method: 'POST',
			signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientID, client_secret: clientSecret, scope: LINEAR_SCOPES }),
		})
		if (!res.ok) throw new Error(`Linear token request failed: ${res.status} ${await res.text()}`)
		const json = await res.json() as { access_token: string; expires_in: number }
		state.token = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 }
		await save()
		return json.access_token
	}
	const gql = async <T>(query: string, variables: Record<string, unknown>, refresh = false): Promise<T> => {
		const res = await fetch(`${LINEAR_API}/graphql`, {
			method: 'POST',
			signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token(refresh)}` },
			body: JSON.stringify({ query, variables }),
		})
		if (res.status === 401 && !refresh) return gql(query, variables, true)
		const json = await res.json() as { data?: T; errors?: { message: string; extensions?: { code?: string } }[] }
		if (json.errors?.length) {
			if (!refresh && json.errors.some(e => e.extensions?.code === 'AUTHENTICATION_ERROR')) return gql(query, variables, true)
			throw new Error(`Linear: ${json.errors.map(e => e.message).join('; ')}`)
		}
		return json.data as T
	}
	return {
		async activity(agentSessionId, content, extra = {}) {
			const data = await gql<{ agentActivityCreate: { success: boolean } }>(
				'mutation($input: AgentActivityCreateInput!) { agentActivityCreate(input: $input) { success } }',
				{ input: { agentSessionId, content, ...extra } })
			if (!data.agentActivityCreate.success) throw new Error('Linear: agentActivityCreate was not successful')
		},
		async addURLs(id, urls) {
			const data = await gql<{ agentSessionUpdate: { success: boolean } }>(
				'mutation($id: String!, $input: AgentSessionUpdateInput!) { agentSessionUpdate(id: $id, input: $input) { success } }',
				{ id, input: { addedExternalUrls: urls } })
			if (!data.agentSessionUpdate.success) throw new Error('Linear: agentSessionUpdate was not successful')
		},
		async suggest(issueId, agentSessionId, repos) {
			if (!repos.length) return []
			const data = await gql<{ issueRepositorySuggestions: { suggestions: { repositoryFullName: string; confidence: number }[] } }>(
				`query($issueId: String!, $agentSessionId: String, $candidates: [CandidateRepository!]!) {
					issueRepositorySuggestions(issueId: $issueId, agentSessionId: $agentSessionId, candidateRepositories: $candidates) {
						suggestions { repositoryFullName confidence }
					}
				}`,
				{ issueId, agentSessionId, candidates: repos.map(r => ({ hostname: 'github.com', repositoryFullName: r })) })
			return data.issueRepositorySuggestions.suggestions.map(s => ({ repo: s.repositoryFullName, confidence: s.confidence }))
		},
	}
}

// --- main ------------------------------------------------------------------------

if (import.meta.main) {
	const stateFile = process.env.STATE_FILE ?? '/data/state.json'
	type Persisted = State & { token?: { value: string; expiresAt: number } }
	// Start empty only when there is no state yet; a corrupt or unreadable file must stop the relay.
	const state: Persisted = await readFile(stateFile, 'utf8').then(JSON.parse, e => {
		if (e.code === 'ENOENT') return { sessions: {}, deliveries: [], pending: [] }
		throw e
	})
	state.pending ??= []
	let saving: Promise<void> = Promise.resolve()
	const save = () => (saving = saving.catch(() => {}).then(async () => {
		await mkdir(dirname(stateFile), { recursive: true })
		await writeFile(`${stateFile}.tmp`, JSON.stringify(state), { mode: 0o600 })
		await rename(`${stateFile}.tmp`, stateFile)
	}))

	const amp = cliAmp(process.env.AMP_BIN, process.env.AMP_URL)
	// Fail fast if the CLI is missing or AMP_API_KEY is wrong.
	console.log(`amp CLI ready: ${(await amp.listProjects()).length} projects visible`)
	const relay = createRelay({
		amp,
		linear: linearClient(required('LINEAR_CLIENT_ID'), required('LINEAR_CLIENT_SECRET'), state, save),
		state,
		save,
		webhookSecret: required('LINEAR_WEBHOOK_SECRET'),
		defaultProject: process.env.LINEAR_AGENT_DEFAULT_PROJECT,
		defaultMode: process.env.LINEAR_AGENT_MODE,
	})
	await relay.recover()

	const pollMs = Number(process.env.POLL_MS) || 20_000
	// tick() skips sessions that still have work in flight, so overlapping ticks are safe.
	setInterval(() => void relay.tick().catch(e => console.error('tick failed', e)), pollMs)

	const server = Bun.serve({
		port: Number(process.env.PORT) || 8080,
		async fetch(req) {
			const { pathname } = new URL(req.url)
			if (req.method === 'GET' && pathname === '/healthz') return new Response('ok')
			if (req.method === 'POST' && pathname === '/webhooks/linear') {
				const delivery = req.headers.get('linear-delivery')
				const { status } = await relay.receive(new Uint8Array(await req.arrayBuffer()), req.headers.get('linear-signature'), delivery)
				console.log(`webhook ${req.headers.get('linear-event') ?? '?'} delivery=${delivery ?? '?'} signed=${req.headers.has('linear-signature')} -> ${status}`)
				return new Response(null, { status })
			}
			console.log(`404 ${req.method} ${pathname}`)
			return new Response('not found', { status: 404 })
		},
	})
	console.log(`linear-amp-relay listening on :${server.port}`)
}
