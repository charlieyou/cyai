// @amp-agent-mode {"key":"swarm-planner","label":"swarm-planner","color":"#7c3aed"}
// @amp-agent-mode {"key":"swarm-worker","label":"swarm-worker","color":"#0891b2"}

import type { PluginAPI } from '@ampcode/plugin'

import { registerBackstop } from './backstop'
import { registerGuards } from './guards'
import { registerModes } from './modes'
import { registerSession } from './session'
import { registerTools } from './tools'

export const description =
	'Agent swarm: swarm-planner and swarm-worker modes, spawn/children/publish_docs/handoff tools, edit and shell guards, and a handoff backstop.'

export default function (amp: PluginAPI) {
	const agents = registerModes(amp)
	registerTools(amp, agents)
	registerGuards(amp)
	registerBackstop(amp)
	registerSession(amp)
}
