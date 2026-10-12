// Vendored from `amp plugins show-docs` (Amp 0.0.1791831898) for type-checking only.
declare module '@ampcode/plugin' {
	/**
	 * # Amp Plugin API
	 *
	 * Plugins are JavaScript/TypeScript programs that extend & customize Amp.
	 * They are long-lived processes that may run for multiple threads concurrently.
	 *
	 * Plugins live in `.amp/plugins/` (project) or `~/.config/amp/plugins/` (system) and are executed using Bun.
	 *
	 * A plugin exports a default function that receives a {@link PluginAPI} instance. For example:
	 *
	 * ```ts
	 * import type { PluginAPI } from '@ampcode/plugin'
	 *
	 * export const description = 'Explains what this plugin adds to Amp'
	 *
	 * export default function (amp: PluginAPI) {
	 *   amp.logger.log('Plugin initialized')
	 * }
	 * ```
	 *
	 * The optional `description` named export must be a static string literal of at most 300
	 * characters. Amp shows it in plugin settings and ignores missing, dynamic, or longer values.
	 */

	/**
	 * The plugin API object passed to the plugin's default export function.
	 */
	export interface PluginAPI {
		/** Logger scoped to this plugin */
		logger: PluginLogger

		/** System capabilities and information */
		system: PluginSystem

		/** Observable configuration that streams changes */
		configuration: PluginConfiguration<Record<string, unknown>>

		/**
		 * Execute shell commands with the plugin API's tagged-template shell runner.
		 * Unlike `ctx.$` in event handlers, this is not tied to a specific hook invocation.
		 */
		$: ShellFunction

		/**
		 * Helper utilities for interpreting tool events.
		 */
		helpers: {
			shellCommandFromToolCall: ShellCommandFromToolCall
			toolCallsInMessages: ToolCallsInMessages
			filesModifiedByToolCall: FilesModifiedByToolCall
			filePathFromURI: FilePathFromURI
			isPluginUINotAvailableError: IsPluginUINotAvailableError
		}

		/** Platform UI capabilities */
		ui: PluginUI

		/**
		 * Register a handler for plugin events.
		 * For request events (e.g., tool.call), the handler must return a result.
		 * For fire-and-forget events, the handler returns void.
		 *
		 * If multiple plugins listen on the same event, the order in which each plugin's event handler is executed is not defined.
		 */
		on<E extends keyof PluginEventMap>(
			event: E,
			handler: (event: PluginEventMap[E], ctx: PluginEventContext<E>) => PluginHandlerResult<E>,
		): Subscription

		/**
		 * Register a command that appears in Amp's command palette.
		 * When the user invokes the command, the handler is called.
		 *
		 * @param id - Stable identifier for the command (e.g., "hello-world").
		 * @param options - Configuration for the command including title, category, and description.
		 * @param handler - The function to execute when the command is invoked.
		 *
		 * @example
		 * ```ts
		 * amp.registerCommand('hello-world', { title: 'greet', category: 'hello', description: 'Say hello' }, async (ctx) => {
		 *   await ctx.ui.notify('Hello, world!')
		 * })
		 * ```
		 */
		registerCommand(
			id: string,
			options: PluginCommandOptions,
			handler: (ctx: PluginCommandContext) => void | Promise<void>,
		): CommandSubscription

		/**
		 * Register a tool that the agent can call.
		 * Plugin tools appear alongside built-in tools and can be invoked by the LLM during conversations.
		 *
		 * @param definition - The tool definition including name, description, schema, and execute handler.
		 *
		 * @example
		 * ```ts
		 * amp.registerTool({
		 *   name: 'hello',
		 *   description: 'Greet someone by name',
		 *   inputSchema: {
		 *     type: 'object',
		 *     properties: { name: { type: 'string', description: 'Name to greet' } },
		 *     required: ['name'],
		 *   },
		 *   async execute(input) {
		 *     return `Hello, ${input.name}!`
		 *   },
		 * })
		 * ```
		 */
		registerTool(definition: PluginToolDefinition): Subscription

		/**
		 * Register an Agent Skill from this plugin's directory.
		 *
		 * The path must be relative to a directory plugin's root and name a directory that contains
		 * `SKILL.md`. Amp validates the package and makes it available under the qualified name
		 * `<plugin-name>:<skill-name>`.
		 *
		 * @example
		 * ```ts
		 * await amp.registerSkill({ path: 'skills/simulator' })
		 * ```
		 */
		registerSkill(definition: PluginSkillDefinition): Promise<Subscription>

		/**
		 * Register a text pattern that Amp turns into a link wherever it appears in a thread
		 * transcript: user messages and the prose of assistant replies.
		 *
		 * Amp records the patterns on each thread this plugin's executor connects to, so readers
		 * who open the thread later without an executor still see the links.
		 *
		 * @example
		 * ```ts
		 * amp.registerLinkPattern({
		 *   id: 'issue',
		 *   pattern: 'ENG-\\d{1,6}',
		 *   href: 'https://linear.app/acme/issue/{{match}}',
		 * })
		 * ```
		 */
		registerLinkPattern(definition: PluginLinkPatternDefinition): Subscription

		/**
		 * Register a callback that runs before this plugin instance is stopped.
		 *
		 * Dispose callbacks run when the plugin is unloaded or reloaded and on graceful
		 * host shutdown. Use them to release resources the plugin owns outside its own
		 * process, such as child processes, remote sessions, or temporary files.
		 *
		 * The host bounds cleanup time: all of a plugin's dispose callbacks together
		 * get about 3 seconds. After they settle or the budget elapses, the plugin
		 * process is terminated. Callbacks run concurrently, in no guaranteed order,
		 * and thrown errors are logged and otherwise ignored.
		 *
		 * Dispose callbacks do NOT run when the plugin process crashes or is killed
		 * with SIGKILL. Keep an external backstop (such as a server-side idle
		 * timeout) for resources that must not outlive the plugin in those cases.
		 *
		 * @example
		 * ```ts
		 * const server = await startHelperProcess()
		 * amp.onDispose(async () => {
		 *   await server.stop()
		 * })
		 * ```
		 */
		onDispose(callback: () => void | Promise<void>): Subscription

		/**
		 * Register a durable generic webhook for this plugin in an Amp-managed Orb.
		 *
		 * Project threads owned by the same user share a registration for each plugin and key.
		 * Threads without a project keep a separate registration for each thread. Re-registering
		 * returns the same capability URL. Treat the URL as a credential.
		 *
		 * Handler side effects are delivered at least once. Use `event.id` as an
		 * idempotency key because an executor can stop after the handler succeeds but
		 * before durable consumption is recorded. Handlers have 30 seconds to complete;
		 * `ctx.signal` is aborted when that deadline elapses, and the event is retried.
		 * A request to an unarchived owner wakes or resumes its Orb. Archiving the owning
		 * thread makes the URL unavailable and pauses queued delivery until the thread is
		 * restored. Handler failures retry after 5 seconds with exponential backoff capped
		 * at 5 minutes. Amp drops an event after 1 hour of handler failures, and later events
		 * can run while an earlier event is waiting to retry.
		 *
		 * @example
		 * ```ts
		 * const { url } = await amp.createWebhook({
		 *   key: 'deploy',
		 *   handler: async (event, ctx) => {
		 *     ctx.logger.log('Deployment received', event.id, event.payload)
		 *   },
		 * })
		 * ```
		 */
		createWebhook(options: CreateWebhookOptions): Promise<WebhookRegistration>

		/** AI helpers */
		ai: PluginAI

		/** Attachment uploads, for URL-backed image tool result blocks */
		attachments: PluginAttachments

		/**
		 * Create a custom agent bound to this plugin runtime.
		 *
		 * Run `amp plugins show-agent-options` or `amp plugins show-agent-options --json` to
		 * discover public model IDs and built-in tool names that are suitable for plugin agents.
		 */
		createAgent(config: CreateAgentConfig): Agent

		/**
		 * Get an agent handle for one of Amp's built-in agent modes (`low`,
		 * `medium`, `high`, or `ultra`). Threads spawned from the handle run the
		 * built-in mode's prompt and tools, like a thread the user started in that
		 * mode. Deprecated modes (`smart`, `deep`, `rush`) are accepted for
		 * backward compatibility and spawn threads in their replacement mode.
		 */
		getBuiltinAgent(mode: BuiltinAgentMode): Agent

		/**
		 * Register a custom agent mode that clients may show alongside built-in modes.
		 *
		 * External plugins must include a matching `// @amp-agent-mode ...` metadata
		 * comment with the mode `key` and `label` for each registered mode. Clients
		 * use this static metadata to avoid silent drift between runtime registration
		 * and discovery, and warn when they are out of sync.
		 * Multiple mode comments in one plugin file are supported.
		 */
		registerAgentMode(definition: PluginAgentModeDefinition): Subscription

		/**
		 * Observable that emits the currently active thread (the one the user is focused on
		 * in the UI), or `null` when no thread is active.
		 *
		 * Use this to determine whether the thread that triggered an event is the one the user
		 * is currently looking at, or is running in the background. For example, in a
		 * `tool.call` handler, compare `event.thread.id` to `amp.activeThread.current` to
		 * decide whether to surface a UI prompt (active) or take a non-interactive default
		 * (background).
		 */
		activeThread: Observable<{ id: ThreadID } | null> & {
			readonly current: { id: ThreadID } | null
		}

		/** Thread lookup APIs. */
		threads: PluginThreads

		/**
		 * Experimental plugin APIs that are not stable and may change or be removed.
		 *
		 * Prefer the first-class top-level APIs when available. Migrated APIs remain
		 * here as compatibility aliases for existing plugins.
		 *
		 * Agents should only build on these APIs when the user explicitly approves the
		 * use of experimental Amp plugin APIs.
		 */
		experimental?: ExperimentalPluginAPI
	}

	/**
	 * APIs under `PluginAPI.experimental` are not stable and may change or be removed.
	 */
	export interface ExperimentalPluginAPI {
		/**
		 * Create a custom agent bound to this plugin runtime.
		 *
		 * Run `amp plugins show-agent-options` or `amp plugins show-agent-options --json` to
		 * discover public model IDs and built-in tool names that are suitable for plugin agents.
		 */
		createAgent(config: CreateAgentConfig): Agent

		/**
		 * Get an agent handle for one of Amp's built-in agent modes (`low`,
		 * `medium`, `high`, or `ultra`). Threads spawned from the handle run the
		 * built-in mode's prompt and tools, like a thread the user started in that
		 * mode. Deprecated modes (`smart`, `deep`, `rush`) are accepted for
		 * backward compatibility and spawn threads in their replacement mode.
		 */
		getBuiltinAgent(mode: BuiltinAgentMode): Agent

		/**
		 * Register a custom agent mode that clients may show alongside built-in modes.
		 *
		 * External plugins must include a matching `// @amp-agent-mode ...` metadata
		 * comment with the mode `key` and `label` for each registered mode. Clients
		 * use this static metadata to avoid silent drift between runtime registration
		 * and discovery, and warn when they are out of sync.
		 * Multiple mode comments in one plugin file are supported.
		 */
		registerAgentMode(definition: PluginAgentModeDefinition): Subscription

		/**
		 * Create a status item shown near the prompt editor or status bar in the Amp client.
		 *
		 * If no initial value is provided, the item is hidden until its first update.
		 */
		createStatusItem(initial?: StatusItemValue): StatusItem

		/**
		 * Observable that emits the currently active thread (the one the user is focused on
		 * in the UI), or `null` when no thread is active.
		 *
		 * Use this to determine whether the thread that triggered an event is the one the user
		 * is currently looking at, or is running in the background. For example, in a
		 * `tool.call` handler, compare `event.thread.id` to
		 * `amp.activeThread.current` to decide whether to surface a UI prompt
		 * (active) or take a non-interactive default (background).
		 */
		activeThread: Observable<{ id: ThreadID } | null> & {
			readonly current: { id: ThreadID } | null
		}

		/** Thread lookup APIs. */
		threads: PluginThreads
	}

	/** Reasoning effort levels supported by plugin agents, for models that support them. */
	export type AgentReasoningEffort =
		| 'none'
		| 'minimal'
		| 'low'
		| 'medium'
		| 'high'
		| 'xhigh'
		| 'max'

	/** Features that plugin agents can enable on threads they create. */
	export type AgentFeature = 'fast' | 'plaid' | 'pro' | string

	/**
	 * Amp built-in agent modes available to plugins. The `smart`, `deep`, and
	 * `rush` modes are deprecated: existing threads in those modes keep working,
	 * but new threads spawned from them start in the replacement mode
	 * (`rush` → `low`; `smart`/`deep` → `medium`).
	 */
	export type BuiltinAgentMode = 'low' | 'medium' | 'high' | 'ultra' | 'smart' | 'deep' | 'rush'

	export type AgentToolSelection =
		| readonly string[]
		| 'all'
		| {
				/** Tool names to include. Defaults to the agent's standard and external tools. */
				include?: readonly string[] | 'all'
				/**
				 * Tool names added on top of the resolved include list. Use with `extends`
				 * to add tools to the built-in mode's tool list.
				 */
				add?: readonly string[]
				/** Tool names to exclude after applying include. */
				exclude?: readonly string[]
		  }

	export interface CreateAgentConfig {
		/**
		 * Optional agent identity. Amp includes this name in the base system prompt as
		 * `You are <name>, a custom agent running in Amp.` It is also used for logs, UI,
		 * and persisted run metadata. Omit it to avoid adding a named identity to the prompt.
		 * Ignored when `extends` is set: the built-in mode's prompt carries no custom identity.
		 */
		name?: string
		/**
		 * Built-in agent mode this agent extends. Threads render that mode's system
		 * prompt with `instructions` appended as agent instructions, and `tools`
		 * defaults to the mode's tool list. When `model` is omitted, the agent uses
		 * the mode's preferred model and reasoning effort. The agent is a separate
		 * mode: the user's Tune Modes pins for the built-in mode do not change its
		 * model. Deprecated modes
		 * (`smart`, `deep`, `rush`) resolve to their replacement mode.
		 */
		extends?: BuiltinAgentMode
		/**
		 * Model identifier in `provider/model` format, such as `anthropic/claude-sonnet-4-6`.
		 * Required unless `extends` is set, in which case it defaults to the extended
		 * mode's preferred model.
		 *
		 * Run `amp plugins show-agent-options --json` for the public model IDs intended for
		 * plugin agents.
		 */
		model?: PluginAgentModel
		/**
		 * Instructions appended to Amp's base agent prompt, or to the extended mode's
		 * prompt when `extends` is set. Required unless `extends` is set.
		 */
		instructions?: string
		/**
		 * Tools available to this agent. Use 'all' for its provider-appropriate built-in tools
		 * plus plugin, MCP, and remote tools available in its runtime.
		 *
		 * An array or an explicit `include` array replaces the default tool list, including
		 * delegation tools. Use `add` to extend the default list; `exclude` always wins.
		 * Loading a skill does not grant tools omitted from an explicit list.
		 *
		 * Include `create_thread` for persistent child threads with a selected `agent_mode`,
		 * and the coordination tools your workflow needs: `list_agent_modes`, `get_thread_status`,
		 * `send_thread_message`, and `wait_for_threads`. `Task` runs a scoped subagent instead
		 * and does not accept a per-call agent mode.
		 *
		 * Explicit tool lists (arrays and `include`/`exclude` entries) match tool names as
		 * glob patterns: `mcp__*` matches all MCP tools (named `mcp__<server>__<tool>`), and
		 * `plugin__*` matches all plugin tools (also matched as `plugin__<pluginName>__<toolName>`
		 * even though plugin tools are registered under their bare names). Include such an entry
		 * in explicit lists so the user's plugin and MCP tools stay available.
		 *
		 * MCP tools are not sent to the model as individual tools. Every agent gets `tool_search`
		 * and `code_exec` (unless `exclude` names them) and reaches all MCP servers through them as
		 * deferred code-mode modules, so a large MCP catalog does not fill the context window.
		 * Exclude both to send the MCP tools the list selects directly instead.
		 *
		 * Run `amp plugins show-agent-options --json` for built-in tool names intended for
		 * plugin agents.
		 */
		tools?: AgentToolSelection
		/** Optional reasoning effort override for models that support it. */
		reasoningEffort?: AgentReasoningEffort
		/**
		 * Model and reasoning effort for the Oracle consulted from threads running this
		 * agent. Omitted fields keep Amp's automatic routing and default effort. An
		 * unavailable model falls back to Amp's routing at run time.
		 */
		oracle?: AgentSubagentPin
		/**
		 * Model and reasoning effort for the other subagents spawned from threads running
		 * this agent (Task workers, finder, thread reader, librarian). Omitted fields keep
		 * Amp's automatic routing and default effort. An unavailable model falls back to
		 * Amp's routing at run time.
		 */
		subagents?: AgentSubagentPin
		/**
		 * Estimated input-token count at which Amp automatically compacts the thread.
		 * Must be a positive safe integer. When omitted, Amp uses the configured
		 * percentage threshold, which defaults to 90%.
		 */
		compactionThresholdTokens?: number
		/**
		 * Features required on threads created from this agent. Omit this field to inherit
		 * the creating thread's features when the caller also omits
		 * `Agent.createThread({ features })`. Set it to an empty array to use no inherited
		 * features. A non-empty list becomes the required baseline. Callers can add features
		 * to that baseline, but cannot remove them.
		 */
		features?: readonly AgentFeature[]
		/**
		 * Display shown for threads running this agent. Travels with the agent
		 * definition, so threads created from it — including by other plugins via
		 * a `thread.agent()` handle — carry the label.
		 */
		display?: AgentDisplay
	}

	/**
	 * A model pin for one subagent role of a custom agent: the Oracle or the other subagents.
	 * Each field overrides independently.
	 */
	export interface AgentSubagentPin {
		/**
		 * Model identifier in `provider/model` format, such as `anthropic/claude-sonnet-4-6`.
		 * Omit to keep Amp's automatic model routing for the role.
		 */
		model?: PluginAgentModel
		/** Reasoning effort for the role's model. Omit to keep the role's default effort. */
		effort?: AgentReasoningEffort
	}

	/** Display metadata for a plugin agent. */
	export interface AgentDisplay {
		/** Label shown in mode pickers and thread headers, 24 characters or less. */
		label: string
		/** Optional label color as a hex RGB string, for example "#d97706". */
		color?: string
	}

	export interface CustomAgentDefinition extends CreateAgentConfig {
		readonly kind: 'agent-definition'
		/** Resolved model. Filled from the extended mode when `model` was omitted. */
		model: PluginAgentModel
		/** Resolved instructions. Empty when omitted on an extending agent. */
		instructions: string
	}

	/** Reference to one of Amp's built-in agent modes. */
	export interface BuiltinAgentDefinition {
		readonly kind: 'builtin-agent'
		mode: BuiltinAgentMode
	}

	export type AgentDefinition = CustomAgentDefinition | BuiltinAgentDefinition

	export type AgentThreadExecutor =
		| 'local'
		| 'orb'
		| {
				type: 'runner'
				/** Stable ID of a live Amp runner process. */
				id: string
		  }

	export interface RunAgentOptions {
		/**
		 * Maximum time to wait for the agent run to finish, in milliseconds (default 10 minutes).
		 * A timeout rejects the call but leaves the child running until its turn finishes.
		 */
		timeoutMs?: number
		/**
		 * Parent thread for this run when the agent is being used as a subagent/tool.
		 * When omitted, the thread is created without a parent.
		 */
		parentThreadID?: ThreadID
		/**
		 * Set the new thread's visibility. A child thread inherits its parent's visibility when
		 * omitted, so set this explicitly to opt out. Workspace visibility requires the new thread
		 * to belong to a workspace.
		 */
		visibility?: 'private' | 'workspace'
		/**
		 * Enable multiplayer for this many seconds, or set `null` to create it disabled. A
		 * child thread inherits its parent's remaining multiplayer window when omitted, so set this
		 * explicitly to opt out. This option requires an Orb or shared runner executor. Multiplayer threads must
		 * belong to a workspace. Valid numeric values range from 5 minutes to 7 days.
		 */
		multiplayerTTLSeconds?: number | null
		/**
		 * Where the thread should execute. Defaults to `local`, which uses the current
		 * client as the executor. Use `orb` for Amp's cloud sandbox or a runner target
		 * for a live Amp runner process such as `amp --no-tui`.
		 */
		executor?: AgentThreadExecutor
		/**
		 * Amp project for the new thread, as accepted by `amp --project`: a project ID,
		 * `namespace/name`, `owner/repo`, or repository URL. It must match exactly one project you
		 * can access. The thread uses that project's repository, secrets, Orb settings, and
		 * workspace, so multiplayer and workspace visibility work for workspace projects.
		 * Requires executor `orb`. When omitted, Amp matches the Git remotes of the working
		 * directory, which in an Orb is its repository checkout.
		 * Don't take it from untrusted input such as a webhook payload: it can select any project
		 * you can access, along with that project's secrets.
		 */
		project?: string
	}

	export interface CreateAgentThreadOptions {
		/**
		 * Parent thread for the new thread when the agent is being used as a
		 * subagent/tool. When omitted, the thread is created without a parent.
		 */
		parentThreadID?: ThreadID
		/** Show the created thread and make it active in the client when supported. */
		show?: boolean
		/**
		 * Additional features for the new thread. If a custom agent declares `features`,
		 * that list is the required baseline, including an empty list meaning no inherited
		 * features. Values supplied here are added to that baseline and cannot remove its
		 * features. For a built-in agent or a custom agent that omits `features`, omit this
		 * field to inherit the creating thread's features, or pass an empty array to clear them.
		 */
		features?: readonly AgentFeature[]
		/**
		 * Set the new thread's visibility. A child thread inherits its parent's visibility when
		 * omitted, so set this explicitly to opt out. Workspace visibility requires the new thread
		 * to belong to a workspace.
		 */
		visibility?: 'private' | 'workspace'
		/**
		 * Enable multiplayer for this many seconds, or set `null` to create it disabled. A
		 * child thread inherits its parent's remaining multiplayer window when omitted, so set this
		 * explicitly to opt out. This option requires an Orb or shared runner executor. Multiplayer threads must
		 * belong to a workspace. Valid numeric values range from 5 minutes to 7 days.
		 */
		multiplayerTTLSeconds?: number | null
		/**
		 * Where the thread should execute. Defaults to `local`, which uses the current
		 * client as the executor. Use `orb` for Amp's cloud sandbox or a runner target
		 * for a live Amp runner process such as `amp --no-tui`.
		 */
		executor?: AgentThreadExecutor
		/**
		 * Amp project for the new thread, as accepted by `amp --project`: a project ID,
		 * `namespace/name`, `owner/repo`, or repository URL. It must match exactly one project you
		 * can access. The thread uses that project's repository, secrets, Orb settings, and
		 * workspace, so multiplayer and workspace visibility work for workspace projects.
		 * Requires executor `orb`. When omitted, Amp matches the Git remotes of the working
		 * directory, which in an Orb is its repository checkout.
		 * Don't take it from untrusted input such as a webhook payload: it can select any project
		 * you can access, along with that project's secrets.
		 */
		project?: string
	}

	/** Thread handle returned by {@link Agent.createThread}. */
	export type AgentThread = PluginThread

	export interface AgentRunResult {
		/** Thread created for this run. */
		threadID: `T-${string}`
		/** Final text response from the agent. */
		text: string
	}

	/**
	 * A handle to a custom or built-in agent, returned by
	 * {@link PluginAPI.createAgent} and {@link PluginAPI.getBuiltinAgent}.
	 */
	export interface Agent {
		readonly definition: AgentDefinition

		/**
		 * Create a background thread running this agent and return a handle for
		 * interacting with it: append messages, await replies with
		 * {@link PluginThread.waitForResponse}, observe state, or cancel.
		 *
		 * The thread keeps running independently of the caller; there is no
		 * lifecycle to manage.
		 */
		createThread(options?: CreateAgentThreadOptions): Promise<AgentThread>

		/**
		 * One-shot run: create a thread, send the message, and resolve with the
		 * assistant's reply once the turn finishes.
		 *
		 * When called from inside an executing plugin tool, aborting that tool
		 * cancels the agent's turn.
		 */
		run(message: string, options?: RunAgentOptions): Promise<AgentRunResult>
	}

	/** A plugin-defined agent mode shown by supported Amp clients. */
	export interface PluginAgentModeDefinition {
		/**
		 * Stable identifier within the plugin. Keys are case-insensitive: registering
		 * a key that differs from an existing mode's key only by case is an error.
		 */
		key: string
		/**
		 * Label shown in compact mode pickers, for example "review" or "architect".
		 * Defaults to the agent definition's `display.label`; required when the
		 * agent has no display.
		 */
		label?: string
		/**
		 * Optional longer description shown in command palettes and pickers. State both what the
		 * mode does and when to use it.
		 */
		description?: string
		/**
		 * Optional label color as a hex RGB string, for example "#d97706".
		 * Defaults to the agent definition's `display.color`.
		 */
		color?: string
		/** Agent definition used when creating a thread with this mode selected. */
		agent: AgentDefinition
	}

	export interface PluginAgentMode extends Omit<PluginAgentModeDefinition, 'agent' | 'label'> {
		/** Resolved mode label (from the definition or the agent's display). */
		label: string
		pluginName: string
		agent: AgentDefinition
	}

	/**
	 * A plugin status item shown in supported Amp clients.
	 */
	export interface StatusItem extends Subscription {
		/** Update the status item content. */
		update(value: StatusItemValue): void
	}

	export interface StatusItemValue {
		/** Text to show. */
		text: string

		/**
		 * URL to open when clicked, if any.
		 *
		 * Use a `command:` URI to execute a command registered by a plugin or the
		 * command palette. For example, `command:foo` runs the command with ID `foo`.
		 */
		url?: string
	}

	/**
	 * Result from an AI ask operation.
	 */
	export interface PluginAIAskResult {
		/** The classification result: 'yes', 'no', or 'uncertain' */
		result: 'yes' | 'no' | 'uncertain'

		/** Probability (0-1) that the answer is yes */
		probability: number

		/** Explanation of why the AI gave this answer */
		reason: string
	}

	/**
	 * A model provider namespace. New definitions use models.dev provider IDs or Amp's private
	 * namespace.
	 */
	export type PluginAIModelProvider =
		| 'alibaba'
		| 'amp'
		| 'anthropic'
		| 'baseten'
		| 'deepseek'
		| 'fireworks-ai'
		| 'google-vertex'
		| 'meta'
		| 'minimax'
		| 'moonshotai'
		| 'ollama-cloud'
		| 'openai'
		| 'thinkingmachines'
		| 'xai'
		| 'zhipuai'

	/** Model identifier in `provider/model` format, such as `openai/gpt-5.6-sol`. */
	export type PluginAIModel = `${PluginAIModelProvider}/${string}`

	/**
	 * Model identifier for a custom agent. Providers outside Amp's built-in set require a matching
	 * AI router configured for the account at inference time.
	 */
	export type PluginAgentModel = `${string}/${string}`

	export type PluginAIFieldSchema = {
		type: string | string[]
		description?: string
		[key: string]: unknown
	}

	export type PluginAIJSONSchema = {
		type: 'object'
		properties?: Record<string, PluginAIFieldSchema>
		required?: string[]
		additionalProperties?: boolean
		[key: string]: unknown
	}

	/**
	 * Options for an AI operation.
	 */
	export interface PluginAIOptions {
		/** Thread to bill and route the AI request through. Required outside a thread-bound handler. */
		threadID?: ThreadID
		/** Model identifier in `provider/model` format. Defaults to Amp's fast classifier model. */
		model?: PluginAIModel
		/** Optional reasoning effort override for models that support it. Defaults to no reasoning. */
		reasoningEffort?: AgentReasoningEffort
		/** Optional system instructions. */
		system?: string
		/** Maximum output tokens. */
		maxTokens?: number
	}

	/**
	 * Options for an AI ask operation.
	 */
	export interface PluginAIAskOptions extends PluginAIOptions {}

	export interface PluginAIObjectSchema {
		name: string
		description?: string
		fields: Record<string, PluginAIFieldSchema>
	}

	export interface PluginAIGenerateTextRequest extends PluginAIOptions {
		/** The prompt to send to the model. */
		prompt: string
		/** Omit schema to receive a text response. */
		schema?: never
	}

	export interface PluginAIGenerateObjectRequest extends PluginAIOptions {
		/** The prompt to send to the model. */
		prompt: string
		/** Schema for structured output. Supplying a schema returns the validated object. */
		schema: PluginAIObjectSchema
	}

	/**
	 * Text or JSON accepted wherever a decision takes a state, instructions, or criteria. Objects
	 * and arrays are passed to the model as-is.
	 */
	export type DecisionInput = string | Record<string, unknown> | unknown[]

	/** Estimates whether a condition holds for the state. Answers with a probability from 0 to 1. */
	export interface NoulQuestion {
		type: 'noul'
		instructions: DecisionInput
		/** Optional descriptions of what makes the condition true or false. */
		criteria?: { true?: DecisionInput; false?: DecisionInput }
	}

	/** Rates the state on an ordered scale. `criteria` lists 2–10 levels, lowest first. */
	export interface ScoreQuestion {
		type: 'score'
		instructions: DecisionInput
		criteria: DecisionInput[]
	}

	/** Chooses one of 2–20 options. `criteria` maps each option to a description or `null`. */
	export interface ChoiceQuestion<Option extends string = string> {
		type: 'choice'
		instructions: DecisionInput
		criteria: Record<Option, DecisionInput | null>
	}

	export type DecisionQuestion = NoulQuestion | ScoreQuestion | ChoiceQuestion

	export interface NoulAnswer {
		type: 'noul'
		/** Probability from 0 to 1 that the condition holds. */
		noul: number
	}

	export interface ScoreAnswer {
		type: 'score'
		/** Probability-weighted score across the levels, from 0 to the number of levels minus one. */
		score: number
		/** Level index (as a string) to the level description. */
		legend: Record<string, string>
		/** Probability of each level index. */
		probabilities: Record<string, number>
		/**
		 * The model's confidence in the score, from 0 to 1. Each model defines it; it is not always
		 * the probability of the most likely level.
		 */
		confidence: number
	}

	export interface ChoiceAnswer<Option extends string = string> {
		type: 'choice'
		choice: Option
		/** Probability of each option. */
		probabilities: Record<Option, number>
		/**
		 * The model's confidence in `choice`, from 0 to 1. Each model defines it; it is not always
		 * the probability of `choice`.
		 */
		confidence: number
	}

	export type DecisionAnswer = NoulAnswer | ScoreAnswer | ChoiceAnswer

	/** The answer type returned for a question of type `Q`. */
	export type DecisionAnswerFor<Q extends DecisionQuestion> =
		Q extends ChoiceQuestion<infer Option>
			? ChoiceAnswer<Option>
			: Q extends ScoreQuestion
				? ScoreAnswer
				: NoulAnswer

	/**
	 * A decision model, written as `provider/model`. `typesafe/jev` is TypeSafe's Jev.
	 * `openai/gpt-6-luna` is OpenAI's Decisions API. A workspace can disable a provider, so a model
	 * that exists here can still be unavailable in a thread.
	 *
	 * The models answer the same questions but are calibrated differently, so a threshold tuned on
	 * one does not carry over to the other. With `openai/gpt-6-luna`, JSON in `state`,
	 * `instructions`, and `criteria` is sent as its JSON text, the criteria of a `noul` question are
	 * appended to its instructions, and the call rejects if OpenAI declines to answer a question.
	 */
	export type DecisionModel = 'typesafe/jev' | 'openai/gpt-6-luna'

	/** The state every decision is judged against, and the thread that routes the request. */
	export interface DecisionOptions {
		/** Thread to route the request through. Required outside a thread-bound handler. */
		threadID?: ThreadID
		/**
		 * The decision model to ask. Defaults to `typesafe/jev`. The call fails if the thread's
		 * workspace has disabled that model; Amp never asks another model in its place, so name
		 * `openai/gpt-6-luna` for a workspace that allows only OpenAI.
		 */
		model?: DecisionModel
		/** The situation to judge: text, or JSON the model reads as-is. Up to 50,000 characters of text. */
		state: DecisionInput
	}

	export interface DecisionRequest<
		Q extends Record<string, DecisionQuestion> = Record<string, DecisionQuestion>,
	> extends DecisionOptions {
		/** 1–20 questions, each answered independently against `state`. */
		questions: Q
	}

	export interface DecisionResult<
		Q extends Record<string, DecisionQuestion> = Record<string, DecisionQuestion>,
	> {
		/**
		 * The exact model version that answered, as its provider reports it, such as `jev-1.13.0` or
		 * `gpt-6-luna`.
		 * Record it when you tune thresholds so a model change is visible.
		 */
		model: string
		answers: { [K in keyof Q]: DecisionAnswerFor<Q[K]> }
	}

	/** A single {@link ChoiceQuestion} with its state. */
	export interface ChoiceRequest<Option extends string = string>
		extends DecisionOptions, Omit<ChoiceQuestion<Option>, 'type'> {}

	/** A single {@link NoulQuestion} with its state. */
	export interface NoulRequest extends DecisionOptions, Omit<NoulQuestion, 'type'> {}

	/** A single {@link ScoreQuestion} with its state. */
	export interface ScoreRequest extends DecisionOptions, Omit<ScoreQuestion, 'type'> {}

	/**
	 * AI capabilities provided to plugins.
	 */
	export interface PluginAI {
		/**
		 * Ask an AI model for a text response.
		 *
		 * Calls are routed through the current thread. Pass `threadID` when calling outside a
		 * thread-bound handler.
		 */
		generate(request: PluginAIGenerateTextRequest): Promise<string>

		/**
		 * Ask an AI model for a structured JSON object matching the provided schema.
		 *
		 * Calls are routed through the current thread. Pass `threadID` when calling outside a
		 * thread-bound handler.
		 */
		generate<T extends Record<string, unknown> = Record<string, unknown>>(
			request: PluginAIGenerateObjectRequest,
		): Promise<T>

		/**
		 * Ask an AI model a yes/no question and get a confidence-based response with reasoning.
		 * This is a convenience wrapper around {@link PluginAI.generate}.
		 *
		 * @param question - The yes/no question to ask
		 * @param options - Thread to bill and route the AI request through. Omit inside a thread-bound handler.
		 * @returns Object with result, probability, and reason
		 */
		ask(question: string, options?: PluginAIAskOptions): Promise<PluginAIAskResult>

		/**
		 * Ask a decision model typed questions about a state. A decision model does not generate
		 * text: each answer is a choice, a score, or a yes/no probability (`noul`) with calibrated
		 * probabilities, in well under a second and at a small fraction of the cost of
		 * {@link PluginAI.generate}. Use it for routing, triage, relevance, and policy checks where
		 * the application owns the thresholds and control flow; use {@link PluginAI.generate} when
		 * the answer needs reasoning or prose.
		 *
		 * All questions in one call are answered against the same `state` in one round trip. The
		 * answer type of each question is inferred from the request, so `result.answers.route.choice`
		 * is typed as the option names you passed. The typed shape is guaranteed; the answer can
		 * still be wrong, and adversarial text inside `state` can move it.
		 *
		 * TypeSafe's Jev answers unless you pass {@link DecisionOptions.model}, and
		 * {@link DecisionResult.model} reports the version that answered. The call rejects when the
		 * thread's workspace has disabled the model, so handle the error where a decision is
		 * optional.
		 *
		 * Calls are routed through the current thread. Pass `threadID` when calling outside a
		 * thread-bound handler.
		 */
		decide<Q extends Record<string, DecisionQuestion>>(
			request: DecisionRequest<Q>,
		): Promise<DecisionResult<Q>>

		/**
		 * Choose one of 2–20 options for a state. Shorthand for {@link PluginAI.decide} with one
		 * `choice` question; `answer.choice` is typed as the keys of `criteria`.
		 */
		choice<Option extends string>(request: ChoiceRequest<Option>): Promise<ChoiceAnswer<Option>>

		/**
		 * Estimate the probability that a condition holds for a state. Shorthand for
		 * {@link PluginAI.decide} with one `noul` question.
		 */
		noul(request: NoulRequest): Promise<NoulAnswer>

		/**
		 * Rate a state on an ordered scale of 2–10 levels. Shorthand for {@link PluginAI.decide} with
		 * one `score` question.
		 */
		score(request: ScoreRequest): Promise<ScoreAnswer>
	}

	/**
	 * Input for {@link PluginAttachments.upload}.
	 */
	export interface PluginAttachmentUploadInput {
		/** Raw bytes, or a base64-encoded payload with no data: prefix. */
		data: Uint8Array | string

		/** MIME type, e.g. 'image/png', 'image/jpeg', or 'image/webp'. */
		mimeType: string
	}

	/**
	 * An attachment uploaded to the Amp server.
	 */
	export interface PluginAttachment {
		/** HTTPS URL that serves the uploaded bytes. */
		url: string
	}

	/**
	 * Attachment upload capability provided to plugins.
	 */
	export interface PluginAttachments {
		/**
		 * Upload bytes to the Amp server as an attachment and get back a URL.
		 *
		 * The returned URL can be used in a `{ type: 'image', mimeType, url }` tool result
		 * block, which keeps large image payloads (e.g. screenshots) out of thread state.
		 * The upload is subject to the Amp server's attachment media-type and size policy,
		 * and the resulting URL is fetchable by Amp's inference providers. Image uploads are
		 * additionally validated against Amp's inference image limits before uploading:
		 * at most 4.9 MB decoded and at most 8000px per dimension.
		 *
		 * Throws if the upload fails (e.g. offline, unauthorized, payload rejected by the
		 * server's policy, or an image exceeding the inference image limits). Callers
		 * returning tool results should catch errors and fall back to an inline base64
		 * image block.
		 *
		 * @example
		 * ```ts
		 * const png: Uint8Array = await captureScreenshot()
		 * try {
		 *   const { url } = await amp.attachments.upload({ data: png, mimeType: 'image/png' })
		 *   return [{ type: 'image', mimeType: 'image/png', url }]
		 * } catch {
		 *   return [{ type: 'image', mimeType: 'image/png', data: Buffer.from(png).toString('base64') }]
		 * }
		 * ```
		 */
		upload(input: PluginAttachmentUploadInput): Promise<PluginAttachment>
	}

	/**
	 * Observer interface for subscribing to configuration changes.
	 */
	export interface PluginConfigurationObserver<T> {
		next?(value: T): void

		error?(error: unknown): void

		complete?(): void
	}

	/**
	 * Subscription that can be unsubscribed to release resources.
	 */
	export interface Subscription {
		unsubscribe(): void
	}

	/**
	 * Target for configuration updates.
	 */
	export type PluginConfigurationTarget = 'workspace' | 'global'

	/**
	 * Minimal Observable interface used by plugin APIs that stream values over time.
	 *
	 * Subscribers receive subsequent values until they unsubscribe.
	 */
	export interface Observable<T> {
		/**
		 * Subscribe to values emitted by this observable.
		 */
		subscribe(observer: PluginConfigurationObserver<T>): Subscription
		subscribe(onNext: (value: T) => void): Subscription

		/**
		 * Pipe operators for transforming this observable.
		 */
		pipe<Out>(op: (input: Observable<T>) => Out): Out

		/**
		 * Return this observable for interop with observable libraries.
		 */
		[Symbol.observable](): Observable<T>
	}

	/**
	 * Observable-like interface for Amp configuration.
	 * Provides a limited subset of Observable functionality for plugins.
	 */
	export interface PluginConfiguration<T> extends Observable<T> {
		/**
		 * Get the current configuration.
		 */
		get(): Promise<T>

		/**
		 * Update configuration with partial values.
		 * @param partial - The partial configuration to merge
		 * @param target - Where to store the setting: 'global' (user settings) or 'workspace' (default)
		 */
		update(partial: Partial<T>, target?: PluginConfigurationTarget): Promise<void>

		/**
		 * Delete a configuration key.
		 * @param key - The key to delete
		 * @param target - Where to delete from: 'global' (user settings) or 'workspace' (default)
		 */
		delete(key: keyof T, target?: PluginConfigurationTarget): Promise<void>
	}

	/**
	 * Logger provided to plugins for scoped logging.
	 */
	export interface PluginLogger {
		log: (...args: unknown[]) => void
	}

	/**
	 * Tagged-template shell command runner. It resolves with `exitCode`, `stdout`, and `stderr`,
	 * including when the command exits non-zero. Inspect `exitCode` to detect failure. This API does
	 * not provide Bun shell chaining methods such as `.nothrow()` or `.quiet()`.
	 */
	export type ShellFunction = (
		strings: TemplateStringsArray,
		...values: unknown[]
	) => Promise<ShellResult>

	/**
	 * Result from a shell command execution.
	 */
	export interface ShellResult {
		exitCode: number
		stdout: string
		stderr: string
	}

	/**
	 * Where plugin code is running relative to the interactive UI.
	 */
	export type PluginExecutorKind = 'local' | 'remote' | 'unknown'

	/**
	 * Information about the executor running plugin code.
	 */
	export interface PluginExecutor {
		readonly kind: PluginExecutorKind

		/**
		 * Keep the current orb awake until the returned subscription is unsubscribed or the plugin
		 * process exits. The lease renews automatically and consumes orb runtime credits.
		 *
		 * Rejects when the plugin is not running inside an Amp-managed orb. This is a best-effort
		 * lease: manual pauses, insufficient credits, and provider runtime limits may still pause the
		 * orb.
		 */
		keepAlive(): Promise<Subscription>
	}

	/**
	 * Identity of the authenticated Amp user exposed to plugins.
	 */
	export interface User {
		/**
		 * Opaque string that identifies the user.
		 */
		readonly id: string

		/** User's email address. */
		readonly email: string

		/** User's first name, when set. */
		readonly firstName: string | null

		/** User's last name, when set. */
		readonly lastName: string | null

		/** User's Amp username, when set. */
		readonly username: string | null

		/** Workspace the user belongs to, or null when the user is not in a workspace. */
		readonly workspace: Workspace | null
	}

	/**
	 * Workspace identity for the authenticated user.
	 */
	export interface Workspace {
		/** Opaque string that identifies the workspace. */
		readonly id: string

		/** Workspace slug/name. */
		readonly name: string

		/** Human-friendly workspace display name, when set. */
		readonly displayName: string | null
	}

	/**
	 * System capabilities and information provided to plugins.
	 */
	export interface PluginSystem {
		/**
		 * Open a URL using the system's default protocol handler.
		 * On the CLI, it also shows a dialog with the URL text (for SSH users who can't open URLs remotely).
		 */
		open(url: string | URL): Promise<void>

		/**
		 * Root of the workspace or repository the user has open, or null when Amp is
		 * running without a workspace. This is stable for the plugin process lifetime;
		 * plugins are reloaded when the workspace changes.
		 *
		 * Use {@link PluginAPI.helpers.filePathFromURI} to convert this file URI to a
		 * local filesystem path before running workspace-relative shell commands.
		 */
		readonly workspaceRoot: URI | null

		/**
		 * Get the effective Amp base URL currently used by this Amp client.
		 * This reflects the active runtime configuration (for example, custom domains via `AMP_URL`).
		 */
		readonly ampURL: URL

		/**
		 * Identity of the authenticated Amp user, or null when Amp is not authenticated.
		 */
		readonly user: User | null

		/**
		 * Information about the executor that is running this plugin.
		 */
		readonly executor: PluginExecutor
	}

	/** @internal */
	export type SpanID = string & { readonly __brand: 'SpanID' }

	export type ThreadID = `T-${string}`

	/**
	 * Message IDs are numeric in legacy TUI threads and stable string IDs in Neo
	 * thread-actor threads.
	 */
	export type ThreadMessageID = number | string

	/**
	 * A text content block in a message.
	 */
	export interface ThreadTextBlock {
		type: 'text'
		text: string
	}

	/**
	 * A thinking content block in a message.
	 */
	export interface ThreadThinkingBlock {
		type: 'thinking'
		thinking: string
	}

	/**
	 * A tool use content block in a message.
	 */
	export interface ThreadToolUseBlock {
		type: 'tool_use'
		id: string
		name: string
		input: Record<string, unknown>
	}

	/**
	 * A tool result content block in a message.
	 */
	export interface ThreadToolResultBlock {
		type: 'tool_result'
		toolUseID: string
		output?: PluginToolResult
		status: 'done' | 'error' | 'cancelled' | 'running' | 'pending'
	}

	/**
	 * A user message in the thread.
	 */
	export interface ThreadUserMessage {
		role: 'user'

		/** The message ID, which is unique in the thread. */
		id: ThreadMessageID

		content: (ThreadTextBlock | ThreadToolResultBlock)[]
	}

	/**
	 * An assistant message in the thread.
	 */
	export interface ThreadAssistantMessage {
		role: 'assistant'

		/** The message ID, which is unique in the thread. */
		id: ThreadMessageID

		content: (ThreadTextBlock | ThreadThinkingBlock | ThreadToolUseBlock)[]
	}

	/**
	 * An info message in the thread.
	 */
	export interface ThreadInfoMessage {
		role: 'info'

		/** The message ID, which is unique in the thread. */
		id: ThreadMessageID

		content: ThreadTextBlock[]
	}

	/**
	 * A message in the thread (simplified view for plugins).
	 */
	export type ThreadMessage = ThreadUserMessage | ThreadAssistantMessage | ThreadInfoMessage

	/**
	 * Options for reading messages from a thread.
	 */
	export interface ThreadMessagesOptions {
		/**
		 * When true, read the full transcript, including messages that have been
		 * compacted away.
		 *
		 * By default, messages are read as a new inference turn would see them:
		 * when the thread has been compacted, the latest compaction summary
		 * (as a user message) followed by the messages after the compaction cut
		 * point; otherwise the full transcript.
		 */
		full?: boolean

		/**
		 * Where to read from. Defaults to `end` so callers read recent messages by
		 * default instead of accidentally loading the start of a large thread.
		 */
		from?: 'start' | 'end'

		/**
		 * What the offset is in relation to `from`.  Defaults to 0.
		 */
		offset?: number

		/**
		 * Maximum number of messages to return. Clamped to 20.
		 */
		limit?: number

		/**
		 * Optional role filter.
		 */
		roles?: Array<'user' | 'assistant'>
	}

	/**
	 * Agent activity state of a thread.
	 *
	 * - `idle`: the agent is not working; the last turn (if any) has finished.
	 * - `running`: the agent is working (inference or tool execution in progress).
	 * - `awaiting-approval`: the agent is blocked waiting for a tool approval.
	 * - `error`: the turn stopped with an error that Amp will not retry on its own. A failed
	 *   inference turn with an automatic retry pending is reported as `running`.
	 */
	export type ThreadState = 'idle' | 'running' | 'awaiting-approval' | 'error'

	/**
	 * Thread API for reading and manipulating the current thread.
	 */
	export interface PluginThread {
		/** Active thread ID for the current invocation context */
		id: ThreadID

		/** Agent currently used by this thread, suitable for creating related threads. */
		agent(): Promise<Agent>

		/**
		 * ID of this thread's direct parent thread, or `null` when it has none.
		 * The parent is recorded when a thread is created with a `parentThreadID`
		 * (for example a subagent or child thread) and can become `null` later if
		 * the parent thread is deleted. Only supported for the plugin's current
		 * thread.
		 */
		parentThreadID(): Promise<ThreadID | null>

		/** Current thread title stream, or `null` when no title has been set yet. */
		readonly title: Observable<string | null> & { get(): Promise<string | null> }

		/** Agent activity state stream for this thread. */
		readonly state: Observable<ThreadState> & { get(): Promise<ThreadState> }

		/**
		 * Wait for the current or next agent turn to finish and resolve with the
		 * assistant's reply.
		 *
		 * Waits until the thread has been `running` (or `awaiting-approval`) and
		 * returns to `idle`, then resolves with the last assistant message.
		 * Rejects if the thread enters the `error` state or the timeout elapses
		 * (default 10 minutes).
		 */
		waitForResponse(options?: { timeoutMs?: number }): Promise<ThreadAssistantMessage>

		/**
		 * Stop the agent's current turn. During agent.start, prevents the turn from starting.
		 */
		cancel(): Promise<void>

		/**
		 * Make this thread private or visible to every member of its workspace.
		 * Making a thread private disables multiplayer. The authenticated user must
		 * own the thread.
		 */
		setVisibility(visibility: 'private' | 'workspace'): Promise<void>

		/**
		 * Enable multiplayer for the given number of seconds, or disable it with `null`.
		 * Enabling multiplayer requires an Orb or shared runner thread that is already shared. Valid
		 * durations range from 5 minutes to 7 days.
		 */
		setMultiplayer(options: { ttlSeconds: number | null }): Promise<void>

		/**
		 * Read the thread's labels, sorted alphabetically.
		 */
		labels(): Promise<string[]>

		/**
		 * Replace the thread's labels and resolve with the resulting labels.
		 *
		 * Labels are lowercased and deduplicated. Each label must be alphanumeric
		 * with hyphens, start with an alphanumeric character, and be at most 32
		 * characters long. A thread holds at most 20 labels. The authenticated user
		 * must be allowed to manage the thread.
		 */
		setLabels(labels: string[]): Promise<string[]>

		/**
		 * Add labels to the thread, keeping its existing labels, and resolve with
		 * the resulting labels. Same label rules as {@link setLabels}.
		 */
		addLabels(labels: string[]): Promise<string[]>

		/**
		 * Read messages from the thread in a stable plugin-facing schema.
		 *
		 * By default this reads the messages a new inference turn would see:
		 * after a compaction, the latest compaction summary and the messages
		 * from the compaction cut point onward. Pass `full: true` to read the
		 * entire transcript, including compacted-away messages.
		 *
		 * Defaults to `{ from: 'end', limit: 10 }`. The maximum `limit`
		 * is 20.  Combine with `offset` to fetch more messages.
		 */
		messages(options?: ThreadMessagesOptions): Promise<ThreadMessage[]>

		/**
		 * Append a user message to the thread.
		 */
		append(messages: UserMessage[]): Promise<void>

		/**
		 * Append a single user message to the thread.
		 *
		 * When `steer` is true and the thread is busy, the message is queued as a
		 * steering message and is preferred when the thread next dequeues work.
		 */
		appendUserMessage(message: UserMessage, options?: AppendUserMessageOptions): Promise<void>
	}

	/** APIs for accessing threads by ID. */
	export interface PluginThreads {
		/** Get a thread handle for the given thread ID. */
		get(threadID: ThreadID): PluginThread
	}

	/**
	 * A user message that can be appended to the thread.
	 */
	export interface UserMessage {
		type: 'user-message'

		content: string
	}

	/** Options for appending a single user message to a thread. */
	export interface AppendUserMessageOptions {
		/**
		 * Prefer this message when it is queued behind in-progress work.
		 */
		steer?: boolean
	}

	/**
	 * Options shared by the dialogs that wait for an answer (`ui.input`, `ui.confirm`, and
	 * `ui.select`).
	 */
	export interface PluginDialogOptions {
		/**
		 * Require a human response rather than an agent response. The thread owner can answer these
		 * dialogs. While multiplayer is active, human contributors can also answer interactive
		 * selections, confirmations, and non-secret inputs, including dialogs with `requireHuman: true`.
		 * Secret inputs (`secret: true`) and confirmations with a secret field remain owner-only and
		 * always require a human. Dialogs targeted
		 * to a specific connection are not shared with contributors.
		 *
		 * Use this for approval and permission prompts. It does not grant agents access to dialogs
		 * or enable them to answer on the owner's behalf.
		 */
		requireHuman?: boolean

		/**
		 * Do not show the dialog when nobody who can answer it has the thread open, for example in
		 * a scheduled or Slack-started thread nobody is watching. The dialog then resolves at once
		 * as dismissed (`undefined`) instead of waiting and marking the thread as needing action.
		 * Use this for prompts that are useful only while someone is watching. In the terminal
		 * app the user is always present, so the dialog is always shown.
		 */
		skipIfUnwatched?: boolean
	}

	/**
	 * Options for the input dialog.
	 */
	export interface PluginInputOptions extends PluginDialogOptions {
		/** Dialog title */
		title?: string

		/** Help text/description shown below the title */
		helpText?: string

		/** Initial text value in the input field */
		initialValue?: string

		/** Text for the submit button (default: "Submit") */
		submitButtonText?: string

		/** Placeholder shown in the empty input field */
		placeholder?: string

		/**
		 * Treat the entered text as a secret such as an API key or password. Clients present the
		 * text as sensitive (the TUI masks it; the web dialog lets the user hide it), and the value
		 * is returned only to the requester: it is never echoed in settled request state, thread
		 * history, or the model's transcript.
		 */
		secret?: boolean

		/**
		 * Stable machine-readable name for what the input holds, such as an environment variable
		 * or API key name (`OPENAI_API_KEY`). The dialog uses it as the input's `name`, `id`,
		 * `placeholder`, and `data-secret-name`, which password managers such as 1Password and
		 * Bitwarden read to recognize the field and label the saved item.
		 */
		fieldName?: string
	}

	/**
	 * Options for the confirm dialog.
	 */
	export interface PluginConfirmOptions extends PluginDialogOptions {
		/** Dialog title */
		title: string

		/** Markdown message body shown below the title */
		message?: string

		/** Text for the confirm button (default: "Yes") */
		confirmButtonText?: string
	}

	/** A field shown in a confirmation dialog. */
	export interface PluginConfirmField {
		/**
		 * How to show the field. Text fields are editable. Image fields show a read-only preview
		 * of an HTTP(S) image URL. Link fields show a button that opens an HTTP(S) URL in the
		 * browser, for example an approval page in another app; the dialog stays open so the user
		 * can still confirm or cancel afterwards. Image and link fields are omitted from the
		 * returned values. Defaults to `text`.
		 *
		 * When a link field comes before a text field, clients show the fields as numbered steps:
		 * for example "open the sign-in page", then "paste the URL it ends on".
		 */
		type?: 'text' | 'image' | 'link'

		/** Stable key used in the returned record */
		name: string

		/** Label shown above a text or image field, or the button text of a link field */
		label: string

		/** Initial text value or, for an image or link field, an HTTP(S) URL */
		value: string

		/** Allow a text field to span multiple lines */
		multiline?: boolean

		/** Allow a text field to be left empty. Text fields are required unless this is set. */
		optional?: boolean

		/** Placeholder shown in an empty text field */
		placeholder?: string

		/**
		 * Treat a text field's value as a secret, as `secret` does for `ui.input`: clients let the
		 * user hide it, only the thread owner can answer the dialog, and the answer is returned only
		 * to the requester. A secret field is single-line.
		 */
		secret?: boolean
	}

	/** Options for a confirmation dialog that returns edited field values. */
	export interface PluginEditableConfirmOptions extends PluginConfirmOptions {
		fields: PluginConfirmField[]
	}

	/**
	 * Options for the select dialog.
	 */
	export interface PluginSelectOptions extends PluginDialogOptions {
		/** Dialog title */
		title: string

		/**
		 * Append a final inline text field with "Other" as its placeholder.
		 * A non-empty entered value is trimmed and returned like any other selected value.
		 */
		allowOther?: boolean

		/** Markdown message body shown below the title */
		message?: string

		/** Initially selected option value */
		initialValue?: string

		/** Entries to display as choices */
		options: string[]
	}

	/**
	 * UI capabilities provided to plugins.
	 */
	export interface PluginUI {
		notify(message: string): Promise<void>

		/**
		 * Show an input dialog prompting the user for text input.
		 * @returns The entered text, or undefined if the user cancelled.
		 */
		input(options: PluginInputOptions): Promise<string | undefined>

		/**
		 * Show editable text fields, read-only image previews, and link buttons in a confirmation
		 * dialog.
		 * @returns The edited text values by field name, or undefined if cancelled. Image and link
		 * fields are omitted.
		 */
		confirm(options: PluginEditableConfirmOptions): Promise<Record<string, string> | undefined>
		/**
		 * Show a confirmation dialog with Yes/No options.
		 * @returns true if the user confirmed, false if they cancelled.
		 */
		confirm(options: PluginConfirmOptions): Promise<boolean>

		/**
		 * Show a select dialog with user-provided options and, when enabled, a final
		 * inline text field for another value.
		 * @returns The selected or entered value, or undefined if the user cancelled.
		 */
		select(options: PluginSelectOptions): Promise<string | undefined>
	}

	/**
	 * URI value returned by helper APIs.
	 *
	 * This stays intentionally minimal so external plugin authors don't need
	 * Amp's internal URI package in their dependency graph.
	 */
	export interface URI {
		toString(): string
	}

	/**
	 * Event payload for session.start event.
	 * Fired when Amp starts a thread session, such as when the user sends the first
	 * message in a new thread or opens/switches to an existing thread.
	 */
	export interface SessionStartEvent {
		/** The thread that started running */
		thread: { id: ThreadID }
	}

	/**
	 * A tool call.
	 */
	export interface ToolCall {
		/** Unique identifier for this tool use (e.g., "toolu_xxx") */
		toolUseID: string

		/** Name of the tool that will be executed */
		tool: string

		/** Input arguments that will be passed to the tool */
		input: Record<string, unknown>
	}

	/**
	 * Event payload for tool.call event.
	 * This is a request that expects a response from the handler.
	 */
	export interface ToolCallEvent extends ToolCall {
		/** The active thread reference for this tool invocation. */
		thread: { id: ThreadID }
	}

	/**
	 * Result returned from a tool.call handler.
	 * Determines how the tool execution should proceed.
	 */
	export type ToolCallResult =
		/** Allow the tool to execute with its original input */
		| { action: 'allow' }

		/** Reject the tool call but allow the agent to continue with other tools */
		| { action: 'reject-and-continue'; message: string }

		/** Modify the tool's input arguments before execution */
		| { action: 'modify'; input: Record<string, unknown> }

		/** Provide a synthesized result without actually running the tool */
		| { action: 'synthesize'; result: { output: string; exitCode?: number } }

		/** Error occurred in the plugin - stops the thread worker and shows an ephemeral error */
		| { action: 'error'; message: string }

	/**
	 * A terminal tool result.
	 */
	export interface ToolResult {
		/** Unique identifier for this tool use (e.g., "toolu_xxx") */
		toolUseID: string

		/** Name of the tool that was executed */
		tool: string

		/** Input arguments passed to the tool */
		input: Record<string, unknown>

		/** Result status of the tool execution */
		status: 'done' | 'error' | 'cancelled'

		/** Error message if status is 'error' */
		error?: string

		/** Tool output/result if available */
		output?: unknown
	}

	/**
	 * A structured content block returned from a plugin tool.
	 */
	export type PluginToolResultContentBlock =
		| { type: 'text'; text: string }
		| {
				type: 'image'

				/** MIME type, e.g. 'image/png', 'image/jpeg', or 'image/webp'. */
				mimeType: string

				/** Base64-encoded payload with no data: prefix. */
				data: string
		  }
		| {
				type: 'image'

				/** MIME type, e.g. 'image/png', 'image/jpeg', or 'image/webp'. */
				mimeType: string

				/**
				 * HTTPS URL of the image, typically obtained from {@link PluginAttachments.upload}.
				 * The URL must be fetchable by Amp's inference providers and web/CLI clients.
				 * Using a URL keeps large image payloads out of thread state.
				 */
				url: string
		  }

	/**
	 * Result returned from a plugin tool.
	 *
	 * Returning a bare string keeps the existing text-only behavior. Returning an array
	 * of content blocks lets a tool mix text and image blocks. Image blocks carry either
	 * an inline base64 payload (`data`) or a URL (`url`), never both. Prefer uploading
	 * large images with {@link PluginAttachments.upload} and returning a URL block, and
	 * fall back to an inline base64 block if the upload fails.
	 */
	export type PluginToolResult = string | PluginToolResultContentBlock[]

	/**
	 * Event payload for tool.result event.
	 */
	export interface ToolResultEvent extends ToolResult {
		/** The active thread for this tool result */
		thread: { id: ThreadID }
	}

	/**
	 * Result returned from a tool.result handler.
	 * Allows modifying the tool result before it is sent back to the model.
	 */
	export type ToolResultResult =
		| {
				status: 'done'
				output?: unknown
		  }
		| {
				status: 'error'
				error?: string
				output?: unknown
		  }
		| {
				status: 'cancelled'
				error?: string
				output?: unknown
		  }
		| undefined
		| void

	/**
	 * Event payload for agent.start event.
	 * Fired when a user submits a prompt (initial or reply).
	 */
	export interface AgentStartEvent {
		/** The active thread for this agent turn */
		thread: { id: ThreadID }

		/** The user's prompt message */
		message: string

		/** The message ID */
		id: ThreadMessageID

		/**
		 * Set when a client's canned changes workflow started this turn: `ship` for the Ship
		 * button and `push_branch` for Push to Branch. Absent for prompts the user typed.
		 * Use it to append workflow-specific instructions (for example, issue-tracker follow-up
		 * after shipping) instead of matching on the prompt text.
		 */
		changesWorkflow?: 'ship' | 'push_branch'
	}

	/**
	 * Result returned from an agent.start handler.
	 * Allows adding context messages or modifying the system prompt.
	 */
	export interface AgentStartResult {
		/**
		 * A message to append after the user's content in the user message.
		 * If display is true, the message is shown in the UI. Defaults to false.
		 */
		message?: { content: string; display?: boolean }
	}

	/**
	 * Event payload for agent.end event.
	 * Fired when the agent finishes handling a user prompt.
	 */
	export interface AgentEndEvent {
		/** The active thread for this agent turn */
		thread: { id: ThreadID }

		/** The user's prompt message that started this turn */
		message: string

		/** The message ID that started this turn */
		id: ThreadMessageID

		/** The outcome of the agent's turn */
		status: 'done' | 'error' | 'cancelled'

		/** All messages since the agent.start event (including the user message that started this turn) */
		messages: ThreadMessage[]
	}

	/**
	 * Result returned from an agent.end handler.
	 * Allows starting a new agent turn by returning a user message.
	 */
	export type AgentEndResult = {
		/** Automatically send a follow-up user message to start a new agent turn */
		action: 'continue'
		userMessage: string
		/**
		 * How many plugin `continue` turns may run in a row after the last user-sent
		 * message. Amp ignores `continue` once this many consecutive plugin continuations
		 * have already happened. Defaults to 5. Any message the user sends resets the count.
		 * Raise it deliberately, for example in a plugin that drives long-running work
		 * toward a goal, and keep your own stop condition.
		 */
		maxContinuations?: number
	} | void

	/**
	 * Event payload for changes.prompt event.
	 * Fired when a client prepares the prompt behind its Ship or Push to Branch button, before
	 * the user sees it. The Ship dialog shows the assembled prompt, so the user can edit anything a
	 * plugin adds before sending.
	 */
	export interface ChangesPromptEvent {
		/** The thread whose changes are about to be shipped or pushed */
		thread: { id: ThreadID }

		/** `ship` for the Ship button, `push_branch` for Push to Branch */
		workflow: 'ship' | 'push_branch'
	}

	/**
	 * Result returned from a changes.prompt handler.
	 * Return `append` to add instructions after the prompt, such as issue-tracker follow-up steps
	 * for the shipped commits. Every plugin's `append` is added, in plugin load order.
	 */
	export type ChangesPromptResult = { append?: string } | void

	/**
	 * A text pattern that Amp turns into a link in thread transcripts.
	 * See {@link PluginAPI.registerLinkPattern}.
	 */
	export interface PluginLinkPatternDefinition {
		/** Stable identifier within this plugin, such as `issue`. Letters, digits, and hyphens; up to 64 characters. */
		id: string

		/**
		 * Regular expression source that matches one token, such as `ENG-\d{1,6}`, written
		 * without anchors, flags, or delimiters. Amp compiles it with the `u` flag, requires a
		 * token boundary on both sides, and limits it to 200 characters. Backreferences and
		 * lookbehind are rejected, as is a pattern that matches the empty string. Named capture
		 * groups can be used in `href`.
		 */
		pattern: string

		/**
		 * URL template for the link. `{{match}}` is replaced with the whole match and
		 * `{{name}}` with the named capture group `name`, both URL-encoded. The result must be an
		 * `http:` or `https:` URL, or an absolute path on Amp such as `/admin/bug-reports/{{match}}`.
		 */
		href: string
	}

	/**
	 * Map of event names to their payload types.
	 */
	export interface PluginEventMap {
		'session.start': SessionStartEvent
		'tool.call': ToolCallEvent
		'tool.result': ToolResultEvent
		'agent.start': AgentStartEvent
		'agent.end': AgentEndEvent
		'changes.prompt': ChangesPromptEvent
	}

	/**
	 * Map of request event names to their result types.
	 * These events expect a response from the handler.
	 */
	export interface PluginRequestResultMap {
		'tool.call': ToolCallResult
		'tool.result': ToolResultResult
		'agent.start': AgentStartResult
		'agent.end': AgentEndResult
		'changes.prompt': ChangesPromptResult
	}

	/**
	 * Context shared by all plugin event handlers.
	 */
	export interface PluginEventContextBase {
		/** Scoped logger for plugin output. Log messages are appended to the handler's trace span events. */
		logger: PluginLogger

		/** Tagged-template shell command runner. See {@link ShellFunction}. */
		$: ShellFunction

		/** Platform UI capabilities */
		ui: PluginUI

		/** AI capabilities */
		ai: PluginAI

		/** System capabilities and information */
		system: PluginSystem

		/** The trace span ID for this handler invocation, if tracing is enabled */
		span?: SpanID
	}

	/**
	 * Context passed as the second argument to event handlers.
	 * All plugin events are thread-scoped.
	 */
	export type PluginEventContext<E extends keyof PluginEventMap> = PluginEventContextBase & {
		thread: PluginThread
	}

	/**
	 * Handler return type based on whether the event expects a response.
	 * Request events (in PluginRequestResultMap) must return a result.
	 * Fire-and-forget events return void.
	 */
	export type PluginHandlerResult<E extends keyof PluginEventMap> =
		E extends keyof PluginRequestResultMap
			? PluginRequestResultMap[E] | Promise<PluginRequestResultMap[E]>
			: void | Promise<void>

	/**
	 * Standardized shell command representation.
	 */
	export interface ShellCommand {
		command: string
		dir?: string
	}

	/**
	 * A tool call and its corresponding terminal tool result extracted from thread messages.
	 */
	export interface ToolCallWithResult {
		call: ToolCall
		result: ToolResult
	}

	/**
	 * Extracts the shell command from a Bash or shell_command tool call.
	 * Returns null if the event is not a shell command tool call.
	 */
	export type ShellCommandFromToolCall = (event: ToolCall) => ShellCommand | null

	/**
	 * Extracts paired tool calls and terminal tool results from a list of thread messages.
	 */
	export type ToolCallsInMessages = (messages: ThreadMessage[]) => ToolCallWithResult[]

	/**
	 * Returns an array of file URIs modified by a tool call, or null if the tool doesn't modify files.
	 * Supports edit/create/apply_patch tools and sed in-place shell commands.
	 */
	export type FilesModifiedByToolCall = (event: ToolCall | ToolResult) => URI[] | null

	/**
	 * Converts a file URI returned by helper APIs to a local filesystem path.
	 */
	export type FilePathFromURI = (uri: URI) => string

	/**
	 * Determines whether an instance of Error indicates that no Plugin UI is available.
	 */
	export type IsPluginUINotAvailableError = (error: Error) => boolean

	/**
	 * Whether a registered command is selectable in the command palette.
	 *
	 * - `enabled`: shown and selectable.
	 * - `disabled`: shown but not selectable; `reason` is displayed alongside the command.
	 * - `hidden`: not shown in the palette at all.
	 */
	export type CommandAvailability =
		| { type: 'enabled' }
		| { type: 'disabled'; reason: string }
		| { type: 'hidden' }

	/**
	 * Options for registering a command.
	 */
	export interface PluginCommandOptions {
		/** The title shown after the colon in the command palette (e.g., "Greet" in "Hello: Greet") */
		title: string

		/** The category shown before the colon (e.g., "Hello" in "Hello: Greet"). Defaults to the plugin name. */
		category?: string

		/** Human-readable description of what this command does */
		description?: string

		/**
		 * Initial availability of the command in the command palette.
		 * Defaults to `{ type: 'enabled' }`.
		 *
		 * Use the {@link CommandSubscription.setAvailability} method on the
		 * subscription returned by {@link PluginAPI.registerCommand} to update
		 * availability dynamically.
		 */
		availability?: CommandAvailability
	}

	/**
	 * Subscription returned by {@link PluginAPI.registerCommand}.
	 *
	 * Allows updating the command's availability in the palette in addition to
	 * unregistering it.
	 */
	export interface CommandSubscription extends Subscription {
		/**
		 * Update whether this command is selectable in the command palette.
		 * Triggers a refresh in the host so the palette reflects the new state
		 * on its next read.
		 */
		setAvailability(status: CommandAvailability): void
	}

	/**
	 * Context passed to command handlers.
	 * Provides access to UI capabilities for executing command actions.
	 */
	export interface PluginCommandContext {
		/** Platform UI capabilities */
		ui: PluginUI

		/** AI capabilities */
		ai: PluginAI

		/** System capabilities and information */
		system: PluginSystem

		/** Tagged-template shell command runner. See {@link ShellFunction}. */
		$: ShellFunction

		/**
		 * Current thread context if a thread is active, or `undefined` when the
		 * user has not started one yet. To create a thread from a command, use
		 * `amp.getBuiltinAgent(...)` or `amp.createAgent(...)` and call
		 * `agent.createThread({ show: true })`, then append to the returned thread.
		 */
		thread?: PluginThread
	}

	/**
	 * Context passed to tool execute handlers.
	 */
	export interface PluginToolContext {
		/** UI capabilities provided to plugins */
		ui: PluginUI

		/** Scoped logger for plugin output */
		logger: PluginLogger

		/** Current thread context for this tool invocation */
		thread: PluginThread
	}

	/** A provider-neutral webhook event delivered to a plugin handler. */
	export interface WebhookEvent {
		/** Stable server-owned event ID. Use this to make handler effects idempotent. */
		id: string

		/** Exact bytes received in the HTTP request body. */
		body: Uint8Array

		/** Requested HTTP headers, with lowercase names. */
		headers: Readonly<Record<string, string>>

		/** @deprecated Use `body` instead. Internal JSON-compatible transport payload. */
		payload: unknown

		/** @deprecated Transport metadata retained for compatibility. */
		metadata: Readonly<Record<string, string>>

		/** ISO 8601 timestamp recorded when the server accepted the webhook. */
		receivedAt: string
	}

	/** Context passed to webhook handlers for the owning thread. */
	export interface WebhookHandlerContext extends PluginEventContextBase {
		/** Thread that owns this webhook registration. */
		thread: PluginThread

		/** Aborted when the handler's execution deadline elapses. */
		signal: AbortSignal
	}

	/** Options for registering a generic webhook handler. */
	export interface CreateWebhookOptions {
		/** Stable, non-whitespace-padded key within this plugin's scope (1-128 characters). */
		key: string

		/**
		 * HTTP headers to preserve. Names are case-insensitive, and delivered names are lowercase.
		 * Defaults to an empty list; no request headers are preserved implicitly.
		 */
		headers?: readonly string[]

		/** At-least-once handler for matching durable webhook events. */
		handler: (event: WebhookEvent, ctx: WebhookHandlerContext) => void | Promise<void>
	}

	/** Safe registration information returned to the plugin. */
	export interface WebhookRegistration {
		/**
		 * Capability URL for webhook POST requests. Treat this URL as a credential. Each webhook
		 * accepts a burst of 10 new events and refills at 10 events per minute. A rate-limited
		 * request returns HTTP 429 with a `Retry-After` header; a retry matching an event still
		 * pending delivery by `Idempotency-Key` does not consume rate capacity.
		 */
		url: string
	}

	/**
	 * Options for registering a tool that the agent can call.
	 */
	export interface PluginToolDefinition {
		/** Tool name (must match ^[a-zA-Z0-9_-]+$) */
		name: string

		/**
		 * Human-readable display title shown in Amp clients instead of the raw
		 * tool name, e.g. `Tap screen` instead of `sim_tap`. Not sent to the LLM.
		 */
		title?: string

		/**
		 * Labels used to group adjacent tool calls into one action-oriented transcript row.
		 * Calls with matching labels are shown together. `active` is shown while any call is
		 * running, then `complete` is shown. Not sent to the LLM.
		 *
		 * @example
		 * transcriptGroup: { active: 'Inspecting simulator', complete: 'Inspected simulator' }
		 */
		transcriptGroup?: {
			active: string
			complete: string
		}

		/** Description shown to the LLM explaining what the tool does */
		description: string

		/** JSON Schema for the tool's input parameters */
		inputSchema: {
			type: 'object'
			properties?: Record<string, object>
			required?: string[]
			[key: string]: unknown
		}

		/**
		 * Execute the tool with the given input and return a result.
		 *
		 * Returning nothing is allowed and is shown to the model as `(no tool output)`. Throw an
		 * error to report a failure; the model then sees a tool error instead of a successful
		 * empty result.
		 */
		execute: (
			input: Record<string, unknown>,
			ctx: PluginToolContext,
		) => Promise<PluginToolResult | void>
	}

	/**
	 * An Agent Skill directory contributed by a plugin.
	 */
	export interface PluginSkillDefinition {
		/** Path to the skill directory, relative to the directory plugin's root. */
		path: string
	}

	/**
	 * Config for a declarative agent, the argument to {@link defineAgent} in an agent directory's
	 * `agent.ts`. Amp parses this object statically, so it must be a plain object literal of
	 * string, number, boolean, array, and object literals — no imports, variables, or computed
	 * values. The file is required in every agent directory, but every config field is optional;
	 * `defineAgent({})` is a complete config.
	 */
	export interface AgentConfig {
		/** Label shown in mode pickers and thread headers, 24 characters or less. Defaults to the agent's directory name. */
		label?: string
		/**
		 * Description shown in agent listings, 500 characters or less. State both what the agent
		 * does and when to use it.
		 */
		description?: string
		/** Label color as a hex RGB string, for example "#d97706". */
		color?: string
		/**
		 * Built-in agent mode this agent extends. Threads render that mode's system prompt with
		 * the agent's `instructions.md` appended as agent instructions, and `tools` defaults to
		 * the mode's tool list. When `model` is omitted, the agent uses the mode's preferred
		 * model and reasoning effort. The agent is a separate mode: the user's Tune Modes pins
		 * for the built-in mode do not change its model.
		 */
		extends?: 'low' | 'medium' | 'high' | 'ultra'
		/**
		 * Model identifier in `provider/model` format, such as `anthropic/claude-sonnet-4-6`.
		 * Omit to use the default model, or the extended mode's model when `extends` is set.
		 */
		model?: PluginAIModel
		/** Run entirely on Amp's thread actor without creating or attaching an executor. */
		serverOnly?: boolean
		/**
		 * Marks a work-in-progress agent. Drafts are hidden from agent pickers but still start
		 * threads by key, so the author can try them. The agent builder sets this while an agent
		 * is being shaped and clears it when the author is done.
		 */
		draft?: boolean
		/**
		 * Built-in tools available to this agent: 'all' for all tools available in its runtime,
		 * a list of tool names with `*` suffix wildcards, or an object that adjusts the default
		 * list (`add` unions extra tools into it; `exclude` removes tools). Use `add` with
		 * `extends` to add tools on top of the built-in mode's tool list. `mcp__*` matches all
		 * MCP tools and `plugin__*` matches all plugin tools (also matched as
		 * `plugin__<pluginName>__<toolName>`). MCP servers are reached through `tool_search` and
		 * `code_exec`, which every agent gets unless `exclude` names them.
		 */
		tools?:
			| 'all'
			| readonly string[]
			| {
					include?: 'all' | readonly string[]
					add?: readonly string[]
					exclude?: readonly string[]
			  }
		/** Optional reasoning effort override for models that support it. */
		reasoningEffort?: AgentReasoningEffort
		/**
		 * Model and reasoning effort for the Oracle consulted from threads running this
		 * agent. Omitted fields keep Amp's automatic routing and default effort. An
		 * unavailable model falls back to Amp's routing at run time.
		 */
		oracle?: AgentSubagentPin
		/**
		 * Model and reasoning effort for the other subagents spawned from threads running
		 * this agent (Task workers, finder, thread reader, librarian). Omitted fields keep
		 * Amp's automatic routing and default effort. An unavailable model falls back to
		 * Amp's routing at run time.
		 */
		subagents?: AgentSubagentPin
		/** Features required on threads created from this agent. */
		features?: readonly AgentFeature[]
		/**
		 * IDs (slugs) of the remote MCP servers this agent works with, as shown in Settings →
		 * MCP Servers. They are named in the agent's rendered instructions so the model knows to
		 * reach them through code mode (`tool_search`/`code_exec`). They do not restrict which
		 * servers the thread can reach.
		 */
		mcpServers?: readonly string[]
	}

	/**
	 * Declare a declarative agent's config in its directory's `agent.ts`:
	 *
	 * ```ts
	 * import { defineAgent } from '@ampcode/plugin'
	 *
	 * export default defineAgent({
	 *   description: 'Researches requests and cites primary sources. Use for evidence-backed research.',
	 *   model: 'openai/gpt-5-mini',
	 *   tools: ['web_search', 'read_web_page'],
	 *   reasoningEffort: 'medium',
	 * })
	 * ```
	 *
	 * Returns the config unchanged; it exists for typing and static parsing.
	 */
	export function defineAgent(config: AgentConfig): AgentConfig

	/**
	 * A custom tool declared in an agent directory's `tools/<name>.ts` file, the argument to
	 * {@link defineTool}. The tool's name is the filename. The `description`, `execution`, and
	 * `inputSchema` fields must be static literals written directly in the file; only `execute`
	 * is real code, and it runs where `execution` places it.
	 */
	export interface AgentToolConfig {
		/** Description shown to the LLM explaining what the tool does */
		description?: string

		/**
		 * Where the tool executes. `executor` tools (the default) are dispatched to the attached
		 * executor at the repository checkout. `server` tools run this file in a small detached
		 * sandbox with no repository checkout, kept warm per thread. On `serverOnly` agents the
		 * default is `server` and `executor` is a validation error.
		 */
		execution?: 'server' | 'executor'

		/**
		 * JSON Schema for the tool's input parameters. Must be a JSON literal written directly
		 * in the `defineTool` call (it is statically extracted, never evaluated) and must
		 * describe an object (`type: 'object'`).
		 */
		inputSchema: PluginToolDefinition['inputSchema']

		/** Execute the tool with the given input and return a result */
		execute: PluginToolDefinition['execute']
	}

	/**
	 * Declare a custom tool in an agent directory's `tools/<name>.ts`:
	 *
	 * ```ts
	 * import { defineTool } from '@ampcode/plugin'
	 *
	 * export default defineTool({
	 *   description: 'Fetch open tickets',
	 *   execution: 'server',
	 *   inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
	 *   execute: async (input) => ({ content: [{ type: 'text', text: JSON.stringify(input) }] }),
	 * })
	 * ```
	 *
	 * Returns the tool unchanged; it exists for typing and static parsing.
	 */
	export function defineTool(tool: AgentToolConfig): AgentToolConfig
}
