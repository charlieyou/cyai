// tool.call guards for edits and shell (§6 invariants 5 and 6). Against ordinary misuse, not an
// adversarial model (§10): the edit guard sees only what filesModifiedByToolCall parses, and the
// shell guard is a small tokenizer.

import type { PluginAPI, ToolCallResult } from '@ampcode/plugin'
import { isAbsolute, relative, resolve } from 'node:path'

import { PLANNER, type Role, type SwarmSelf, loadSelf, roleOf, runBranch, wipBranch, workspaceRoot } from './core'

const GUARDED_TOOLS = new Set(['edit_file', 'create_file', 'apply_patch', 'shell_command'])

export function registerGuards(amp: PluginAPI): void {
	amp.on('tool.call', async (event, ctx): Promise<ToolCallResult> => {
		const role = await roleOf(ctx.thread)
		if (!role || !GUARDED_TOOLS.has(event.tool)) return { action: 'allow' }

		const root = workspaceRoot(amp)
		for (const uri of amp.helpers.filesModifiedByToolCall(event) ?? []) {
			const reason = editViolation(role, root, amp.helpers.filePathFromURI(uri))
			if (reason) return { action: 'reject-and-continue', message: `swarm: ${reason}` }
		}

		const shell = amp.helpers.shellCommandFromToolCall(event)
		if (shell) {
			const reason = shellViolation(shell.command, await loadSelf(ctx.thread))
			if (reason) return { action: 'reject-and-continue', message: `swarm: ${reason}` }
		}
		return { action: 'allow' }
	})
}

// ---------------------------------------------------------------------------------------------
// Edit guard (invariant 5).

function editViolation(role: Role, root: string, path: string): string | null {
	const rel = relative(root, resolve(root, path))
	const outside = rel === '' || rel === '..' || rel.startsWith('../') || isAbsolute(rel)
	if (role === PLANNER) {
		return !outside && rel.startsWith('docs/') ? null : `planners may only write under docs/ (${path})`
	}
	if (outside) return null
	const lower = rel.toLowerCase()
	const protectedPath =
		/^(\.amp|\.agents)(\/|$)/.test(lower) || /(^|\/)agents\.md$/.test(lower) || lower.startsWith('docs/decisions/')
	return protectedPath ? `workers may not modify control-plane files or decisions (${rel})` : null
}

// ---------------------------------------------------------------------------------------------
// Shell guard (invariant 6).

/** Words that run their arguments as a command; their options and durations are skipped too. */
const WRAPPERS = new Set(['sudo', 'env', 'command', 'builtin', 'exec', 'eval', 'nohup', 'time', 'nice', 'timeout', 'xargs', 'stdbuf', 'bash', 'sh', 'zsh'])
/** git global options that take a separate value: `git -C dir push`. */
const GIT_OPTS_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env'])

/**
 * Simple commands of a shell line as word lists. Quotes, subshells, command substitution, and
 * every control operator split commands, so `bash -c "gh ..."` and `$(gh ...)` expose `gh` as a
 * command word (a quoted string that happens to start with `amp`/`gh` is rejected too; that is
 * the conservative side). Redirections and their targets are dropped.
 */
function simpleCommands(command: string): string[][] {
	const text = command
		.replace(/\\\n/g, ' ')
		.replace(/\d*[<>]+&(\d+|-)?/g, ' ') // 2>&1, >&2, <&-
		.replace(/&>>?/g, ' > ') // &> file
		.replace(/\d*[<>]+\s*[^\s;&|()<>`"']*/g, ' ') // > file, 2>/dev/null, < in, <<EOF
	return text
		.split(/[;&|(){}\n`"']/)
		.map((segment) => segment.trim().split(/\s+/).filter(Boolean))
		.filter((words) => words.length > 0)
}

/** The command word and its arguments, skipping env assignments and wrapper commands. */
function commandWords(words: string[]): string[] {
	let i = 0
	let wrapped = false
	while (i < words.length) {
		const w = words[i]!
		if (/^[A-Za-z_]\w*=/.test(w)) i++
		else if (WRAPPERS.has(basename(w))) (wrapped = true), i++
		else if (wrapped && (w.startsWith('-') || /^\d+[smhd]?$/.test(w))) i++
		else break
	}
	return words.slice(i)
}

const basename = (word: string) => word.slice(word.lastIndexOf('/') + 1)

function shellViolation(command: string, self: SwarmSelf | null): string | null {
	for (const words of simpleCommands(command).map(commandWords)) {
		const cmd = basename(words[0] ?? '')
		if (cmd === 'amp' || cmd === 'gh') return `the ${cmd} CLI is not available in swarm threads`
		const sub = cmd === 'git' ? gitSubcommand(words) : -1
		if (sub > 0 && words[sub] === 'push') {
			const reason = pushViolation(words.slice(sub + 1), self)
			if (reason) return reason
		}
	}
	return null
}

/** Index of git's subcommand word, past global options; -1 if none. */
function gitSubcommand(words: string[]): number {
	for (let i = 1; i < words.length; i++) {
		const w = words[i]!
		if (GIT_OPTS_WITH_VALUE.has(w)) i++
		else if (!w.startsWith('-')) return i
	}
	return -1
}

function pushViolation(args: string[], self: SwarmSelf | null): string | null {
	const allowed = self ? [runBranch(self.run), wipBranch(self.run, self.thread)] : []
	const usage = `git push only as \`git push origin HEAD:${allowed[0] ?? 'swarm/<run>'}\` or HEAD:${allowed[1] ?? 'swarm-wip/<run>/<own-id>'}`
	const positional: string[] = []
	for (let i = 0; i < args.length; i++) {
		const a = args[i]!
		if (a === '-o' || a === '--push-option') i++
		else if (/^--(force|delete|mirror|all|branches|tags|prune)/.test(a) || /^-[^-]*[fd]/.test(a)) {
			return `${usage}; ${a} is not allowed`
		} else if (!a.startsWith('-')) positional.push(a)
	}
	const refspecs = positional.slice(1) // positional[0] is the remote
	if (refspecs.length === 0) return `${usage}; name the refspec explicitly`
	for (const spec of refspecs) {
		if (spec.startsWith('+')) return `${usage}; forced refspec ${spec} is not allowed`
		const colon = spec.indexOf(':')
		if (colon === 0) return `${usage}; deleting ${spec.slice(1)} is not allowed`
		const dst = (colon < 0 ? spec : spec.slice(colon + 1)).replace(/^refs\/heads\//, '')
		if (!allowed.includes(dst)) return `${usage}; ${spec} is not allowed`
	}
	return null
}
