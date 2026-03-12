// @i-know-the-amp-plugin-api-is-wip-and-very-experimental-right-now
import type { PluginAPI, ToolCallEvent } from '@ampcode/plugin'

interface DangerousPattern {
	command: string
	subcommand?: string
	args?: string[]
	reason: string
	check?: (args: string[]) => boolean
}

const SYSTEM_PATHS = ['/etc', '/usr', '/var', '/bin', '/sbin', '/root']

// Wrappers and which of their flags consume a following value
const WRAPPER_FLAGS_WITH_VALUE: Record<string, string[]> = {
	sudo: ['-u', '-g', '-C', '-D', '-R', '-T', '-h', '-p'],
	doas: ['-u', '-C'],
	env: ['-C', '-S', '-u'],
	command: ['-p'],
	nohup: [],
	time: [],
	nice: ['-n'],
	stdbuf: ['-i', '-o', '-e'],
}
const WRAPPER_NAMES = Object.keys(WRAPPER_FLAGS_WITH_VALUE)

const SHELLS = ['bash', 'sh', 'zsh', 'dash', 'fish']
const GIT_GLOBAL_FLAGS_WITH_VALUE = ['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path']

// Shell syntax we can't reliably parse — prompt conservatively if detected
const UNSUPPORTED_SYNTAX = /\$\(|`[^`]*`|<\(|>\(|<<|eval\s|exec\s|\bif\s|\bthen\b|\bfi\b|\bfor\s|\bwhile\s|\buntil\s|\bdo\b|\bdone\b|\bcase\s|\besac\b|\bfunction\s|[a-zA-Z_]\w*\s*\(\)\s*\{/

// --- Tokenizer (quote/escape-aware) ---

function tokenize(input: string): string[] {
	const tokens: string[] = []
	let current = ''
	let i = 0

	while (i < input.length) {
		const ch = input[i]

		if (ch === '\\' && i + 1 < input.length) {
			current += input[i + 1]
			i += 2
			continue
		}

		if (ch === "'") {
			const end = input.indexOf("'", i + 1)
			if (end === -1) {
				current += input.slice(i + 1)
				i = input.length
			} else {
				current += input.slice(i + 1, end)
				i = end + 1
			}
			continue
		}

		if (ch === '"') {
			i++
			while (i < input.length && input[i] !== '"') {
				if (input[i] === '\\' && i + 1 < input.length && '"\\$`\n'.includes(input[i + 1])) {
					current += input[i + 1]
					i += 2
				} else {
					current += input[i]
					i++
				}
			}
			i++ // skip closing "
			continue
		}

		if (/\s/.test(ch)) {
			if (current) {
				tokens.push(current)
				current = ''
			}
			i++
			continue
		}

		current += ch
		i++
	}

	if (current) tokens.push(current)
	return tokens
}

// --- Shell-aware top-level command splitting ---

function splitTopLevelCommands(input: string): string[] {
	const segments: string[] = []
	let current = ''
	let depth = 0
	let inSingle = false
	let inDouble = false
	let i = 0

	while (i < input.length) {
		const ch = input[i]

		if (ch === '\\' && !inSingle && i + 1 < input.length) {
			current += ch + input[i + 1]
			i += 2
			continue
		}

		if (ch === "'" && !inDouble) {
			inSingle = !inSingle
			current += ch
			i++
			continue
		}

		if (ch === '"' && !inSingle) {
			inDouble = !inDouble
			current += ch
			i++
			continue
		}

		if (!inSingle && !inDouble) {
			if (ch === '(' || ch === '{') depth++
			if ((ch === ')' || ch === '}') && depth > 0) depth--

			if (depth === 0) {
				if (ch === ';' || ch === '\n') {
					segments.push(current.trim())
					current = ''
					i++
					continue
				}
				if (ch === '&' && input[i + 1] === '&') {
					segments.push(current.trim())
					current = ''
					i += 2
					continue
				}
				if (ch === '|' && input[i + 1] === '|') {
					segments.push(current.trim())
					current = ''
					i += 2
					continue
				}
				if (ch === '|' && input[i + 1] === '&') {
					segments.push(current.trim())
					current = ''
					i += 2
					continue
				}
				if (ch === '|') {
					segments.push(current.trim())
					current = ''
					i++
					continue
				}
				// Background & (but not in redirections like 2>&1 or >&2)
				if (ch === '&') {
					const prev = current.trimEnd()
					const isRedirection = prev.length > 0 && /[0-9>]$/.test(prev)
					if (!isRedirection) {
						segments.push(current.trim())
						current = ''
					} else {
						current += ch
					}
					i++
					continue
				}
			}
		}

		current += ch
		i++
	}

	if (current.trim()) segments.push(current.trim())
	return segments.filter(Boolean)
}

/** Strip shell comments (# to end of line) outside quotes */
function stripComments(input: string): string {
	let result = ''
	let inSingle = false
	let inDouble = false
	for (let i = 0; i < input.length; i++) {
		const ch = input[i]
		if (ch === '\\' && !inSingle && i + 1 < input.length) {
			result += ch + input[i + 1]
			i++
			continue
		}
		if (ch === "'" && !inDouble) { inSingle = !inSingle; result += ch; continue }
		if (ch === '"' && !inSingle) { inDouble = !inDouble; result += ch; continue }
		if (ch === '#' && !inSingle && !inDouble) {
			// Skip to end of line
			const nl = input.indexOf('\n', i)
			if (nl === -1) break
			i = nl - 1
			continue
		}
		result += ch
	}
	return result
}

/** Unwrap subshells/groups: (cmd), { cmd; }, including with trailing redirections */
function unwrapGroup(segment: string): string {
	let s = segment.trim()
	// Match (…) possibly followed by redirections
	if (s.startsWith('(')) {
		const closeIdx = findMatchingClose(s, 0, '(', ')')
		if (closeIdx !== -1) s = s.slice(1, closeIdx).trim()
	} else if (s.startsWith('{')) {
		const closeIdx = findMatchingClose(s, 0, '{', '}')
		if (closeIdx !== -1) s = s.slice(1, closeIdx).trim()
	} else {
		return s
	}
	if (s.endsWith(';')) s = s.slice(0, -1).trim()
	return s
}

/** Find matching close bracket, respecting quotes and nesting */
function findMatchingClose(s: string, start: number, open: string, close: string): number {
	let depth = 0
	let inSingle = false
	let inDouble = false
	for (let i = start; i < s.length; i++) {
		const ch = s[i]
		if (ch === '\\' && !inSingle) { i++; continue }
		if (ch === "'" && !inDouble) { inSingle = !inSingle; continue }
		if (ch === '"' && !inSingle) { inDouble = !inDouble; continue }
		if (!inSingle && !inDouble) {
			if (ch === open) depth++
			if (ch === close) { depth--; if (depth === 0) return i }
		}
	}
	return -1
}

// --- Command normalization ---

interface ParsedCommand {
	base: string
	args: string[]
}

function basename(cmd: string): string {
	return cmd.replace(/^.*\//, '')
}

/** Strip execution wrappers (sudo, env, etc.) and env assignments, returning all inner commands */
function stripWrappersAndParse(tokens: string[]): ParsedCommand[] {
	if (tokens.length === 0) return []

	let i = 0

	// Skip env variable assignments (FOO=bar)
	while (i < tokens.length && /^[A-Za-z_]\w*=/.test(tokens[i])) i++
	if (i >= tokens.length) return []

	let cmd = basename(tokens[i])

	// Peel off execution wrappers with proper flag handling
	while (WRAPPER_NAMES.includes(cmd)) {
		const flagsWithValue = WRAPPER_FLAGS_WITH_VALUE[cmd]
		i++

		// For env, also skip assignments after the wrapper
		const isEnv = cmd === 'env'

		while (i < tokens.length) {
			const tok = tokens[i]
			if (tok === '--') {
				i++
				break
			}
			if (isEnv && /^[A-Za-z_]\w*=/.test(tok)) {
				i++
				continue
			}
			if (!tok.startsWith('-')) break

			// Check if this flag consumes a value
			if (flagsWithValue.some((f) => tok === f)) {
				i += 2 // skip flag + value
			} else if (flagsWithValue.some((f) => tok.startsWith(f + '='))) {
				i++ // --flag=value
			} else {
				i++ // standalone flag
			}
		}

		if (i >= tokens.length) return []
		cmd = basename(tokens[i])
	}

	// Handle shell -c wrappers: recurse into the script argument, returning ALL inner commands
	if (SHELLS.includes(cmd)) {
		let j = i + 1
		while (j < tokens.length) {
			const tok = tokens[j]
			if (tok === '--') break // -- ends option parsing
			if (tok === '-c' || (tok.startsWith('-') && !tok.startsWith('--') && tok.includes('c') && tok.length <= 4)) {
				const script = tokens[j + 1]
				if (script) return parseAllCommands(script)
				return []
			}
			j++
		}
	}

	return [{ base: cmd, args: tokens.slice(i + 1) }]
}

function parseAllCommands(cmdString: string): ParsedCommand[] {
	const cleaned = stripComments(cmdString)
	return splitTopLevelCommands(cleaned).flatMap((segment) => {
		const unwrapped = unwrapGroup(segment)
		// If unwrapping changed it, re-split in case the group contains multiple commands
		if (unwrapped !== segment) return parseAllCommands(unwrapped)
		const tokens = tokenize(segment)
		return stripWrappersAndParse(tokens)
	})
}

// --- Flag helpers ---

function expandShortFlags(args: string[]): string[] {
	return args.flatMap((arg) =>
		arg.startsWith('-') && !arg.startsWith('--') && arg.length > 2
			? [...arg.slice(1)].map((c) => `-${c}`)
			: [arg]
	)
}

function hasFlag(args: string[], ...flags: string[]): boolean {
	const expanded = expandShortFlags(args)
	return flags.some((f) => expanded.includes(f))
}

function hasArgPrefix(args: string[], prefix: string): boolean {
	return args.some((a) => a === prefix || a.startsWith(prefix + '='))
}

function hasDangerousPath(args: string[]): boolean {
	return args.some((a) => {
		if (a === '/') return true
		if (a === '~' || a === '$HOME') return true
		return SYSTEM_PATHS.some((dp) => a === dp || a.startsWith(dp + '/'))
	})
}

/** For git, skip global options to find the real subcommand */
function gitSubcommandAndArgs(args: string[]): { subcommand: string; subArgs: string[] } | null {
	let i = 0
	while (i < args.length) {
		const arg = args[i]
		if (GIT_GLOBAL_FLAGS_WITH_VALUE.some((f) => arg === f)) {
			i += 2
			continue
		}
		if (GIT_GLOBAL_FLAGS_WITH_VALUE.some((f) => arg.startsWith(f + '='))) {
			i++
			continue
		}
		if (arg.startsWith('-')) {
			i++
			continue
		}
		return { subcommand: arg, subArgs: args.slice(i + 1) }
	}
	return null
}

/** For git stash/worktree, get the sub-verb (first non-flag arg) */
function firstNonFlagArg(args: string[]): string | undefined {
	return args.find((a) => !a.startsWith('-'))
}

// --- Pattern definitions ---

const DANGEROUS_PATTERNS: DangerousPattern[] = [
	{
		command: 'git',
		subcommand: 'checkout',
		args: ['--'],
		reason: 'Discards uncommitted changes permanently. Use "git stash" first.',
	},
	{
		command: 'git',
		subcommand: 'restore',
		reason: 'Discards uncommitted changes.',
		check: (args) => {
			const hasStaged = args.includes('--staged') || hasFlag(args, '-S')
			const hasWorktree = args.includes('--worktree') || hasFlag(args, '-W')
			return !(hasStaged && !hasWorktree)
		},
	},
	{
		command: 'git',
		subcommand: 'reset',
		args: ['--hard'],
		reason: 'Destroys all uncommitted changes.',
	},
	{
		command: 'git',
		subcommand: 'reset',
		args: ['--merge'],
		reason: 'Can lose uncommitted changes.',
	},
	{
		command: 'git',
		subcommand: 'clean',
		reason: 'Removes untracked files permanently.',
		check: (args) => {
			if (!hasFlag(args, '-f') && !args.includes('--force')) return false
			if (args.includes('--dry-run') || hasFlag(args, '-n')) return false
			return true
		},
	},
	{
		command: 'git',
		subcommand: 'push',
		reason: 'Destroys remote history.',
		check: (args) =>
			hasFlag(args, '-f') ||
			args.includes('--force') ||
			hasArgPrefix(args, '--force-with-lease') ||
			args.some((a) => a.startsWith('+') && a.includes(':')),
	},
	{
		command: 'git',
		subcommand: 'branch',
		args: ['-D'],
		reason: 'Force-deletes branch without merge check.',
	},
	{
		command: 'git',
		subcommand: 'stash',
		check: (args) => firstNonFlagArg(args) === 'drop',
		reason: 'Permanently deletes stashed changes.',
	},
	{
		command: 'git',
		subcommand: 'stash',
		check: (args) => firstNonFlagArg(args) === 'clear',
		reason: 'Deletes ALL stashed changes.',
	},
	{
		command: 'git',
		subcommand: 'worktree',
		check: (args) =>
			firstNonFlagArg(args) === 'remove' &&
			(args.includes('--force') || hasFlag(args, '-f')),
		reason: 'Force-deletes worktree without checking for changes.',
	},
	{
		command: 'rm',
		reason: 'Recursive file deletion.',
		check: (args) => hasFlag(args, '-r', '-R') || args.includes('--recursive'),
	},
	{
		command: 'find',
		args: ['-delete'],
		reason: 'Permanently removes files matching criteria.',
	},
	{
		command: 'xargs',
		check: (args) => args.some((a) => a === 'rm' || a.startsWith('rm ')),
		reason: 'Dynamic input makes targets unpredictable.',
	},
	{
		command: 'parallel',
		check: (args) => args.some((a) => a === 'rm' || a.startsWith('rm ')),
		reason: 'Dynamic input makes targets unpredictable.',
	},
	{
		command: 'chmod',
		reason: 'Recursive permission change on sensitive path.',
		check: (args) => (hasFlag(args, '-R') || args.includes('--recursive')) && hasDangerousPath(args),
	},
	{
		command: 'chown',
		reason: 'Recursive ownership change on sensitive path.',
		check: (args) => (hasFlag(args, '-R') || args.includes('--recursive')) && hasDangerousPath(args),
	},
	{
		command: 'dd',
		reason: 'Can overwrite disk data. Verify the target carefully.',
	},
]

// --- Matching ---

function formatDanger(base: string, subcommand: string | undefined, reason: string, raw: string): string {
	const label = subcommand ? `${base} ${subcommand}` : base
	return `⚠️ ${label}: ${reason}\n\nCommand: ${raw}`
}

function checkDangerous(cmdString: string): string | null {
	// Conservative fallback: if the command contains shell syntax we can't parse reliably,
	// check if it also contains dangerous-looking keywords — if so, prompt
	if (UNSUPPORTED_SYNTAX.test(cmdString)) {
		const dangerousKeywords = /\brm\s+-[^\s]*r|\brm\s+--recursive|\bgit\s+reset\s+--hard|\bgit\s+clean\s+-[^\s]*f|\bgit\s+push\s+--force|\bgit\s+checkout\s+--\s|\bdd\s|\bmkfs/
		if (dangerousKeywords.test(cmdString)) {
			return `⚠️ Complex shell command contains potentially dangerous operations.\n\nCommand: ${cmdString}`
		}
	}

	// mkfs.* prefix matching
	for (const cmd of parseAllCommands(cmdString)) {
		if (cmd.base === 'mkfs' || cmd.base.startsWith('mkfs.')) {
			return formatDanger(cmd.base, undefined, 'Formats a filesystem, destroying all data on the device.', cmdString)
		}
	}

	for (const cmd of parseAllCommands(cmdString)) {
		for (const pattern of DANGEROUS_PATTERNS) {
			if (cmd.base !== pattern.command) continue

			let effectiveArgs = cmd.args
			let effectiveSubcommand = cmd.args[0]
			if (cmd.base === 'git') {
				const resolved = gitSubcommandAndArgs(cmd.args)
				if (!resolved) continue
				effectiveSubcommand = resolved.subcommand
				effectiveArgs = resolved.subArgs
			}

			if (pattern.subcommand && effectiveSubcommand !== pattern.subcommand) continue

			if (pattern.check) {
				if (pattern.check(effectiveArgs))
					return formatDanger(cmd.base, pattern.subcommand, pattern.reason, cmdString)
				continue
			}

			if (pattern.args) {
				const expanded = expandShortFlags(effectiveArgs)
				if (pattern.args.some((a) => expanded.includes(a)))
					return formatDanger(cmd.base, pattern.subcommand, pattern.reason, cmdString)
				continue
			}

			return formatDanger(cmd.base, pattern.subcommand, pattern.reason, cmdString)
		}
	}
	return null
}

// --- Plugin entry ---

export default function (amp: PluginAPI) {
	amp.on('tool.call', async (event: ToolCallEvent, ctx) => {
		const shellCmd = amp.helpers.shellCommandFromToolCall(event)
		if (!shellCmd) return { action: 'allow' as const }

		const danger = checkDangerous(shellCmd.command)
		if (!danger) return { action: 'allow' as const }

		const confirmed = await ctx.ui.confirm({
			title: '🛡️ Safety Net — Dangerous Command Detected',
			message: danger,
			confirmButtonText: 'Run Anyway',
		})

		if (!confirmed) {
			return {
				action: 'reject-and-continue' as const,
				message: `BLOCKED by Safety Net\n\n${danger}\n\nThe user declined to run this command.`,
			}
		}

		return { action: 'allow' as const }
	})
}
