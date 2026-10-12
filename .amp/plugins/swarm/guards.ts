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
	const lower = rel.toLowerCase()
	const protectedPath =
		/(^|\/)agents\.md$/.test(lower) ||
		(!outside && (/^(\.amp|\.agents)(\/|$)/.test(lower) || lower.startsWith('docs/decisions/')))
	return protectedPath ? `workers may not modify control-plane files or decisions (${rel})` : null
}

// ---------------------------------------------------------------------------------------------
// Shell guard (invariant 6).

/** Words that run the rest of their simple command: wrappers and shell keywords. */
const PREFIXES = new Set(['sudo', 'env', 'command', 'builtin', 'exec', 'nohup', 'time', 'nice', 'timeout', 'xargs', 'stdbuf', 'if', 'then', 'else', 'elif', 'while', 'until', 'do', '!', '{'])
/** Commands whose argument is itself a shell line (`bash -c '...'`, `eval ...`). */
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'eval'])
/** git global options that take a separate value: `git -C dir push`. */
const GIT_OPTS_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env'])

/**
 * Simple commands of a shell line as word lists, from a small quote-aware scanner: quotes join
 * words as the shell does, control operators and newlines end a command, redirections and their
 * targets are dropped, here-doc bodies are skipped, and the payloads of `$(...)` and backticks
 * are scanned as commands of their own.
 */
function simpleCommands(src: string): string[][] {
	const commands: string[][] = []
	const heredocs: string[] = []
	let words: string[] = []
	let word: string | null = null
	let target: 'file' | 'heredoc' | null = null // what the next word is, after a redirection
	const add = (text: string) => (word = (word ?? '') + text)
	const endWord = () => {
		if (word !== null && target === 'heredoc') heredocs.push(word.replace(/^-/, ''))
		else if (word !== null && !target) words.push(word)
		if (word !== null) target = null
		word = null
	}
	const endCommand = () => {
		endWord()
		target = null
		if (words.length) commands.push(words)
		words = []
	}
	const substitute = (from: number, to: number) => {
		commands.push(...simpleCommands(src.slice(from, to)))
		add('$')
	}

	for (let i = 0; i < src.length; i++) {
		const c = src[i]!
		if (c === '\\') {
			if (src[i + 1] !== '\n') add(src[i + 1] ?? '')
			i++
		} else if (c === "'") {
			const end = closing(src, i, "'")
			add(src.slice(i + 1, end))
			i = end
		} else if (c === '"') {
			add('')
			for (i++; i < src.length && src[i] !== '"'; i++) {
				if (src[i] === '\\') add(src[++i] ?? '')
				else if (src[i] === '`') substitute(i + 1, (i = closing(src, i, '`')))
				else if (src.startsWith('$(', i)) substitute(i + 2, (i = closingParen(src, i + 1)))
				else add(src[i]!)
			}
		} else if (c === '`') {
			substitute(i + 1, (i = closing(src, i, '`')))
		} else if (src.startsWith('$(', i)) {
			substitute(i + 2, (i = closingParen(src, i + 1)))
		} else if (c === '<' || c === '>' || src.startsWith('&>', i)) {
			if (word !== null && /^\d+$/.test(word)) word = null // the fd in 2>file
			endWord()
			let op = c
			while ('<>&'.includes(src[i + 1] ?? '_')) op += src[++i]
			if (op.endsWith('&')) while (/[\d-]/.test(src[i + 1] ?? '')) i++ // 2>&1, >&-: no target
			else target = op === '<<' ? 'heredoc' : 'file'
		} else if (c === '\n') {
			endCommand()
			let pos = i + 1
			for (const delim of heredocs.splice(0)) {
				for (;;) {
					const nl = src.indexOf('\n', pos)
					const line = src.slice(pos, nl < 0 ? src.length : nl)
					pos = nl < 0 ? src.length : nl + 1
					if (nl < 0 || line.replace(/^\t+/, '') === delim) break
				}
			}
			i = pos - 1
		} else if (';&|()'.includes(c)) {
			endCommand()
		} else if (c === '#' && word === null) {
			i = closing(src, i, '\n') - 1 // a comment; its apostrophes must not open a quote
		} else if (c === ' ' || c === '\t') {
			endWord()
		} else {
			add(c)
		}
	}
	endCommand()
	return commands
}

const closing = (src: string, open: number, quote: string) => {
	const end = src.indexOf(quote, open + 1)
	return end < 0 ? src.length : end
}

function closingParen(src: string, open: number): number {
	let depth = 0
	for (let i = open; i < src.length; i++) {
		if (src[i] === '(') depth++
		else if (src[i] === ')' && --depth === 0) return i
	}
	return src.length
}

/** The command word and its arguments, skipping env assignments, wrappers, and keywords. */
function commandWords(words: string[]): string[] {
	let i = 0
	let prefixed = false
	while (i < words.length) {
		const w = words[i]!
		if (/^[A-Za-z_]\w*=/.test(w)) i++
		else if (PREFIXES.has(basename(w))) (prefixed = true), i++
		else if (prefixed && (w.startsWith('-') || /^\d+[smhd]?$/.test(w))) i++
		else break
	}
	return words.slice(i)
}

const basename = (word: string) => word.slice(word.lastIndexOf('/') + 1)

function shellViolation(command: string, self: SwarmSelf | null): string | null {
	for (const words of simpleCommands(command).map(commandWords)) {
		const cmd = basename(words[0] ?? '')
		if (cmd === 'amp' || cmd === 'gh') return `the ${cmd} CLI is not available in swarm threads`
		if (SHELLS.has(cmd)) {
			const flag = words.findIndex((w) => /^-[a-z]*c[a-z]*$/.test(w))
			const payload = cmd === 'eval' ? words.slice(1).join(' ') : flag > 0 ? words[flag + 1] : undefined
			const reason = payload ? shellViolation(payload, self) : null
			if (reason) return reason
		}
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
		else if (/^--(force|delete|mirror|all|branches|tags|follow-tags|prune|recurse-submodules=(on-demand|only))/.test(a) || /^-[^-]*[fd]/.test(a)) {
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
