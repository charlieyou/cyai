import { createHmac, timingSafeEqual } from 'node:crypto'

export type Project = { ref: string; repo?: string; aliases: string[] }

export function verifySignature(body: Uint8Array, signature: string | null | undefined, secret: string): boolean {
	if (!signature) return false
	const expected = createHmac('sha256', secret).update(body).digest()
	const given = Buffer.from(signature, 'hex')
	return given.length === expected.length && timingSafeEqual(given, expected)
}

/** Cursor-style `[key=value]` options, e.g. `[repo=owner/name]` or `[mode=high]`. First source wins. */
export function parseOption(sources: (string | undefined)[], key: 'repo' | 'mode'): string | undefined {
	const keys = key === 'repo' ? 'repo|repository|project' : 'mode'
	const re = new RegExp(`\\[\\s*(?:${keys})\\s*[=:]\\s*([^\\]\\s]+)\\s*\\]`, 'i')
	for (const text of sources) {
		const m = text?.match(re)
		if (m) return m[1]
	}
}

export function toProjects(list: { namespace: string; name: string; repositoryURL?: string; remoteURLs?: string[] }[]): Project[] {
	return list.map(p => {
		const ref = `${p.namespace}/${p.name}`
		const repos = [p.repositoryURL, ...(p.remoteURLs ?? [])].map(u => u && repoSlug(u)).filter((s): s is string => !!s)
		return { ref, repo: repos[0], aliases: [...new Set([ref.toLowerCase(), ...repos])] }
	})
}

function repoSlug(url: string): string | undefined {
	const m = url.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i)
	return m ? `${m[1]}/${m[2]}`.toLowerCase() : undefined
}

/** Match one value (an explicit option or a reply to the project question) to a project. */
export function matchProject(value: string, projects: Project[]): Project | undefined {
	const v = (repoSlug(value) ?? value.replace(/^https?:\/\//, '').replace(/\.git$/, '')).toLowerCase().trim()
	const exact = projects.find(p => p.aliases.includes(v))
	if (exact) return exact
	const byName = projects.filter(p => p.aliases.some(a => a.split('/').pop() === v))
	if (byName.length === 1) return byName[0]
	const mentioned = mentionedProjects(value, projects)
	return mentioned.length === 1 ? mentioned[0] : undefined
}

/** Projects referenced by `owner/name` or a GitHub URL anywhere in free text. */
export function mentionedProjects(text: string, projects: Project[]): Project[] {
	const found = new Set<Project>()
	for (const m of text.matchAll(/(?:github\.com\/)?\b([\w.-]+\/[\w.-]+)\b/gi)) {
		const slug = m[1].replace(/\.git$/, '').toLowerCase()
		const p = projects.find(p => p.aliases.includes(slug))
		if (p) found.add(p)
	}
	return [...found]
}

export type Resolution = { project: Project; how: string } | { candidates: Project[] }

/**
 * Project selection, in priority order:
 * 1. `[repo=owner/name]` in the triggering comment, then the issue description
 * 2. exactly one known repository mentioned in the comment or description (`owner/name` or GitHub URL)
 * 3. the configured default project
 * Otherwise returns candidates so the caller can ask Linear for suggestions or ask the user.
 */
export function resolveProject(sources: (string | undefined)[], projects: Project[], fallback?: string): Resolution {
	const explicit = parseOption(sources, 'repo')
	if (explicit) {
		const p = matchProject(explicit, projects)
		if (p) return { project: p, how: `\`[repo=${explicit}]\`` }
	}
	const mentioned = mentionedProjects(sources.filter(Boolean).join('\n'), projects)
	if (mentioned.length === 1) return { project: mentioned[0], how: `mention of \`${mentioned[0].repo ?? mentioned[0].ref}\`` }
	if (fallback) {
		const p = matchProject(fallback, projects)
		if (p) return { project: p, how: 'default project' }
	}
	return { candidates: mentioned.length ? mentioned : projects }
}

export type ExportedMessage = {
	role: string
	state?: { type?: string; stopReason?: string; error?: { message?: string } } | null
	content?: { type: string; text?: string; name?: string; input?: unknown }[]
}

/** An assistant message that ends a turn: a final answer, or an error/cancellation. */
function isTerminal(m: ExportedMessage | undefined): boolean {
	const type = m?.state?.type
	if (m?.role !== 'assistant' || !type || type === 'streaming') return false
	return type !== 'complete' || m.state!.stopReason !== 'tool_use'
}

export type Reply = { index: number; ok: boolean; text: string }
export type Scan = { replies: Reply[]; idle: boolean; progress?: string }

/**
 * Scan an exported transcript from `from` onward: every turn-ending reply (so a turn that finished
 * between polls is never skipped), whether the thread is idle now, and the latest tool in use.
 * Progress is the tool name only; tool arguments can contain secrets.
 */
export function scanTranscript(messages: ExportedMessage[], from: number): Scan {
	const replies: Reply[] = []
	for (let index = from; index < messages.length; index++) {
		const m = messages[index]
		if (!isTerminal(m)) continue
		const text = (m.content ?? []).filter(b => b.type === 'text').map(b => b.text ?? '').join('\n').trim()
		const ok = m.state!.type === 'complete'
		replies.push({ index, ok, text: ok ? text : m.state!.error?.message || text || `Thread stopped (${m.state!.type}).` })
	}
	const idle = isTerminal(messages.at(-1))
	const tool = messages.slice(from).filter(m => m.role === 'assistant').flatMap(m => m.content ?? []).filter(b => b.type === 'tool_use').at(-1)
	return { replies, idle, progress: idle ? undefined : tool?.name }
}

export function pullRequestURLs(text: string): string[] {
	return [...new Set(text.match(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/g) ?? [])]
}

export function threadPrompt(project: Project, context: string, branch?: string): string {
	const branchRule = branch
		? `- When you change code, do it on the branch \`${branch}\` (check it out if it exists, otherwise create it from the default branch). When the work is done, commit, push the branch, and open a draft pull request for it with \`gh pr create --draft\` unless one is already open. Push later changes to the same branch and PR. Linear links the PR to the issue through this branch name. Do not open a PR if you changed nothing.`
		: '- When you change code, commit on a new branch whose name includes the Linear issue identifier, push it, and open a draft pull request with `gh pr create --draft` unless one is already open. Do not open a PR if you changed nothing.'
	return [
		`A Linear issue was delegated to you through the Amp Linear agent. You are in the \`${project.repo ?? project.ref}\` repository.`,
		'',
		"Linear's context for this request:",
		'',
		context,
		'',
		'Notes:',
		branchRule,
		'- Your final message of each turn is posted verbatim to Linear as the agent response. End every turn with a concise Markdown summary of what you did, or with a clear question when you need input.',
		'- Include the URL of any pull request you open.',
		'- Follow-up messages from Linear arrive in this thread.',
	].join('\n')
}
