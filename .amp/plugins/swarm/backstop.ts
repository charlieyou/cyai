// agent.end handoff backstop for workers (§7 row 1). Sub-planners are exempt: their turns end
// while they wait for their own children, and their parents replace them at the deadline instead.

import type { AgentEndResult, PluginAPI, ThreadMessage } from '@ampcode/plugin'

import { WORKER, loadSelf, roleOf } from './core'

export const NUDGE =
	'Call `handoff` now with your report: what is done, where it is (commits on the run branch or your wip ref), deviations, concerns, and anything blocked. If you could not finish, hand off as blocked; do not keep working.'

const LAST_MESSAGE_MAX = 1500

export function registerBackstop(amp: PluginAPI): void {
	amp.on('agent.end', async (event, ctx): Promise<AgentEndResult> => {
		if (event.status === 'cancelled') return // a human stopped the turn
		if ((await roleOf(ctx.thread)) !== WORKER) return
		const self = await loadSelf(ctx.thread)
		if (!self?.parent) return

		const handedOff = amp.helpers
			.toolCallsInMessages(event.messages)
			.some(({ call, result }) => call.tool === 'handoff' && result.status === 'done')
		if (handedOff) return

		if (event.message.trim() !== NUDGE) return { action: 'continue', userMessage: NUDGE, maxContinuations: 1 }

		// The nudge turn also ended without a handoff: report for the worker. The prefix must start
		// the message, since parents detect handoffs by `[handoff from <id>`.
		const content = `[handoff from ${self.thread} (${WORKER}): ${self.title}] ended without a report; last message: ${lastAssistantText(event.messages)}`
		try {
			await amp.threads.get(self.parent).appendUserMessage({ type: 'user-message', content })
		} catch (e) {
			ctx.logger.log(`swarm backstop: appending to ${self.parent} failed: ${e}`)
		}
	})
}

/** Last assistant text of the turn on one line (so no line inside it can look like a handoff), truncated. */
function lastAssistantText(messages: ThreadMessage[]): string {
	for (const m of [...messages].reverse()) {
		if (m.role !== 'assistant') continue
		const text = m.content
			.map((c) => (c.type === 'text' ? c.text : ''))
			.join(' ')
			.replace(/\s+/g, ' ')
			.trim()
		if (text) return text.length > LAST_MESSAGE_MAX ? `${text.slice(0, LAST_MESSAGE_MAX)}…` : text
	}
	return '(none)'
}
