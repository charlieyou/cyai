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
 * targets are dropped, and comments are skipped. Code the shell runs indirectly is scanned too:
 * `$(...)` and backtick payloads (also inside double quotes and unquoted here-docs) and here-doc
 * bodies fed to a shell. Other here-doc bodies are data.
 */
function simpleCommands(src: string): string[][] {
	return scan(src, 0, false).commands
}

/** Scans `src` from `start`; inside a `$(`, stops at its closing `)` and returns that index. */
function scan(src: string, start: number, inSubstitution: boolean): { commands: string[][]; end: number } {
	const commands: string[][] = []
	const heredocs: { delim: string; quoted: boolean; words: string[] }[] = []
	let words: string[] = []
	let word: string | null = null
	let quoted = false // the current word contains quoting (a quoted here-doc delimiter means a literal body)
	let target: 'file' | 'heredoc' | null = null // what the next word is, after a redirection
	let depth = 0 // open ( subshells
	const add = (text: string) => (word = (word ?? '') + text)
	const endWord = () => {
		if (word === null) return
		if (target === 'heredoc') heredocs.push({ delim: word.replace(/^-/, ''), quoted, words })
		else if (!target) words.push(word)
		target = null
		word = null
		quoted = false
	}
	const endCommand = () => {
		endWord()
		target = null
		if (words.length) commands.push(words)
		words = []
	}
	const substitution = (from: number) => {
		const inner = scan(src, from, true)
		commands.push(...inner.commands)
		add('$')
		return inner.end
	}
	const backticks = (from: number) => {
		const end = closing(src, from - 1, '`')
		commands.push(...simpleCommands(src.slice(from, end)))
		add('$')
		return end
	}

	let i = start
	for (; i < src.length; i++) {
		const c = src[i]!
		if (c === '\\') {
			quoted = true
			if (src[i + 1] !== '\n') add(src[i + 1] ?? '')
			i++
		} else if (c === "'") {
			quoted = true
			const end = closing(src, i, "'")
			add(src.slice(i + 1, end))
			i = end
		} else if (c === '"') {
			quoted = true
			add('')
			for (i++; i < src.length && src[i] !== '"'; i++) {
				if (src[i] === '\\') add(src[++i] ?? '')
				else if (src[i] === '`') i = backticks(i + 1)
				else if (src.startsWith('$(', i)) i = substitution(i + 2)
				else add(src[i]!)
			}
		} else if (c === '`') {
			i = backticks(i + 1)
		} else if (src.startsWith('$(', i)) {
			i = substitution(i + 2)
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
			for (const doc of heredocs.splice(0)) {
				const bodyStart = pos
				let bodyEnd = src.length
				while (pos < src.length) {
					const nl = src.indexOf('\n', pos)
					const lineEnd = nl < 0 ? src.length : nl
					const atDelimiter = src.slice(pos, lineEnd).replace(/^\t+/, '') === doc.delim
					if (atDelimiter) bodyEnd = pos
					pos = lineEnd + 1
					if (atDelimiter) break
				}
				const body = src.slice(bodyStart, bodyEnd)
				const consumer = basename(commandWords(doc.words)[0] ?? '')
				// Two stages: this shell expands an unquoted body, then a consuming shell runs it.
				if (!doc.quoted) commands.push(...substitutions(body))
				if (SHELLS.has(consumer)) commands.push(...simpleCommands(body))
			}
			i = pos - 1
		} else if (c === '(') {
			endCommand()
			depth++
		} else if (c === ')') {
			endCommand()
			if (depth === 0 && inSubstitution) break
			depth = Math.max(0, depth - 1)
		} else if (';&|'.includes(c)) {
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
	return { commands, end: i }
}

/** Commands in the `$(...)` and backtick substitutions of an unquoted here-doc body. */
function substitutions(text: string): string[][] {
	const commands: string[][] = []
	for (let i = 0; i < text.length; i++) {
		if (text[i] === '\\') i++
		else if (text[i] === '`') {
			const end = closing(text, i, '`')
			commands.push(...simpleCommands(text.slice(i + 1, end)))
			i = end
		} else if (text.startsWith('$(', i)) {
			const inner = scan(text, i + 2, true)
			commands.push(...inner.commands)
			i = inner.end
		}
	}
	return commands
}

const closing = (src: string, open: number, quote: string) => {
	const end = src.indexOf(quote, open + 1)
	return end < 0 ? src.length : end
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
