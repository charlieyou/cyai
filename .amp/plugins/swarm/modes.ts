// Owner: modes-and-prompts child. Registers the swarm-planner and swarm-worker modes (§4).

import type { Agent, PluginAPI } from '@ampcode/plugin'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { PLANNER, WORKER } from './core'

export interface SwarmAgents {
	planner: Agent
	worker: Agent
}

/** code_exec and tool_search are granted even with an explicit include list unless excluded (§4, S0). */
const EXCLUDE = ['code_exec', 'tool_search']

const prompt = (name: string) => readFileSync(join(import.meta.dir, 'prompts', `${name}.md`), 'utf8')

export function registerModes(amp: PluginAPI): SwarmAgents {
	// `name` must equal the role: hooks identify roles via (await thread.agent()).definition.name.
	const planner = amp.createAgent({
		name: PLANNER,
		model: 'anthropic/claude-opus-5-5',
		reasoningEffort: 'high',
		instructions: prompt('planner'),
		tools: {
			include: ['Read', 'finder', 'oracle', 'edit_file', 'create_file', 'spawn', 'spawn_alt', 'children', 'publish_docs', 'handoff'],
			exclude: EXCLUDE,
		},
		display: { label: PLANNER, color: '#7c3aed' },
	})
	const worker = amp.createAgent({
		name: WORKER,
		model: 'openai/gpt-6.1-sol',
		reasoningEffort: 'medium',
		instructions: prompt('worker'),
		tools: {
			include: [
				'Read',
				'finder',
				'oracle',
				'edit_file',
				'create_file',
				'apply_patch',
				'shell_command',
				'shell_command_status',
				'shell_command_kill',
				'handoff',
			],
			exclude: EXCLUDE,
		},
		display: { label: WORKER, color: '#0891b2' },
	})
	amp.registerAgentMode({
		key: PLANNER,
		description: 'Swarm planner: owns a scope, writes design decisions to docs/, delegates all code to swarm workers.',
		agent: planner.definition,
	})
	amp.registerAgentMode({
		key: WORKER,
		description: 'Swarm worker: does exactly one task, lands it on swarm/<run>, and hands off once to its planner.',
		agent: worker.definition,
	})
	return { planner, worker }
}
