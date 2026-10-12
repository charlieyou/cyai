// session.start / agent.start: create the run branch on a root, check it out non-destructively on
// every swarm thread (§4, §8), and record handoffs a planner receives.

import type { PluginAPI, PluginThread } from '@ampcode/plugin'
import { PLANNER, type SwarmSelf, firstLine, git, handoffSources, loadSelf, operationInProgress, recordHandoffs, workspaceRoot } from './core'

/**
 * Idempotent and never destructive: an in-progress rebase/merge is left alone, an existing local
 * branch is checked out without -B or reset, so unpushed commits and docs conflicts survive reopen.
 */
export async function ensureRunBranch(root: string, self: SwarmSelf): Promise<string> {
	const branch = self.branch
	const remoteRef = `refs/remotes/origin/${branch}`
	if (self.parent === null && self.role === PLANNER) {
		const ls = await git(root, 'ls-remote', '--heads', 'origin', branch)
		if (ls.code !== 0) return `ls-remote failed: ${firstLine(ls.stderr)}`
		if (!ls.stdout.trim()) {
			const push = await git(root, 'push', 'origin', `HEAD:refs/heads/${branch}`)
			if (push.code !== 0) return `creating ${branch} failed: ${firstLine(push.stderr)}`
		}
	}
	if (await operationInProgress(root)) return 'operation in progress; left as is'
	const fetch = await git(root, 'fetch', 'origin', `+refs/heads/${branch}:${remoteRef}`)
	if (fetch.code !== 0) return `fetch failed: ${firstLine(fetch.stderr)}`
	const local = await git(root, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`)
	if (local.code !== 0) {
		const co = await git(root, 'checkout', '--track', '-b', branch, `origin/${branch}`)
		return co.code === 0 ? `checked out ${branch}` : `checkout failed: ${firstLine(co.stderr)}`
	}
	const co = await git(root, 'checkout', branch)
	if (co.code !== 0) return `checkout failed: ${firstLine(co.stderr)}`
	await git(root, 'branch', '--set-upstream-to', `origin/${branch}`, branch)
	return `on ${branch}`
}

export function registerSession(amp: PluginAPI): void {
	const ensured = new Set<string>()

	async function ensure(thread: PluginThread, logger: { log: (...a: unknown[]) => void }) {
		const self = await loadSelf(thread)
		if (!self || ensured.has(thread.id)) return self
		ensured.add(thread.id)
		logger.log(`swarm ${thread.id}: ${await ensureRunBranch(workspaceRoot(amp), self)}`)
		return self
	}

	amp.on('session.start', async (_event, ctx) => {
		// A child's first message may not be readable yet here; agent.start retries below.
		await ensure(ctx.thread, ctx.logger).catch((e) => ctx.logger.log(`swarm session.start: ${e}`))
	})

	amp.on('agent.start', async (event, ctx) => {
		try {
			const self = await ensure(ctx.thread, ctx.logger)
			if (self?.role === PLANNER) recordHandoffs(self, handoffSources(event.message))
		} catch (e) {
			ctx.logger.log(`swarm agent.start: ${e}`)
		}
		return {}
	})
}
