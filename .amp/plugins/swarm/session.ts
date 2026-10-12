// session.start / agent.start: create the run branch on a root, check it out non-destructively on
// every swarm thread (§4, §8), and record handoffs a planner receives.

import type { PluginAPI, PluginThread } from '@ampcode/plugin'
import {
	PLANNER,
	type SwarmSelf,
	firstLine,
	git,
	handoffSources,
	loadSelf,
	operationInProgress,
	recordHandoffs,
	withLock,
	workspaceRoot,
} from './core'

export interface BranchResult {
	ok: boolean
	detail: string
}

/**
 * Idempotent and never destructive: an in-progress rebase/merge is left alone, an existing local
 * branch is checked out without -B or reset, so unpushed commits and docs conflicts survive reopen.
 */
export async function ensureRunBranch(root: string, self: SwarmSelf): Promise<BranchResult> {
	const branch = self.branch
	const remoteRef = `refs/remotes/origin/${branch}`
	const fail = (what: string, r: { stderr: string }) => ({ ok: false, detail: `${what} failed: ${firstLine(r.stderr)}` })
	if (self.parent === null && self.role === PLANNER) {
		const ls = await git(root, 'ls-remote', '--heads', 'origin', branch)
		if (ls.code !== 0) return fail('ls-remote', ls)
		if (!ls.stdout.trim()) {
			const push = await git(root, 'push', 'origin', `HEAD:refs/heads/${branch}`)
			if (push.code !== 0) return fail(`creating ${branch}`, push)
		}
	}
	if (await operationInProgress(root)) return { ok: true, detail: 'operation in progress; left as is' }
	const fetch = await git(root, 'fetch', 'origin', `+refs/heads/${branch}:${remoteRef}`)
	if (fetch.code !== 0) return fail('fetch', fetch)
	const local = await git(root, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`)
	if (local.code !== 0) {
		const co = await git(root, 'checkout', '--track', '-b', branch, `origin/${branch}`)
		return co.code === 0 ? { ok: true, detail: `checked out ${branch}` } : fail('checkout', co)
	}
	const co = await git(root, 'checkout', branch)
	if (co.code !== 0) return fail('checkout', co)
	await git(root, 'branch', '--set-upstream-to', `origin/${branch}`, branch)
	return { ok: true, detail: `on ${branch}` }
}

export function registerSession(amp: PluginAPI): void {
	const ensured = new Set<string>()
	const inflight = new Map<string, Promise<BranchResult>>()

	/** Runs the branch setup until it succeeds once per session; concurrent callers share one attempt. */
	async function ensure(thread: PluginThread, logger: { log: (...a: unknown[]) => void }) {
		const self = await loadSelf(thread)
		if (!self || ensured.has(thread.id)) return { self }
		let attempt = inflight.get(thread.id)
		if (!attempt) {
			const root = workspaceRoot(amp)
			attempt = withLock(`git:${root}`, () => ensureRunBranch(root, self)).finally(() => inflight.delete(thread.id))
			inflight.set(thread.id, attempt)
		}
		const result = await attempt
		if (result.ok) ensured.add(thread.id)
		logger.log(`swarm ${thread.id}: ${result.detail}`)
		return { self, result }
	}

	amp.on('session.start', async (_event, ctx) => {
		// A reopened thread revalidates. A child's first message may not be readable yet here;
		// agent.start retries.
		ensured.delete(ctx.thread.id)
		await ensure(ctx.thread, ctx.logger).catch((e) => ctx.logger.log(`swarm session.start: ${e}`))
	})

	amp.on('agent.start', async (event, ctx) => {
		try {
			const { self, result } = await ensure(ctx.thread, ctx.logger)
			if (self?.role === PLANNER) recordHandoffs(self, handoffSources(event.message))
			if (self && result && !result.ok) {
				const fix =
					self.role === PLANNER
						? 'children() and publish_docs() may fail until this is fixed; report it.'
						: `Fix it before any work: \`git fetch origin ${self.branch} && git checkout ${self.branch}\`; if that fails, hand off as blocked.`
				return { message: { content: `[swarm] This checkout is not on ${self.branch} (${result.detail}). ${fix}`, display: true } }
			}
		} catch (e) {
			ctx.logger.log(`swarm agent.start: ${e}`)
		}
		return {}
	})
}
