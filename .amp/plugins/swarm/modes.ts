// Owner: modes-and-prompts child. Registers the swarm-planner and swarm-worker modes (§4).

import type { Agent, PluginAPI } from '@ampcode/plugin'

export interface SwarmAgents {
	planner: Agent
	worker: Agent
}

export function registerModes(amp: PluginAPI): SwarmAgents {
	throw new Error('not implemented')
}
