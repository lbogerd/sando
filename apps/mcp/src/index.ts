#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"

import {
	compileEffectivePolicy,
	createHostedAgentAuthorityFromEnv,
	BetterAuthAgentAuthority,
	loadProjectPolicy,
	readRunArtifact,
	readRunDiff,
	readRunLogs,
	readRunResult,
	runProjectCommand,
	type RunProjectCommandOptions,
} from "@sando/runners"
import {
	asId,
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

export const appName = "sando-mcp"
export const appVersion = "0.0.0"

const runIdInputSchema = z.object({
	runId: z.string().min(1),
})

const downloadArtifactInputSchema = z.object({
	artifactId: z.string().min(1).optional(),
	runId: z.string().min(1).optional(),
	name: z.string().min(1).optional(),
})

export type SandoMcpService = {
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

export type CreateSandoMcpServiceOptions = RunProjectCommandOptions

export function createSandoMcpService(options: CreateSandoMcpServiceOptions = {}): SandoMcpService {
	const runOptions: CreateSandoMcpServiceOptions =
		options.authority === undefined
			? {
					...options,
					...optionalAuthority(
						createHostedAgentAuthorityFromEnv() ??
							createHostedAgentAuthorityFromProjectConfig(options.projectRoot),
					),
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

function createHostedAgentAuthorityFromProjectConfig(
	projectRoot: string | undefined,
): BetterAuthAgentAuthority | undefined {
	if (projectRoot === undefined) {
		return undefined
	}

	const root = resolve(projectRoot)
	const project = readJsonObject(join(root, ".sando", "project.json"))
	const session = readJsonObject(join(root, ".sando", "session.json"))

	if (project === undefined || session === undefined) {
		return undefined
	}

	const apiUrl = stringField(project, "apiUrl")
	const projectId = stringField(project, "projectId")
	const hostId = stringField(project, "hostId")
	const agentId = stringField(project, "agentId")
	const token = stringField(session, "token")

	if (
		apiUrl === undefined ||
		projectId === undefined ||
		hostId === undefined ||
		agentId === undefined ||
		token === undefined
	) {
		return undefined
	}

	return new BetterAuthAgentAuthority({
		apiUrl,
		token,
		projectId: asId("project", projectId),
		hostId: asId("host", hostId),
		agentId: asId("agent", agentId),
	})
}

function readJsonObject(path: string): Record<string, unknown> | undefined {
	if (!existsSync(path)) {
		return undefined
	}

	const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown

	return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
		? (parsed as Record<string, unknown>)
		: undefined
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
	const field = value[key]

	return typeof field === "string" && field.trim().length > 0 ? field : undefined
}

export function createSandoMcpServer(
	service: SandoMcpService = createSandoMcpService(),
): McpServer {
	const server = new McpServer({
		name: appName,
		version: appVersion,
	})

	server.registerTool(
		"sando_run_project_command",
		{
			title: "Run project command",
			description:
				"Run a project command inside a local sando sandbox and return logs, diff, and artifact refs.",
			inputSchema: runProjectCommandInputSchema,
		},
		async (input) => toolResult(await service.runProjectCommand(input)),
	)

	server.registerTool(
		"sando_list_templates",
		{
			title: "List templates",
			description: "List sandbox runtime templates available to this sando MCP server.",
		},
		async () => toolResult(await service.listTemplates()),
	)

	server.registerTool(
		"sando_explain_policy",
		{
			title: "Explain policy",
			description: "Show the local sando policy and effective defaults for this project.",
		},
		async () => toolResult(await service.explainPolicy()),
	)

	server.registerTool(
		"sando_get_run",
		{
			title: "Get run",
			description: "Read the local result.json metadata for a run.",
			inputSchema: runIdInputSchema,
		},
		async (input) => toolResult(await service.getRun(input)),
	)

	server.registerTool(
		"sando_read_logs",
		{
			title: "Read logs",
			description: "Read logs.txt for a run.",
			inputSchema: runIdInputSchema,
		},
		async (input) => toolResult(await service.readLogs(input)),
	)

	server.registerTool(
		"sando_get_diff",
		{
			title: "Get diff",
			description: "Read diff.patch for a run.",
			inputSchema: runIdInputSchema,
		},
		async (input) => toolResult(await service.getDiff(input)),
	)

	server.registerTool(
		"sando_download_artifact",
		{
			title: "Download artifact",
			description: "Read a local sando artifact by artifactId, or by runId and artifact name.",
			inputSchema: downloadArtifactInputSchema,
		},
		async (input) => toolResult(await service.downloadArtifact(compactArtifactInput(input))),
	)

	return server
}

function optionalAuthority(
	authority: CreateSandoMcpServiceOptions["authority"],
):
	| { readonly authority: NonNullable<CreateSandoMcpServiceOptions["authority"]> }
	| Record<string, never> {
	return authority === undefined ? {} : { authority }
}

function runLookupInput(
	runId: string,
	options: CreateSandoMcpServiceOptions,
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
	options: CreateSandoMcpServiceOptions,
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
	service: SandoMcpService = createSandoMcpService(),
): Promise<void> {
	const server = createSandoMcpServer(service)
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
