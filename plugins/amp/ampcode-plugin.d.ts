declare module '@ampcode/plugin' {
	export interface ToolCallEvent {
		[key: string]: unknown
	}

	export interface ShellCommand {
		command: string
	}

	export type ToolCallResult =
		| { action: 'allow' }
		| { action: 'reject-and-continue'; message: string }

	export interface ToolCallContext {
		ui: {
			confirm(options: {
				title: string
				message: string
				confirmButtonText: string
			}): Promise<boolean>
		}
	}

	export interface PluginAPI {
		helpers: {
			shellCommandFromToolCall(event: ToolCallEvent): ShellCommand | null
		}
		on(
			event: 'tool.call',
			handler: (event: ToolCallEvent, ctx: ToolCallContext) => ToolCallResult | Promise<ToolCallResult>
		): void
	}
}
