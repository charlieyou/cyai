import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.SWARM_HOME = mkdtempSync(join(tmpdir(), 'swarm-guards-'))

import { PLANNER, WORKER, formatBootstrap, runBranch } from './core'
import { registerGuards } from './guards'

const ROOT = '/work/repo'
const RUN = 'T-run0000-0000-0000-0000-000000000000'
const ME = 'T-wkr00000-0000-0000-0000-000000000000'
const OTHER = 'T-oth00000-0000-0000-0000-000000000000'

// Thread ids are unique per fake thread because core caches roles by thread id.
let seq = 0
function fakeThread(role: string | null, id = `T-test${++seq}-0000`) {
	const worker = role === WORKER
	return {
		id,
		agent: async () => ({ definition: role ? { kind: 'agent-definition', name: role } : { kind: 'builtin', mode: 'medium' } }),
		parentThreadID: async () => (worker ? RUN : null),
		messages: async () =>
			worker
				? [
						{
							role: 'user',
							id: 1,
							content: [
								{
									type: 'text',
									text: formatBootstrap({ run: RUN, parent: RUN, role: WORKER, depth: 1, deadlineMin: 90, branch: runBranch(RUN), title: 't' }),
								},
							],
						},
					]
				: [],
	}
}

function setup() {
	let handler: any
	const amp: any = {
		system: { workspaceRoot: `file://${ROOT}` },
		on: (name: string, h: any) => {
			expect(name).toBe('tool.call')
			handler = h
		},
		helpers: {
			filePathFromURI: (uri: string) => uri.replace(/^file:\/\//, ''),
			shellCommandFromToolCall: (c: any) => (c.tool === 'shell_command' ? { command: c.input.command } : null),
			filesModifiedByToolCall: (c: any) => {
				if (c.tool === 'edit_file' || c.tool === 'create_file') return [`file://${c.input.path}`]
				if (c.tool === 'apply_patch')
					return [...String(c.input.patch).matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map((m) => `file://${m[1]}`)
				return null
			},
		},
	}
	registerGuards(amp)
	return async (role: string | null, tool: string, input: Record<string, unknown>, id?: string) =>
		(await handler({ tool, input, toolUseID: 'x', thread: { id: 'x' } }, { thread: fakeThread(role, id) })).action as string
}

describe('shell guard', () => {
	const guard = setup()
	const sh = (command: string) => guard(WORKER, 'shell_command', { command }, ME)

	test.each([
		'gh pr create --fill',
		'/usr/bin/gh api repos',
		'foo && amp threads list',
		'echo $(gh auth token)',
		'echo `amp --version`',
		'bash -c "gh pr list"',
		'GH_TOKEN=x gh pr view',
		'sudo -E gh pr list',
		'timeout 30 amp threads list',
		'git push origin main',
		'git push',
		'git push origin',
		'git -C ../other push origin main',
		'git --git-dir=.git push origin HEAD:main',
		'cd x && (git push origin HEAD:main)',
		`git push origin HEAD:swarm/${RUN} HEAD:main`,
		`git push --force origin HEAD:swarm/${RUN}`,
		`git push -f origin HEAD:swarm/${RUN}`,
		`git push -uf origin HEAD:swarm/${RUN}`,
		`git push --force-with-lease origin HEAD:swarm/${RUN}`,
		`git push origin +HEAD:swarm/${RUN}`,
		`git push origin :swarm/${RUN}`,
		`git push --delete origin swarm/${RUN}`,
		`git push -d origin swarm/${RUN}`,
		'git push --mirror origin',
		'git push --all origin',
		`git push --tags origin HEAD:swarm/${RUN}`,
		`git push origin HEAD:swarm-wip/${RUN}/${OTHER}`,
		`git push origin HEAD:swarm/${RUN}x`,
		`git push origin HEAD:refs/heads/swarm/${RUN}/extra`,
		'git -C "/work/repo" push origin main',
		`git push origin HEAD:swarm/${RUN} "HEAD:main"`,
		'if gh pr view; then echo found; fi',
		'if ! git push origin main; then echo failed; fi',
		`git push --follow-tags origin HEAD:swarm/${RUN}`,
		'echo "token: $(gh auth token)"',
		"bash -lc 'git push origin main'",
		'eval "gh pr list"',
		"# it's late\ngit push origin main",
		"cat > notes.txt <<'EOF'\ndon't push\nEOF\ngit push origin main",
		"bash <<'SH'\ngit push origin main\nSH",
		'cat <<EOF\nPR: $(gh pr view --json url)\nEOF',
		`git commit -m "$(cat <<'MSG'\nFix handling of unmatched ( and don't\nMSG\n)" && git push origin main`,
	])('rejects %s', async (command) => {
		expect(await sh(command)).toBe('reject-and-continue')
	})

	test.each([
		'cat .amp/x',
		'tail ~/.cache/amp/log',
		'ls .amp/plugins/swarm',
		'rg gh src',
		'git log --oneline | grep amp',
		'git commit -m "fix ghost" && git status',
		`git pull --rebase origin swarm/${RUN} && git push origin HEAD:swarm/${RUN}`,
		`git push origin HEAD:refs/heads/swarm/${RUN}`,
		`git push -u origin HEAD:swarm/${RUN} 2>&1 | tail -5`,
		`git -C /work/repo push origin HEAD:swarm/${RUN}`,
		`git push origin swarm/${RUN}`,
		`git push origin HEAD:swarm-wip/${RUN}/${ME}`,
		`git push origin HEAD:refs/heads/swarm-wip/${RUN}/${ME}`,
		'git pull --rebase origin main',
		`git push origin "HEAD:swarm/${RUN}"`,
		'git commit -m "amp plugin fix: gh token handling"',
		"echo 'gh pr create' > notes.txt",
		'git commit -m "$(cat msg.txt)"',
		'cat > notes.md <<EOF\ngh pr create\namp threads list\nEOF',
		'bash scripts/build.sh',
		"cat <<'EOF' > notes.md\nrun $(gh pr view) later\nEOF",
		`git commit -m "$(cat <<'MSG'\nFix handling of unmatched ( and don't\nMSG\n)" && git push origin HEAD:swarm/${RUN}`,
		`for i in 1 2 3; do git pull --rebase origin swarm/${RUN} && git push origin HEAD:swarm/${RUN} && break; done`,
	])('allows %s', async (command) => {
		expect(await sh(command)).toBe('allow')
	})

	test('planner shell is held to the same rules', async () => {
		expect(await guard(PLANNER, 'shell_command', { command: 'gh pr create' })).toBe('reject-and-continue')
	})
})

describe('edit guard', () => {
	const guard = setup()
	const edit = (role: string | null, path: string) => guard(role, 'edit_file', { path })

	test.each([
		[`${ROOT}/docs/decisions/0001.md`, 'allow'],
		[`${ROOT}/docs/plans/T-x.md`, 'allow'],
		[`${ROOT}/src/main.ts`, 'reject-and-continue'],
		[`${ROOT}/docs/../src/main.ts`, 'reject-and-continue'],
		[`${ROOT}/Docs/x.md`, 'reject-and-continue'],
		[`${ROOT}/docs`, 'reject-and-continue'],
		[`${ROOT}/docsx/a.md`, 'reject-and-continue'],
		['/tmp/docs/a.md', 'reject-and-continue'],
		[`${ROOT}/../docs/a.md`, 'reject-and-continue'],
	])('planner %s → %s', async (path, action) => {
		expect(await edit(PLANNER, path)).toBe(action)
	})

	test.each([
		[`${ROOT}/src/main.ts`, 'allow'],
		[`${ROOT}/docs/field-guide/index.md`, 'allow'],
		[`${ROOT}/src/amp/agents.ts`, 'allow'],
		['/tmp/scratch.txt', 'allow'],
		[`${ROOT}/.amp/plugins/swarm/guards.ts`, 'reject-and-continue'],
		[`${ROOT}/.AMP/plugins/x.ts`, 'reject-and-continue'],
		[`${ROOT}/.agents/setup`, 'reject-and-continue'],
		[`${ROOT}/AGENTS.md`, 'reject-and-continue'],
		[`${ROOT}/pkg/sub/AGENTS.md`, 'reject-and-continue'],
		[`${ROOT}/docs/decisions/0001.md`, 'reject-and-continue'],
		[`${ROOT}/src/../Docs/Decisions/0001.md`, 'reject-and-continue'],
		['/home/user/.config/amp/AGENTS.md', 'reject-and-continue'],
		[`${ROOT}/../Agents.MD`, 'reject-and-continue'],
	])('worker %s → %s', async (path, action) => {
		expect(await edit(WORKER, path)).toBe(action)
	})

	test('every path of a multi-file patch is checked', async () => {
		const patch = `*** Begin Patch\n*** Update File: ${ROOT}/src/a.ts\n*** Add File: ${ROOT}/.amp/x.ts\n*** End Patch`
		expect(await guard(WORKER, 'apply_patch', { patch })).toBe('reject-and-continue')
		expect(await guard(WORKER, 'create_file', { path: `${ROOT}/src/b.ts` })).toBe('allow')
	})

	test('non-swarm threads are never guarded', async () => {
		expect(await edit(null, `${ROOT}/.amp/plugins/swarm/guards.ts`)).toBe('allow')
		expect(await edit(null, `${ROOT}/src/main.ts`)).toBe('allow')
		expect(await guard(null, 'shell_command', { command: 'gh pr create && git push --force origin main' })).toBe('allow')
	})
})
