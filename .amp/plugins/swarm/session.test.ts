import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { PLANNER, type SwarmSelf, WORKER, git, operationInProgress } from './core'
import { ensureRunBranch } from './session'

const base = mkdtempSync(join(tmpdir(), 'swarm-session-'))
afterAll(() => rmSync(base, { recursive: true, force: true }))

const RUN = 'T-00000000-0000-0000-0000-000000000001' as const
const CHILD = 'T-00000000-0000-0000-0000-000000000002' as const
const BRANCH = `swarm/${RUN}`

async function sh(dir: string, ...args: string[]) {
	const r = await git(dir, ...args)
	if (r.code !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
	return r.stdout.trim()
}

async function clone(name: string): Promise<string> {
	const dir = join(base, name)
	await sh(base, 'clone', '-q', join(base, 'origin.git'), dir)
	await sh(dir, 'config', 'user.email', `${name}@test`)
	await sh(dir, 'config', 'user.name', name)
	return dir
}

function commitFile(dir: string, file: string, content: string, msg: string) {
	writeFileSync(join(dir, file), content)
	return sh(dir, 'add', '-A').then(() => sh(dir, 'commit', '-qm', msg))
}

const self = (role: SwarmSelf['role'], thread: SwarmSelf['thread'], parent: SwarmSelf['parent']): SwarmSelf => ({
	run: RUN,
	thread,
	parent,
	role,
	depth: parent ? 1 : 0,
	deadlineMin: 90,
	branch: BRANCH,
	title: 't',
})

describe('ensureRunBranch', async () => {
	await sh(base, 'init', '-q', '--bare', '-b', 'main', join(base, 'origin.git'))
	const seed = await clone('seed')
	await commitFile(seed, 'README.md', 'seed\n', 'seed')
	await sh(seed, 'push', '-q', 'origin', 'HEAD:main')

	const root = await clone('root')
	const worker = await clone('worker')

	test('root creates the remote run branch from HEAD and checks it out with upstream', async () => {
		expect(await ensureRunBranch(root, self(PLANNER, RUN, null))).toBe(`checked out ${BRANCH}`)
		expect(await sh(root, 'ls-remote', '--heads', 'origin', BRANCH)).toContain(await sh(root, 'rev-parse', 'HEAD'))
		expect(await sh(root, 'rev-parse', '--abbrev-ref', '@{u}')).toBe(`origin/${BRANCH}`)
	})

	test('a child does not create the branch; it tracks the existing one', async () => {
		expect(await ensureRunBranch(worker, self(WORKER, CHILD, RUN))).toBe(`checked out ${BRANCH}`)
		expect(await sh(worker, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(BRANCH)
	})

	test('re-firing with an unpushed commit keeps it and leaves it publishable', async () => {
		await commitFile(worker, 'a.txt', 'a\n', 'unpushed work')
		const tip = await sh(worker, 'rev-parse', 'HEAD')
		await sh(worker, 'checkout', '-q', 'main') // e.g. something switched branches before reopen
		expect(await ensureRunBranch(worker, self(WORKER, CHILD, RUN))).toBe(`on ${BRANCH}`)
		expect(await sh(worker, 'rev-parse', 'HEAD')).toBe(tip)
		await sh(worker, 'pull', '-q', '--rebase', 'origin', BRANCH)
		await sh(worker, 'push', '-q', 'origin', `HEAD:${BRANCH}`)
		expect(await sh(worker, 'ls-remote', '--heads', 'origin', BRANCH)).toContain(tip)
	})

	test('re-firing mid docs conflict leaves the rebase for publish_docs to continue', async () => {
		await sh(root, 'pull', '-q', '--rebase', 'origin', BRANCH)
		await sh(worker, 'pull', '-q', '--rebase', 'origin', BRANCH)
		await commitFile(worker, 'decision.md', 'from worker side\n', 'other decision')
		await sh(worker, 'push', '-q', 'origin', `HEAD:${BRANCH}`)
		await commitFile(root, 'decision.md', 'from root\n', 'root decision')
		const pull = await git(root, 'pull', '--rebase', 'origin', BRANCH)
		expect(pull.code).not.toBe(0)
		expect(await operationInProgress(root)).toBe(true)

		expect(await ensureRunBranch(root, self(PLANNER, RUN, null))).toBe('operation in progress; left as is')
		expect(await operationInProgress(root)).toBe(true)
		expect(await sh(root, 'diff', '--name-only', '--diff-filter=U')).toBe('decision.md')
	})
})
