import type { PluginAPI, PluginUI } from '@ampcode/plugin'

type TmuxContext = {
	session: string
	windowIndex: string
	windowName: string
	paneIndex: string
	paneId: string
	clientTty: string
	path: string
}

const TMUX_FIELD_SEPARATOR = '␟'
const TMUX_FORMAT = [
	'#{session_name}',
	'#{window_index}',
	'#{window_name}',
	'#{pane_index}',
	'#{pane_id}',
	'#{client_tty}',
	'#{pane_current_path}',
].join(TMUX_FIELD_SEPARATOR)

const TMUX_FORMAT_FIELD_COUNT = 7
const MAX_OSC_FIELD_LENGTH = 200

export default function (amp: PluginAPI) {
	amp.registerCommand(
		'test-tmux-context-notification',
		{
			title: 'Test tmux context notification',
			category: 'notifications',
			description: 'Send a test notification annotated with tmux session/window/pane context.',
		},
		async (ctx) => {
			const tmuxContext = await getTmuxContext(amp)
			const location = formatLocation(tmuxContext)

			await notify(amp, ctx.ui, 'Amp notification test', location, tmuxContext)
		},
	)

	amp.on('agent.end', async (event, ctx) => {
		const tmuxContext = await getTmuxContext(amp)
		const location = formatLocation(tmuxContext)
		const status = event.status === 'done' ? 'done' : event.status

		await notify(amp, ctx.ui, `Amp ${status}`, location, tmuxContext)
	})
}

async function notify(
	amp: PluginAPI,
	ui: PluginUI,
	title: string,
	body: string,
	context: TmuxContext | null,
): Promise<void> {
	if (context?.clientTty) {
		const result = await sendOscNotification(amp, context.clientTty, title, body)
		if (result) {
			return
		}
	}

	await ui.notify(`${title}${body ? ` — ${body}` : ''}`)
}

async function sendOscNotification(amp: PluginAPI, tty: string, title: string, body: string): Promise<boolean> {
	try {
		const result = await amp.$`python3 -c ${WRITE_OSC_NOTIFICATION} ${tty} ${sanitizeOsc(title)} ${sanitizeOsc(body)}`
		return result.exitCode === 0
	} catch {
		return false
	}
}

async function getTmuxContext(amp: PluginAPI): Promise<TmuxContext | null> {
	const paneId = process.env.TMUX_PANE
	if (!paneId) {
		return null
	}

	try {
		const result = await amp.$`tmux display-message -p -t ${paneId} ${TMUX_FORMAT}`
		if (result.exitCode !== 0) {
			return null
		}

		const line = result.stdout.replace(/\r?\n$/, '')
		const parts = line.split(TMUX_FIELD_SEPARATOR)
		if (parts.length !== TMUX_FORMAT_FIELD_COUNT) {
			return null
		}

		const [session, windowIndex, windowName, paneIndex, currentPaneId, clientTty, path] = parts
		if (!session || !windowIndex || !paneIndex) {
			return null
		}

		return {
			session,
			windowIndex,
			windowName: windowName || 'unnamed',
			paneIndex,
			paneId: currentPaneId || paneId,
			clientTty: clientTty || '',
			path: path || '',
		}
	} catch {
		return null
	}
}

function formatLocation(context: TmuxContext | null): string {
	if (!context) {
		return ''
	}

	const path = abbreviateHome(context.path)
	return `${context.session}:${context.windowIndex}.${context.paneIndex} ${context.windowName} (${context.paneId})${path ? ` ${path}` : ''}`
}

function abbreviateHome(path: string): string {
	const home = process.env.HOME
	if (!home || !path.startsWith(home)) {
		return path
	}

	return `~${path.slice(home.length)}`
}

function sanitizeOsc(value: string): string {
	return value
		.replace(/[\x00-\x1f\x7f;]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, MAX_OSC_FIELD_LENGTH)
}

const WRITE_OSC_NOTIFICATION = String.raw`
import os
import stat
import sys

tty, title, body = sys.argv[1:4]
tty = os.path.realpath(tty)

if not tty.startswith("/dev/"):
    sys.exit(2)

st = os.stat(tty)
if not stat.S_ISCHR(st.st_mode):
    sys.exit(3)

if not os.access(tty, os.W_OK):
    sys.exit(4)

with open(tty, "wb", buffering=0) as f:
    f.write(f"\x1b]777;notify;{title};{body}\x07".encode("utf-8", "replace"))
`
