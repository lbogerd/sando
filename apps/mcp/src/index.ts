#!/usr/bin/env node
import { pathToFileURL } from "node:url"

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"

import {
	compileEffectivePolicy,
	createHostedAgentAuthorityFromEnv,
	loadProjectPolicy,
	readRunArtifact,
	readRunDiff,
	readRunLogs,
	readRunResult,
	runProjectCommand,
	type RunProjectCommandOptions,
} from "@sando/runners"
import {
	defaultSandoPolicy,
	err,
	ok,
	runProjectCommandInputSchema,
	sandoError,
	type Result,
	type RunProjectCommandInput,
	type RunProjectCommandResult,
	type SandoError,
} from "@sando/shared"

export const appName = "sandhost-mcp"
export const appVersion = "0.0.0"

const runIdInputSchema = z.object({
	runId: z.string().min(1),
})

const downloadArtifactInputSchema = z.object({
	artifactId: z.string().min(1).optional(),
	runId: z.string().min(1).optional(),
	name: z.string().min(1).optional(),
})

export type SandhostMcpService = {
	runProjectCommand(input: RunProjectCommandInput): Promise<Result<RunProjectCommandResult>>
	listTemplates(): Promise<Result<Record<string, unknown>>>
	explainPolicy(): Promise<Result<Record<string, unknown>>>
	getRun(input: { readonly runId: string }): Promise<Result<Record<string, unknown>>>
	readLogs(input: { readonly runId: string }): Promise<Result<Record<string, unknown>>>
	getDiff(input: { readonly runId: string }): Promise<Result<Record<string, unknown>>>
	downloadArtifact(input: {
		readonly artifactId?: string
		readonly name?: string
		readonly runId?: string
	}): Promise<Result<Record<string, unknown>>>
}

export type CreateSandhostMcpServiceOptions = RunProjectCommandOptions

export function createSandhostMcpService(
	options: CreateSandhostMcpServiceOptions = {},
): SandhostMcpService {
	const runOptions: CreateSandhostMcpServiceOptions =
		options.authority === undefined
			? {
					...options,
					...optionalAuthority(createHostedAgentAuthorityFromEnv()),
				}
			: options

	return {
		async runProjectCommand(input) {
			return runProjectCommand(input, runOptions)
		},
		async listTemplates() {
			return ok({
				templates: [
					{
						name: "node-ts",
						runtime: "podman",
						defaultNetwork: defaultSandoPolicy.defaultNetwork,
						description: "Node.js and TypeScript project command runner.",
					},
				],
			})
		},
		async explainPolicy() {
			const policy = await loadProjectPolicy({
				startPath: runOptions.startPath,
				projectRoot: runOptions.projectRoot,
			})

			if (!policy.ok) {
				return policy
			}

			const effective = compileEffectivePolicy({
				localProjectPolicy: policy.value.policy,
			})

			if (!effective.ok) {
				return effective
			}

			return ok({
				projectRoot: policy.value.projectRoot,
				policyPath: policy.value.path,
				localPolicy: policy.value.policy,
				effectivePolicy: effective.value,
			})
		},
		async getRun(input) {
			const result = await readRunResult(runLookupInput(input.runId, runOptions))

			if (!result.ok) {
				return result
			}

			return ok({
				runId: input.runId,
				result: result.value,
			})
		},
		async readLogs(input) {
			const logs = await readRunLogs(runLookupInput(input.runId, runOptions))

			if (!logs.ok) {
				return logs
			}

			return ok({
				runId: input.runId,
				logs: logs.value,
			})
		},
		async getDiff(input) {
			const diff = await readRunDiff(runLookupInput(input.runId, runOptions))

			if (!diff.ok) {
				return diff
			}

			return ok({
				runId: input.runId,
				diff: diff.value,
			})
		},
		async downloadArtifact(input) {
			const artifact = await readRunArtifact(artifactLookupInput(input, runOptions))

			if (!artifact.ok) {
				return artifact
			}

			return ok({
				artifact: artifact.value.artifact,
				content: artifact.value.content,
			})
		},
	}
}

export function createSandhostMcpServer(
	service: SandhostMcpService = createSandhostMcpService(),
): McpServer {
	const server = new McpServer({
		name: appName,
		version: appVersion,
	})

	server.registerTool(
		"sandhost_run_project_command",
		{
			title: "Run project command",
			description:
				"Run a project command inside a local sandhost sandbox and return logs, diff, and artifact refs.",
			inputSchema: runProjectCommandInputSchema,
		},
		async (input) => toolResult(await service.runProjectCommand(input)),
	)

	server.registerTool(
		"sandhost_list_templates",
		{
			title: "List templates",
			description: "List sandbox runtime templates available to this sandhost MCP server.",
		},
		async () => toolResult(await service.listTemplates()),
	)

	server.registerTool(
		"sandhost_explain_policy",
		{
			title: "Explain policy",
			description: "Show the local sandhost policy and effective defaults for this project.",
		},
		async () => toolResult(await service.explainPolicy()),
	)

	server.registerTool(
		"sandhost_get_run",
		{
			title: "Get run",
			description: "Read the local result.json metadata for a sandhost run.",
			inputSchema: runIdInputSchema,
		},
		async (input) => toolResult(await service.getRun(input)),
	)

	server.registerTool(
		"sandhost_read_logs",
		{
			title: "Read logs",
			description: "Read logs.txt for a sandhost run.",
			inputSchema: runIdInputSchema,
		},
		async (input) => toolResult(await service.readLogs(input)),
	)

	server.registerTool(
		"sandhost_get_diff",
		{
			title: "Get diff",
			description: "Read diff.patch for a sandhost run.",
			inputSchema: runIdInputSchema,
		},
		async (input) => toolResult(await service.getDiff(input)),
	)

	server.registerTool(
		"sandhost_download_artifact",
		{
			title: "Download artifact",
			description: "Read a local sandhost artifact by artifactId, or by runId and artifact name.",
			inputSchema: downloadArtifactInputSchema,
		},
		async (input) => toolResult(await service.downloadArtifact(compactArtifactInput(input))),
	)

	return server
}

function optionalAuthority(
	authority: CreateSandhostMcpServiceOptions["authority"],
):
	| { readonly authority: NonNullable<CreateSandhostMcpServiceOptions["authority"]> }
	| Record<string, never> {
	return authority === undefined ? {} : { authority }
}

function runLookupInput(
	runId: string,
	options: CreateSandhostMcpServiceOptions,
): { readonly runId: string; readonly runsRootPath?: string } {
	return {
		runId,
		...(options.runsRootPath === undefined ? {} : { runsRootPath: options.runsRootPath }),
	}
}

function artifactLookupInput(
	input: {
		readonly artifactId?: string | undefined
		readonly name?: string | undefined
		readonly runId?: string | undefined
	},
	options: CreateSandhostMcpServiceOptions,
): {
	readonly artifactId?: string
	readonly name?: string
	readonly runId?: string
	readonly runsRootPath?: string
} {
	return {
		...(input.artifactId === undefined ? {} : { artifactId: input.artifactId }),
		...(input.name === undefined ? {} : { name: input.name }),
		...(input.runId === undefined ? {} : { runId: input.runId }),
		...(options.runsRootPath === undefined ? {} : { runsRootPath: options.runsRootPath }),
	}
}

function compactArtifactInput(input: {
	readonly artifactId?: string | undefined
	readonly name?: string | undefined
	readonly runId?: string | undefined
}): {
	readonly artifactId?: string
	readonly name?: string
	readonly runId?: string
} {
	return {
		...(input.artifactId === undefined ? {} : { artifactId: input.artifactId }),
		...(input.name === undefined ? {} : { name: input.name }),
		...(input.runId === undefined ? {} : { runId: input.runId }),
	}
}

export async function startStdioServer(
	service: SandhostMcpService = createSandhostMcpService(),
): Promise<void> {
	const server = createSandhostMcpServer(service)
	await server.connect(new StdioServerTransport())
}

function toolResult(result: Result<Record<string, unknown> | RunProjectCommandResult>) {
	if (!result.ok) {
		return toolError(result.error)
	}

	return {
		content: [
			{
				type: "text" as const,
				text: `${JSON.stringify(result.value, null, 2)}\n`,
			},
		],
		structuredContent: result.value as Record<string, unknown>,
	}
}

function toolError(error: SandoError) {
	const structuredContent = {
		error: {
			code: error.code,
			message: error.message,
			...(error.details === undefined ? {} : { details: error.details }),
		},
	}

	return {
		isError: true,
		content: [
			{
				type: "text" as const,
				text: `${error.code}: ${error.message}\n`,
			},
		],
		structuredContent,
	}
}

export function invalidToolInput(message: string): Result<never> {
	return err(
		sandoError({
			code: "VALIDATION_FAILED",
			message,
		}),
	)
}

export async function main(): Promise<void> {
	await startStdioServer()
}

function isMainModule(): boolean {
	const entrypoint = process.argv[1]

	return entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href
}

if (isMainModule()) {
	main().catch((error: unknown) => {
		const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
		process.stderr.write(`${message}\n`)
		process.exitCode = 1
	})
}
