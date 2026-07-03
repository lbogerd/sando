import { execFile } from "node:child_process"
import { randomBytes, createHash } from "node:crypto"
import {
	copyFile,
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	readlink,
	rm,
	symlink,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, isAbsolute, join, parse as parsePath, relative, resolve, sep } from "node:path"
import { promisify } from "node:util"

import { z } from "zod"

import {
	type AgentId,
	type ArtifactRef,
	type ArtifactRecord,
	type AppendAuditEventResult,
	type AuthorizeGrantInput,
	type AuthorizeGrantResult,
	type CreateRunResult,
	type FinishRunResult,
	type GrantRecord,
	type HostId,
	type JsonValue,
	parseAppendAuditEventResult,
	parseAuthorizeGrantResult,
	parseCreateArtifactMetadataResult,
	parseCreateRunResult,
	parseFinishRunResult,
	parseGrantRecord,
	parseRequestGrantResult,
	type ProjectId,
	type RequestGrantInput,
	type RequestGrantResult,
	asId,
	defaultSandoPolicy,
	err,
	networkModeSchema,
	networkModes,
	ok,
	parseRunProjectCommandInput,
	parseSandoPolicy,
	resourceLimitsSchema,
	runProjectCommandInputSchema,
	runProjectCommandHash,
	sandboxRuntimeKindSchema,
	sandoError,
	sandoErrorCodes,
	sandoPolicySchema,
	secretPolicySchema,
	type NetworkMode,
	type Result,
	type RunProjectCommandInput,
	type RunProjectCommandResult,
	type RunId,
	type SandboxRuntimeKind,
	type SandoUri,
} from "@sando/shared"
import {
	PodmanRuntime,
	defaultPodmanRunsRootPath,
	type ArtifactBundle,
	type RuntimeArtifact,
	type SandboxRuntime,
	type WorkspaceArchive,
	withSandboxCleanup,
} from "@sando/runtimes"

export const packageName = "runners"

export const projectPolicyFilePath = ".sando/policy.json"
export const gitArchiveFileSelectionArgs = [
	"ls-files",
	"-z",
	"-c",
	"-o",
	"--exclude-standard",
] as const
export const hardcodedSensitiveFileExclusions = {
	basenames: [
		".env",
		".npmrc",
		".pypirc",
		".netrc",
		"id_dsa",
		"id_ecdsa",
		"id_ed25519",
		"id_rsa",
	] as const,
	envPrefix: ".env.",
	extensions: [".key", ".pem", ".p12", ".pfx"] as const,
	paths: [
		".aws/credentials",
		".docker/config.json",
		".kube/config",
		".sando/session.json",
	] as const,
} as const
export const sandoSessionFilePath = ".sando/session.json"

const execFileAsync = promisify(execFile)
const pendingGrantTtlSeconds = 10 * 60

export const projectRootStrongMarkers = [
	projectPolicyFilePath,
	".git",
	"pnpm-workspace.yaml",
] as const
export const projectRunArtifactsRootPath = defaultPodmanRunsRootPath

export const projectRootFallbackMarkers = ["package.json"] as const

export const projectRootMarkerSchema = z.enum([
	...projectRootStrongMarkers,
	...projectRootFallbackMarkers,
])

export type ProjectRootMarker = z.infer<typeof projectRootMarkerSchema>

export const projectRootSchema = z.object({
	path: z.string(),
	marker: projectRootMarkerSchema,
})

export type ProjectRoot = z.infer<typeof projectRootSchema>

export const findProjectRootInputSchema = z.object({
	startPath: z.string().optional(),
})

export type FindProjectRootInput = z.infer<typeof findProjectRootInputSchema>

export const loadedProjectPolicySchema = z.object({
	projectRoot: z.string(),
	path: z.string(),
	policy: sandoPolicySchema,
})

export type LoadedProjectPolicy = z.infer<typeof loadedProjectPolicySchema>

export const loadProjectPolicyInputSchema = z.object({
	startPath: z.string().optional(),
	projectRoot: z.string().optional(),
})

export type LoadProjectPolicyInput = z.infer<typeof loadProjectPolicyInputSchema>

export const archiveFileSelectionInputSchema = z.object({
	startPath: z.string().optional(),
	projectRoot: z.string().optional(),
	gitExecutable: z.string().optional(),
})

export type ArchiveFileSelectionInput = z.infer<typeof archiveFileSelectionInputSchema>

export const archiveFileSelectionSchema = z.object({
	projectRoot: z.string(),
	files: z.array(z.string()),
})

export type ArchiveFileSelection = z.infer<typeof archiveFileSelectionSchema>

export const runProjectCommandOptionsSchema = z.object({
	authority: z.custom<AgentAuthority>().optional(),
	startPath: z.string().optional(),
	projectRoot: z.string().optional(),
	runId: z.string().optional(),
	runsRootPath: z.string().optional(),
	runtime: z.custom<SandboxRuntime>().optional(),
})

export type RunProjectCommandOptions = z.infer<typeof runProjectCommandOptionsSchema>

export type CapabilityExecutionRequest = {
	readonly capability: "sandbox.run_project_command"
	readonly command: string
	readonly commandHash: string
	readonly maxTimeoutSeconds: number
	readonly network: NetworkMode
	readonly runtime: SandboxRuntimeKind
	readonly template: string
	readonly timeoutSeconds: number
}

export type AuthorizedCapability = {
	readonly grant: GrantRecord
}

export type CreateHostedRunInput = {
	readonly command: string
	readonly grantId: string
	readonly network: NetworkMode
	readonly runtime: SandboxRuntimeKind
	readonly template: string
}

export type FinishHostedRunInput = {
	readonly durationMs: number
	readonly exitCode: number | null
	readonly runId: RunId
	readonly status: RunProjectCommandResult["status"]
}

export type RegisterHostedArtifactsInput = {
	readonly artifacts: readonly ArtifactRef[]
	readonly runId: RunId
}

export type RegisterHostedArtifactsResult = {
	readonly artifacts: readonly ArtifactRecord[]
}

export type AgentAuthority = {
	readonly appendAuditEvent?: (input: {
		readonly grantId?: string
		readonly metadata?: Record<string, JsonValue>
		readonly runId?: string
		readonly type: "command.started" | "command.finished"
	}) => Promise<Result<AppendAuditEventResult>>
	readonly createRun?: (input: CreateHostedRunInput) => Promise<Result<CreateRunResult>>
	readonly ensureCapability: (
		input: CapabilityExecutionRequest,
	) => Promise<Result<AuthorizedCapability>>
	readonly finishRun?: (input: FinishHostedRunInput) => Promise<Result<FinishRunResult>>
	readonly registerArtifacts?: (
		input: RegisterHostedArtifactsInput,
	) => Promise<Result<RegisterHostedArtifactsResult>>
}

export type BetterAuthAgentAuthorityOptions = {
	readonly agentId: AgentId
	readonly apiUrl: string
	readonly fetch?: typeof fetch
	readonly hostId: HostId
	readonly openApprovalUrl?: (url: string) => Promise<void> | void
	readonly pollIntervalMs?: number
	readonly projectId: ProjectId
	readonly token: string
	readonly waitTimeoutMs?: number
}

export type HostedAgentAuthorityOptions = BetterAuthAgentAuthorityOptions

export type HostedAgentAuthorityEnvironment = {
	readonly SANDO_AGENT_ID?: string
	readonly SANDO_API_URL?: string
	readonly SANDO_HOST_ID?: string
	readonly SANDO_OPEN_APPROVAL?: string
	readonly SANDO_PROJECT_ID?: string
	readonly SANDO_SESSION_TOKEN?: string
}

export const policyConstraintsSchema = z.object({
	defaultTemplate: z.string().optional(),
	allowedTemplates: z.array(z.string()).optional(),
	runtime: sandboxRuntimeKindSchema.optional(),
	defaultNetwork: networkModeSchema.optional(),
	allowedNetworks: z.array(networkModeSchema).optional(),
	maxTtlSeconds: z.number().optional(),
	maxTimeoutSeconds: z.number().optional(),
	resources: resourceLimitsSchema.partial().optional(),
	secrets: secretPolicySchema.optional(),
	artifacts: z.array(z.string()).optional(),
	exclude: z.array(z.string()).optional(),
})

export type PolicyConstraints = z.infer<typeof policyConstraintsSchema>

export const compileEffectivePolicyInputSchema = z.object({
	systemPolicy: policyConstraintsSchema.optional(),
	hostedProjectPolicy: policyConstraintsSchema.optional(),
	localProjectPolicy: policyConstraintsSchema.optional(),
	templateDefaults: policyConstraintsSchema.optional(),
	grantConstraints: policyConstraintsSchema.optional(),
	request: runProjectCommandInputSchema.optional(),
})

export type CompileEffectivePolicyInput = z.infer<typeof compileEffectivePolicyInputSchema>

export const effectivePolicySchema = z.object({
	template: z.string(),
	allowedTemplates: z.array(z.string()),
	runtime: sandboxRuntimeKindSchema,
	network: networkModeSchema,
	allowedNetworks: z.array(networkModeSchema),
	maxTtlSeconds: z.number(),
	maxTimeoutSeconds: z.number(),
	timeoutSeconds: z.number(),
	resources: resourceLimitsSchema,
	secrets: secretPolicySchema,
	artifacts: z.array(z.string()),
	exclude: z.array(z.string()),
})

export type EffectivePolicy = z.infer<typeof effectivePolicySchema>

export const defaultSystemPolicyConstraints = {
	allowedTemplates: [defaultSandoPolicy.defaultTemplate],
	runtime: "podman",
	allowedNetworks: ["none", "default"],
	maxTtlSeconds: 1800,
	maxTimeoutSeconds: 600,
	resources: {
		cpu: 2,
		memoryMb: 4096,
	},
	secrets: {
		allow: [],
	},
} satisfies PolicyConstraints

export const defaultNodeTsTemplatePolicyConstraints = {
	defaultTemplate: "node-ts",
	allowedTemplates: ["node-ts"],
	defaultNetwork: "none",
	maxTimeoutSeconds: 600,
	resources: {
		cpu: 2,
		memoryMb: 4096,
	},
	secrets: {
		allow: [],
	},
} satisfies PolicyConstraints

export class BetterAuthAgentAuthority implements AgentAuthority {
	readonly #apiUrl: string
	readonly #context: Pick<RequestGrantInput, "agentId" | "hostId" | "projectId">
	readonly #fetch: typeof fetch
	readonly #openApprovalUrl: (url: string) => Promise<void> | void
	readonly #pollIntervalMs: number
	readonly #token: string
	readonly #waitTimeoutMs: number

	constructor(options: BetterAuthAgentAuthorityOptions) {
		this.#apiUrl = options.apiUrl.replace(/\/+$/u, "")
		this.#context = {
			agentId: options.agentId,
			hostId: options.hostId,
			projectId: options.projectId,
		}
		this.#fetch = options.fetch ?? fetch
		this.#openApprovalUrl = options.openApprovalUrl ?? openApprovalUrlWithSystemBrowser
		this.#pollIntervalMs = options.pollIntervalMs ?? 1000
		this.#token = options.token
		this.#waitTimeoutMs = options.waitTimeoutMs ?? pendingGrantTtlSeconds * 1000
	}

	async ensureCapability(input: CapabilityExecutionRequest): Promise<Result<AuthorizedCapability>> {
		const requestInput = grantRequestInput(this.#context, input)
		const requested = await this.#requestGrant(requestInput)

		if (!requested.ok) {
			return requested
		}

		let grant = requested.value.grant

		if (grant.status === "pending") {
			try {
				await this.#openApprovalUrl(requested.value.approvalUrl)
			} catch (error) {
				return err(
					sandoError({
						code: "GRANT_REQUIRED",
						message: "Grant approval is required before execution.",
						details: {
							grantId: grant.id,
							approvalUrl: requested.value.approvalUrl,
							openError: error instanceof Error ? error.message : String(error),
						},
					}),
				)
			}

			const decided = await this.#waitForGrantDecision(grant.id, requested.value.approvalUrl)

			if (!decided.ok) {
				return decided
			}

			grant = decided.value
		}

		if (grant.status === "denied") {
			return err(
				sandoError({
					code: "GRANT_DENIED",
					message: "Grant was denied.",
					details: {
						grantId: grant.id,
						approvalUrl: requested.value.approvalUrl,
					},
				}),
			)
		}

		if (grant.status === "expired") {
			return err(
				sandoError({
					code: "GRANT_REQUIRED",
					message: "Grant expired before execution.",
					details: {
						grantId: grant.id,
						approvalUrl: requested.value.approvalUrl,
					},
				}),
			)
		}

		const authorized = await this.#authorizeGrant({
			...requestInput,
			grantId: grant.id,
		})

		if (!authorized.ok) {
			return authorized
		}

		return ok({
			grant: authorized.value.grant,
		})
	}

	async createRun(input: CreateHostedRunInput): Promise<Result<CreateRunResult>> {
		return this.#postJson(
			"/v1/runs",
			{
				projectId: this.#context.projectId,
				hostId: this.#context.hostId,
				agentId: this.#context.agentId,
				grantId: input.grantId,
				command: input.command,
				template: input.template,
				runtime: input.runtime,
				network: input.network,
			},
			parseCreateRunResult,
		)
	}

	async finishRun(input: FinishHostedRunInput): Promise<Result<FinishRunResult>> {
		return this.#postJson(
			`/v1/runs/${encodeURIComponent(input.runId)}/finish`,
			{
				status: input.status,
				exitCode: input.exitCode,
				durationMs: input.durationMs,
			},
			parseFinishRunResult,
		)
	}

	async appendAuditEvent(input: {
		readonly grantId?: string
		readonly metadata?: Record<string, JsonValue>
		readonly runId?: string
		readonly type: "command.started" | "command.finished"
	}): Promise<Result<AppendAuditEventResult>> {
		return this.#postJson(
			"/v1/audit-events",
			{
				type: input.type,
				projectId: this.#context.projectId,
				hostId: this.#context.hostId,
				agentId: this.#context.agentId,
				...(input.grantId === undefined ? {} : { grantId: input.grantId }),
				...(input.runId === undefined ? {} : { runId: input.runId }),
				metadata: input.metadata ?? {},
			},
			parseAppendAuditEventResult,
		)
	}

	async registerArtifacts(
		input: RegisterHostedArtifactsInput,
	): Promise<Result<RegisterHostedArtifactsResult>> {
		const artifacts: ArtifactRecord[] = []

		for (const artifact of input.artifacts) {
			const registered = await this.#postJson(
				`/v1/runs/${encodeURIComponent(input.runId)}/artifacts`,
				{
					projectId: this.#context.projectId,
					name: artifact.name,
					uri: artifact.uri,
					path: artifact.uri,
					...(artifact.contentType === undefined ? {} : { contentType: artifact.contentType }),
					...(artifact.sizeBytes === undefined ? {} : { sizeBytes: artifact.sizeBytes }),
					private: true,
				},
				parseCreateArtifactMetadataResult,
			)

			if (!registered.ok) {
				return registered
			}

			artifacts.push(registered.value.artifact)
		}

		return ok({ artifacts })
	}

	async #requestGrant(input: RequestGrantInput): Promise<Result<RequestGrantResult>> {
		return this.#postJson("/v1/grants/request", input, parseRequestGrantResult)
	}

	async #authorizeGrant(input: AuthorizeGrantInput): Promise<Result<AuthorizeGrantResult>> {
		return this.#postJson("/v1/grants/authorize", input, parseAuthorizeGrantResult)
	}

	async #waitForGrantDecision(grantId: string, approvalUrl: string): Promise<Result<GrantRecord>> {
		const startedAt = Date.now()

		while (Date.now() - startedAt < this.#waitTimeoutMs) {
			const grant = await this.#getGrant(grantId)

			if (!grant.ok) {
				return grant
			}

			if (grant.value.status !== "pending") {
				return grant
			}

			await delay(this.#pollIntervalMs)
		}

		return err(
			sandoError({
				code: "GRANT_REQUIRED",
				message: "Timed out waiting for hosted approval.",
				details: {
					grantId,
					approvalUrl,
				},
			}),
		)
	}

	async #getGrant(grantId: string): Promise<Result<GrantRecord>> {
		const response = await this.#fetch(`${this.#apiUrl}/v1/grants/${encodeURIComponent(grantId)}`, {
			headers: this.#headers(),
		})

		return parseJsonResponse(response, (value) => {
			const parsed = z.object({ grant: z.unknown() }).safeParse(value)

			if (!parsed.success) {
				return err(validationErrorForResponse("Invalid get grant response.", parsed.error))
			}

			return parseGrantRecord(parsed.data.grant)
		})
	}

	async #postJson<Value>(
		path: string,
		body: unknown,
		parse: (value: unknown) => Result<Value>,
	): Promise<Result<Value>> {
		const response = await this.#fetch(`${this.#apiUrl}${path}`, {
			method: "POST",
			body: JSON.stringify(body),
			headers: {
				...this.#headers(),
				"content-type": "application/json",
			},
		})

		return parseJsonResponse(response, parse)
	}

	#headers(): Record<string, string> {
		return {
			authorization: `Bearer ${this.#token}`,
		}
	}
}

export function createHostedAgentAuthorityFromEnv(
	env: HostedAgentAuthorityEnvironment = process.env,
): AgentAuthority | undefined {
	if (
		env.SANDO_API_URL === undefined ||
		env.SANDO_SESSION_TOKEN === undefined ||
		env.SANDO_PROJECT_ID === undefined ||
		env.SANDO_HOST_ID === undefined ||
		env.SANDO_AGENT_ID === undefined
	) {
		return undefined
	}

	return new BetterAuthAgentAuthority({
		apiUrl: env.SANDO_API_URL,
		token: env.SANDO_SESSION_TOKEN,
		projectId: asId("project", env.SANDO_PROJECT_ID),
		hostId: asId("host", env.SANDO_HOST_ID),
		agentId: asId("agent", env.SANDO_AGENT_ID),
		...(env.SANDO_OPEN_APPROVAL === "0"
			? {
					openApprovalUrl: () => undefined,
				}
			: {}),
	})
}

export { BetterAuthAgentAuthority as HostedAgentAuthority }

export async function findProjectRoot(
	input: FindProjectRootInput = {},
): Promise<Result<ProjectRoot>> {
	const startPath = resolve(input.startPath ?? process.cwd())
	const startDirectory = await resolveStartDirectory(startPath)

	if (!startDirectory.ok) {
		return startDirectory
	}

	let fallback: ProjectRoot | undefined

	for (const directory of ancestorDirectories(startDirectory.value)) {
		const strongMarker = await findExistingMarker(directory, projectRootStrongMarkers)

		if (strongMarker !== undefined) {
			return ok({ path: directory, marker: strongMarker })
		}

		fallback ??= await findFallbackRoot(directory)
	}

	if (fallback !== undefined) {
		return ok(fallback)
	}

	return err(
		sandoError({
			code: "NOT_FOUND",
			message: "Could not find a project root.",
			details: {
				startPath,
				markers: [...projectRootStrongMarkers, ...projectRootFallbackMarkers],
			},
		}),
	)
}

export async function loadProjectPolicy(
	input: LoadProjectPolicyInput = {},
): Promise<Result<LoadedProjectPolicy>> {
	const projectRoot = await resolvePolicyProjectRoot(input)

	if (!projectRoot.ok) {
		return projectRoot
	}

	const policyPath = join(projectRoot.value, projectPolicyFilePath)
	const file = await readTextFile(policyPath)

	if (!file.ok) {
		return file
	}

	const json = parseJsonFile(file.value, policyPath)

	if (!json.ok) {
		return json
	}

	const policy = parseSandoPolicy(json.value)

	if (!policy.ok) {
		return err(
			sandoError({
				code: "VALIDATION_FAILED",
				message: "Invalid sando policy file.",
				details: { path: policyPath },
				cause: policy.error,
			}),
		)
	}

	return ok({
		projectRoot: projectRoot.value,
		path: policyPath,
		policy: policy.value,
	})
}

export function compileEffectivePolicy(
	input: CompileEffectivePolicyInput = {},
): Result<EffectivePolicy> {
	const layers = policyLayers(input)
	const allowedTemplates = intersectStringSets(
		layers.flatMap((layer) => {
			if (layer.allowedTemplates !== undefined) {
				return [layer.allowedTemplates]
			}

			if (layer.defaultTemplate !== undefined) {
				return [[layer.defaultTemplate]]
			}

			return []
		}),
		[defaultSandoPolicy.defaultTemplate],
	)

	if (allowedTemplates.length === 0) {
		return policyViolation("Policy layers do not allow a shared template.", {
			field: "template",
		})
	}

	const template = input.request?.template ?? allowedTemplates[0]

	if (template === undefined || !allowedTemplates.includes(template)) {
		return policyViolation("Requested template is not allowed by policy.", {
			requestedTemplate: input.request?.template,
			allowedTemplates,
		})
	}

	const runtime = selectRuntime(layers)

	if (!runtime.ok) {
		return runtime
	}

	const allowedNetworks = intersectNetworks(
		layers.flatMap((layer) => (layer.allowedNetworks === undefined ? [] : [layer.allowedNetworks])),
	)

	if (allowedNetworks.length === 0) {
		return policyViolation("Policy layers do not allow a shared network mode.", {
			field: "network",
		})
	}

	const network = selectNetwork(input.request?.network, layers, allowedNetworks)

	if (!network.ok) {
		return network
	}

	const maxTtlSeconds = minPolicyNumber(
		layers.map((layer) => layer.maxTtlSeconds),
		defaultSandoPolicy.maxTtlSeconds,
	)
	const maxTimeoutSeconds = minPolicyNumber(
		layers.map((layer) => layer.maxTimeoutSeconds),
		defaultSandoPolicy.maxTimeoutSeconds,
	)
	const timeoutSeconds = input.request?.timeoutSeconds ?? maxTimeoutSeconds

	if (timeoutSeconds > maxTimeoutSeconds) {
		return policyViolation("Requested timeout exceeds the effective policy maximum.", {
			requestedTimeoutSeconds: timeoutSeconds,
			maxTimeoutSeconds,
		})
	}

	return ok({
		template,
		allowedTemplates: [...allowedTemplates],
		runtime: runtime.value,
		network: network.value,
		allowedNetworks: [...allowedNetworks],
		maxTtlSeconds,
		maxTimeoutSeconds,
		timeoutSeconds,
		resources: {
			cpu: minPolicyNumber(
				layers.map((layer) => layer.resources?.cpu),
				defaultSandoPolicy.resources.cpu,
			),
			memoryMb: minPolicyNumber(
				layers.map((layer) => layer.resources?.memoryMb),
				defaultSandoPolicy.resources.memoryMb,
			),
		},
		secrets: {
			allow: [
				...intersectStringSets(
					layers.flatMap((layer) => (layer.secrets === undefined ? [] : [layer.secrets.allow])),
					defaultSandoPolicy.secrets.allow,
				),
			],
		},
		artifacts: [
			...intersectStringSets(
				layers.flatMap((layer) => (layer.artifacts === undefined ? [] : [layer.artifacts])),
				defaultSandoPolicy.artifacts,
			),
		],
		exclude: [
			...unionStringSets(
				layers.flatMap((layer) => (layer.exclude === undefined ? [] : [layer.exclude])),
				defaultSandoPolicy.exclude,
			),
		],
	})
}

export async function selectArchiveFiles(
	input: ArchiveFileSelectionInput = {},
): Promise<Result<ArchiveFileSelection>> {
	const projectRoot = await resolveProjectRootPath(input)

	if (!projectRoot.ok) {
		return projectRoot
	}

	const gitExecutable = input.gitExecutable ?? "git"

	try {
		const { stdout } = await execFileAsync(gitExecutable, [...gitArchiveFileSelectionArgs], {
			cwd: projectRoot.value,
			encoding: "utf8",
			maxBuffer: 128 * 1024 * 1024,
		})

		const excludePatterns = await archiveExcludePatternsForProjectRoot(projectRoot.value)

		if (!excludePatterns.ok) {
			return excludePatterns
		}

		return ok({
			projectRoot: projectRoot.value,
			files: [...filterArchiveFiles(parseGitNullDelimitedPaths(stdout), excludePatterns.value)],
		})
	} catch (error) {
		if (!isExecFileError(error)) {
			throw error
		}

		if (isNotGitRepositoryError(error)) {
			return selectArchiveFilesFromDirectory(projectRoot.value)
		}

		return err(
			sandoError({
				code: "COMMAND_FAILED",
				message: "Could not select archive files with git.",
				details: {
					command: `${gitExecutable} ${gitArchiveFileSelectionArgs.join(" ")}`,
					cwd: projectRoot.value,
					exitCode: typeof error.code === "number" ? error.code : null,
					errorCode: typeof error.code === "string" ? error.code : null,
					stderr: execOutputToString(error.stderr),
				},
			}),
		)
	}
}

async function selectArchiveFilesFromDirectory(
	projectRoot: string,
): Promise<Result<ArchiveFileSelection>> {
	const excludePatterns = await archiveExcludePatternsForProjectRoot(projectRoot)

	if (!excludePatterns.ok) {
		return excludePatterns
	}

	const files = await listDirectoryArchiveFiles(projectRoot, "", excludePatterns.value)

	if (!files.ok) {
		return files
	}

	return ok({
		projectRoot,
		files: files.value,
	})
}

async function listDirectoryArchiveFiles(
	projectRoot: string,
	currentPath: string,
	excludePatterns: readonly string[],
): Promise<Result<string[]>> {
	const absolutePath = join(projectRoot, currentPath)

	try {
		const entries = await readdir(absolutePath, { withFileTypes: true })
		const files: string[] = []

		for (const entry of entries) {
			const archivePath = currentPath.length === 0 ? entry.name : `${currentPath}/${entry.name}`

			if (
				isSensitiveArchiveFilePath(archivePath) ||
				isPolicyExcludedArchiveFilePath(archivePath, excludePatterns)
			) {
				continue
			}

			const entryPath = join(projectRoot, archivePath)
			const entryStat = await lstat(entryPath)

			if (entryStat.isDirectory() && !entryStat.isSymbolicLink()) {
				const nested = await listDirectoryArchiveFiles(projectRoot, archivePath, excludePatterns)

				if (!nested.ok) {
					return nested
				}

				files.push(...nested.value)
				continue
			}

			if (entryStat.isFile() || entryStat.isSymbolicLink()) {
				files.push(archivePath)
			}
		}

		return ok(files.sort())
	} catch (error) {
		return fileSystemFailure("Could not select archive files from directory.", error, {
			path: absolutePath,
		})
	}
}

function isNotGitRepositoryError(error: ExecFileError): boolean {
	return (
		typeof error.code === "number" &&
		error.code === 128 &&
		execOutputToString(error.stderr).includes("not a git repository")
	)
}

async function archiveExcludePatternsForProjectRoot(
	projectRoot: string,
): Promise<Result<readonly string[]>> {
	const policyPath = join(projectRoot, projectPolicyFilePath)
	const file = await readTextFile(policyPath)

	if (!file.ok) {
		if (file.error.code === "NOT_FOUND") {
			return ok(defaultSandoPolicy.exclude)
		}

		return file
	}

	const json = parseJsonFile(file.value, policyPath)

	if (!json.ok) {
		return json
	}

	const policy = parseSandoPolicy(json.value)

	if (!policy.ok) {
		return err(
			sandoError({
				code: "VALIDATION_FAILED",
				message: "Invalid sando policy file.",
				details: { path: policyPath },
				cause: policy.error,
			}),
		)
	}

	return ok(uniqueStrings([...defaultSandoPolicy.exclude, ...policy.value.exclude]))
}

export async function runProjectCommand(
	inputValue: unknown,
	options: RunProjectCommandOptions = {},
): Promise<Result<RunProjectCommandResult>> {
	const input = parseRunProjectCommandInput(inputValue)

	if (!input.ok) {
		return input
	}

	const policy = await loadProjectPolicy({
		startPath: options.startPath,
		projectRoot: options.projectRoot,
	})

	if (!policy.ok) {
		return policy
	}

	const effectivePolicy = compileEffectivePolicy({
		localProjectPolicy: policy.value.policy,
		request: input.value,
	})

	if (!effectivePolicy.ok) {
		return effectivePolicy
	}

	const authority = options.authority

	if (authority === undefined) {
		return err(
			sandoError({
				code: "GRANT_REQUIRED",
				message: "Hosted Agent Auth is required before execution.",
			}),
		)
	}

	const capabilityRequest = capabilityExecutionRequest(input.value, effectivePolicy.value)
	const authorized = await authority.ensureCapability(capabilityRequest)

	if (!authorized.ok) {
		return authorized
	}

	const hostedRun =
		authority.createRun === undefined
			? undefined
			: await authority.createRun({
					command: input.value.command,
					grantId: authorized.value.grant.id,
					network: effectivePolicy.value.network,
					runtime: effectivePolicy.value.runtime,
					template: effectivePolicy.value.template,
				})

	if (hostedRun !== undefined && !hostedRun.ok) {
		return hostedRun
	}

	const runId =
		hostedRun?.ok === true ? hostedRun.value.run.id : asRunId(options.runId ?? createRunId())

	const started = Date.now()
	const startedAudit =
		authority.appendAuditEvent === undefined
			? undefined
			: await authority.appendAuditEvent({
					type: "command.started",
					grantId: authorized.value.grant.id,
					runId,
					metadata: {
						command: input.value.command,
						commandHash: capabilityRequest.commandHash,
						network: effectivePolicy.value.network,
						runtime: effectivePolicy.value.runtime,
						template: effectivePolicy.value.template,
						timeoutSeconds: effectivePolicy.value.timeoutSeconds,
					},
				})

	if (startedAudit !== undefined && !startedAudit.ok) {
		return startedAudit
	}

	const result = await runProjectCommandLocally(input.value, {
		effectivePolicy: effectivePolicy.value,
		projectRoot: policy.value.projectRoot,
		runId,
		...(options.runsRootPath === undefined ? {} : { runsRootPath: options.runsRootPath }),
		...(options.runtime === undefined ? {} : { runtime: options.runtime }),
	})

	const finish =
		authority.finishRun === undefined
			? undefined
			: await authority.finishRun(finishHostedRunInput(result, runId, Date.now() - started))

	if (finish !== undefined && !finish.ok) {
		return finish
	}

	const registeredArtifacts =
		result.ok && authority.registerArtifacts !== undefined
			? await authority.registerArtifacts({
					runId,
					artifacts: result.value.artifacts,
				})
			: undefined

	if (registeredArtifacts !== undefined && !registeredArtifacts.ok) {
		return registeredArtifacts
	}

	return result
}

async function runProjectCommandLocally(
	input: RunProjectCommandInput,
	options: {
		readonly effectivePolicy: EffectivePolicy
		readonly projectRoot: string
		readonly runId: RunId
		readonly runsRootPath?: string
		readonly runtime?: SandboxRuntime
	},
): Promise<Result<RunProjectCommandResult>> {
	const archiveFiles = await selectArchiveFiles({ projectRoot: options.projectRoot })

	if (!archiveFiles.ok) {
		return archiveFiles
	}

	const runtime =
		options.runtime ??
		new PodmanRuntime({
			runsRootPath: options.runsRootPath,
		})
	const workspace = await createWorkspaceSnapshot(archiveFiles.value, options.runId)

	if (!workspace.ok) {
		return workspace
	}

	try {
		const sandbox = await runtime.createSandbox({
			runId: options.runId,
			template: options.effectivePolicy.template,
			runtime: options.effectivePolicy.runtime,
			network: options.effectivePolicy.network,
			resources: options.effectivePolicy.resources,
			timeoutSeconds: options.effectivePolicy.timeoutSeconds,
		})

		if (!sandbox.ok) {
			return sandbox
		}

		return await withSandboxCleanup(runtime, sandbox.value, async (handle) => {
			const uploaded = await runtime.uploadWorkspace(handle, workspace.value)

			if (!uploaded.ok) {
				return uploaded
			}

			const commandResult = await runtime.runCommand(handle, {
				command: input.command,
				timeoutSeconds: options.effectivePolicy.timeoutSeconds,
			})

			if (!commandResult.ok) {
				return commandResult
			}

			const artifacts = await runtime.collectArtifacts(handle)

			if (!artifacts.ok) {
				return artifacts
			}

			return ok(
				runProjectCommandResult({
					artifacts: artifacts.value,
					command: input,
					durationMs: commandResult.value.durationMs,
					exitCode: commandResult.value.exitCode,
					network: options.effectivePolicy.network,
					runId: options.runId,
					status: commandResult.value.status,
					timeoutSeconds: options.effectivePolicy.timeoutSeconds,
				}),
			)
		})
	} finally {
		await rm(workspace.value.path, { force: true, recursive: true })
	}
}

export async function readRunLogs(
	input: { readonly runId: string; readonly runsRootPath?: string } | string,
): Promise<Result<string>> {
	const value = typeof input === "string" ? { runId: input } : input
	return readRunTextArtifact(value.runId, "logs.txt", value.runsRootPath)
}

export async function readRunDiff(
	input: { readonly runId: string; readonly runsRootPath?: string } | string,
): Promise<Result<string>> {
	const value = typeof input === "string" ? { runId: input } : input
	return readRunTextArtifact(value.runId, "diff.patch", value.runsRootPath)
}

export async function readRunArtifact(input: {
	readonly artifactId?: string
	readonly name?: string
	readonly runId?: string
	readonly runsRootPath?: string
}): Promise<Result<{ readonly artifact: RuntimeArtifact; readonly content: string }>> {
	const root = resolve(input.runsRootPath ?? projectRunArtifactsRootPath)

	if (input.artifactId !== undefined) {
		return readRunArtifactById(root, input.artifactId)
	}

	if (input.runId === undefined || input.name === undefined) {
		return err(
			sandoError({
				code: "VALIDATION_FAILED",
				message: "Expected either artifactId or both runId and name.",
			}),
		)
	}

	return readNamedRunArtifact(root, input.runId, input.name)
}

export async function readRunResult(input: {
	readonly runId: string
	readonly runsRootPath?: string
}): Promise<Result<unknown>> {
	return readJsonFile(
		join(resolve(input.runsRootPath ?? projectRunArtifactsRootPath), input.runId, "result.json"),
	)
}

export function runLogsRef(runId: RunId | string): SandoUri {
	return `sando://runs/${runId}/logs`
}

export function runDiffRef(runId: RunId | string): SandoUri {
	return `sando://runs/${runId}/diff`
}

export function runStdoutRef(runId: RunId | string): SandoUri {
	return `sando://runs/${runId}/stdout`
}

export function runStderrRef(runId: RunId | string): SandoUri {
	return `sando://runs/${runId}/stderr`
}

export function runChangedFilesRef(runId: RunId | string): SandoUri {
	return `sando://runs/${runId}/changed-files`
}

export function runAuditRef(runId: RunId | string): SandoUri {
	return `sando://runs/${runId}/audit`
}

export function artifactIdForRunArtifact(runId: RunId | string, name: string): string {
	const digest = createHash("sha256").update(`${runId}\0${name}`).digest("hex").slice(0, 16)
	return `art_${digest}`
}

function capabilityExecutionRequest(
	input: RunProjectCommandInput,
	effectivePolicy: EffectivePolicy,
): CapabilityExecutionRequest {
	const shape = {
		command: input.command,
		template: effectivePolicy.template,
		runtime: effectivePolicy.runtime,
		network: effectivePolicy.network,
		timeoutSeconds: effectivePolicy.timeoutSeconds,
	}

	return {
		capability: "sandbox.run_project_command",
		...shape,
		commandHash: runProjectCommandHash(shape),
		maxTimeoutSeconds: effectivePolicy.maxTimeoutSeconds,
	}
}

function grantRequestInput(
	context: Pick<RequestGrantInput, "agentId" | "hostId" | "projectId">,
	input: CapabilityExecutionRequest,
): RequestGrantInput {
	return {
		...context,
		capability: input.capability,
		constraints: {
			command: input.command,
			commandHash: input.commandHash,
			maxTimeoutSeconds: input.maxTimeoutSeconds,
			network: input.network,
			runtime: input.runtime,
			template: input.template,
			timeoutSeconds: input.timeoutSeconds,
		},
	}
}

async function parseJsonResponse<Value>(
	response: Response,
	parse: (value: unknown) => Result<Value>,
): Promise<Result<Value>> {
	const value = await response.json().catch(() => undefined)

	if (!response.ok) {
		const error = parseErrorResponse(value)

		return err(
			error ??
				sandoError({
					code: "INTERNAL",
					message: `Hosted sando request failed with HTTP ${response.status}.`,
				}),
		)
	}

	if (value === undefined) {
		return err(
			sandoError({
				code: "INTERNAL",
				message: "Hosted sando response did not contain JSON.",
			}),
		)
	}

	return parse(value)
}

function parseErrorResponse(value: unknown) {
	if (typeof value !== "object" || value === null || !("error" in value)) {
		return undefined
	}

	const error = (value as { readonly error?: unknown }).error

	if (typeof error !== "object" || error === null) {
		return undefined
	}

	const code = (error as { readonly code?: unknown }).code
	const message = (error as { readonly message?: unknown }).message

	if (
		typeof code !== "string" ||
		!sandoErrorCodes.includes(code as (typeof sandoErrorCodes)[number]) ||
		typeof message !== "string"
	) {
		return undefined
	}

	const details = (error as { readonly details?: unknown }).details

	return sandoError({
		code: code as (typeof sandoErrorCodes)[number],
		message,
		...(details === undefined ? {} : { details: details as JsonValue }),
	})
}

function validationErrorForResponse(message: string, error: z.ZodError) {
	return sandoError({
		code: "VALIDATION_FAILED",
		message,
		details: {
			issues: error.issues.map((issue) => ({
				path: issue.path.length === 0 ? "$" : `$.${issue.path.join(".")}`,
				message: issue.message,
			})),
		},
	})
}

async function openApprovalUrlWithSystemBrowser(url: string): Promise<void> {
	const command = browserOpenCommand(url)

	if (command === undefined) {
		return
	}

	await execFileAsync(command.command, command.args, {
		encoding: "utf8",
	})
}

function browserOpenCommand(
	url: string,
): { readonly command: string; readonly args: readonly string[] } | undefined {
	if (process.platform === "darwin") {
		return { command: "open", args: [url] }
	}

	if (process.platform === "win32") {
		return { command: "cmd.exe", args: ["/c", "start", "", url] }
	}

	if (process.env.WSL_DISTRO_NAME !== undefined || process.env.WSL_INTEROP !== undefined) {
		return { command: "wslview", args: [url] }
	}

	if (process.platform === "linux") {
		return { command: "xdg-open", args: [url] }
	}

	return undefined
}

async function delay(ms: number): Promise<void> {
	await new Promise<void>((resolvePromise) => {
		setTimeout(resolvePromise, ms)
	})
}

function parseGitNullDelimitedPaths(output: string): readonly string[] {
	return output
		.split("\0")
		.filter((path) => path.length > 0)
		.sort()
}

export function filterSensitiveArchiveFiles(files: readonly string[]): readonly string[] {
	return files.filter((path) => !isSensitiveArchiveFilePath(path))
}

export function filterArchiveFiles(
	files: readonly string[],
	excludePatterns: readonly string[],
): readonly string[] {
	return filterSensitiveArchiveFiles(files).filter(
		(path) => !isPolicyExcludedArchiveFilePath(path, excludePatterns),
	)
}

export function isSensitiveArchiveFilePath(path: string): boolean {
	const normalizedPath = normalizeArchivePath(path)
	const segments = normalizedPath.split("/")
	const basename = segments.at(-1) ?? normalizedPath

	if (
		segments.some(
			(segment) =>
				stringListIncludes(hardcodedSensitiveFileExclusions.basenames, segment) ||
				segment.startsWith(hardcodedSensitiveFileExclusions.envPrefix),
		)
	) {
		return true
	}

	if (
		hardcodedSensitiveFileExclusions.extensions.some((extension) => basename.endsWith(extension))
	) {
		return true
	}

	return hardcodedSensitiveFileExclusions.paths.some(
		(sensitivePath) =>
			normalizedPath === sensitivePath || normalizedPath.endsWith(`/${sensitivePath}`),
	)
}

function isPolicyExcludedArchiveFilePath(
	path: string,
	excludePatterns: readonly string[],
): boolean {
	const normalizedPath = normalizeArchivePath(path)

	return excludePatterns.some((pattern) => archiveExcludePatternMatches(pattern, normalizedPath))
}

function archiveExcludePatternMatches(pattern: string, normalizedPath: string): boolean {
	const normalizedPattern = normalizeArchivePath(pattern)

	if (normalizedPattern.length === 0) {
		return false
	}

	if (!normalizedPattern.includes("*")) {
		return (
			normalizedPath === normalizedPattern ||
			normalizedPath.startsWith(`${normalizedPattern}/`) ||
			normalizedPath.endsWith(`/${normalizedPattern}`) ||
			normalizedPath.includes(`/${normalizedPattern}/`)
		)
	}

	return archiveGlobToRegExp(normalizedPattern).test(normalizedPath)
}

function archiveGlobToRegExp(pattern: string): RegExp {
	let source = "^"

	for (let index = 0; index < pattern.length; index += 1) {
		const character = pattern[index]

		if (character === "*") {
			if (pattern[index + 1] === "*") {
				source += ".*"
				index += 1
			} else {
				source += "[^/]*"
			}
			continue
		}

		source += escapeRegExp(character ?? "")
	}

	source += "$"

	return new RegExp(source, "u")
}

function escapeRegExp(value: string): string {
	return value.replace(/[\\^$+?.()|[\]{}]/gu, "\\$&")
}

function stringListIncludes(values: readonly string[], value: string): boolean {
	return values.includes(value)
}

function normalizeArchivePath(path: string): string {
	return path.replaceAll("\\", "/").replace(/^\/+/, "")
}

function asRunId(value: string): RunId {
	return asId("run", value.startsWith("run_") ? value : `run_${value}`)
}

function createRunId(): string {
	return `run_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`
}

async function createWorkspaceSnapshot(
	selection: ArchiveFileSelection,
	runId: RunId,
): Promise<Result<WorkspaceArchive>> {
	const root = await createTempWorkspaceRoot(runId)

	if (!root.ok) {
		return root
	}

	try {
		for (const file of selection.files) {
			const source = join(selection.projectRoot, file)
			const destination = join(root.value, file)

			await mkdir(dirname(destination), { recursive: true })
			await copyWorkspaceSnapshotEntry(source, destination)
		}

		return ok({ path: root.value })
	} catch (error) {
		await rm(root.value, { force: true, recursive: true })
		return fileSystemFailure("Could not create workspace snapshot.", error, {
			projectRoot: selection.projectRoot,
			path: root.value,
		})
	}
}

async function copyWorkspaceSnapshotEntry(source: string, destination: string): Promise<void> {
	const file = await lstat(source)

	if (file.isSymbolicLink()) {
		await symlink(await readlink(source), destination)
		return
	}

	await copyFile(source, destination)
}

async function createTempWorkspaceRoot(runId: RunId): Promise<Result<string>> {
	try {
		return ok(await mkdtemp(join(tmpdir(), `sando-${runId}-`)))
	} catch (error) {
		return fileSystemFailure("Could not create temporary workspace snapshot.", error, {
			runId: String(runId),
		})
	}
}

function runProjectCommandResult(input: {
	readonly artifacts: ArtifactBundle
	readonly command: RunProjectCommandInput
	readonly durationMs: number
	readonly exitCode: number | null
	readonly network: NetworkMode
	readonly runId: RunId
	readonly status: RunProjectCommandResult["status"]
	readonly timeoutSeconds: number
}): RunProjectCommandResult {
	const diffRef = input.artifacts.diffPath === undefined ? undefined : runDiffRef(input.runId)
	const changedFilesRef =
		input.artifacts.changedFilesPath === undefined ? undefined : runChangedFilesRef(input.runId)

	return {
		runId: input.runId,
		status: input.status,
		exitCode: input.exitCode,
		durationMs: input.durationMs,
		command: input.command.command,
		network: input.network,
		summary: summarizeRun(input),
		logsRef: runLogsRef(input.runId),
		stdoutRef: runStdoutRef(input.runId),
		stderrRef: runStderrRef(input.runId),
		...(diffRef === undefined ? {} : { diffRef }),
		...(changedFilesRef === undefined ? {} : { changedFilesRef }),
		artifacts: input.artifacts.artifacts.map((artifact) => ({
			id: asId("artifact", artifactIdForRunArtifact(input.runId, artifact.name)),
			name: artifact.name,
			uri: artifactUri(input.runId, artifact.name),
			...(artifact.contentType === undefined ? {} : { contentType: artifact.contentType }),
			...(artifact.sizeBytes === undefined ? {} : { sizeBytes: artifact.sizeBytes }),
		})),
		auditRef: runAuditRef(input.runId),
	}
}

function summarizeRun(input: {
	readonly command: RunProjectCommandInput
	readonly exitCode: number | null
	readonly status: RunProjectCommandResult["status"]
	readonly timeoutSeconds: number
}): string {
	switch (input.status) {
		case "succeeded":
			return `Command succeeded: ${input.command.command}`
		case "failed":
			return `Command failed with exit code ${input.exitCode ?? "unknown"}: ${input.command.command}`
		case "timed_out":
			return `Command timed out after ${input.timeoutSeconds} seconds: ${input.command.command}`
		case "cancelled":
			return `Command was cancelled: ${input.command.command}`
	}
}

function artifactUri(runId: RunId, name: string): SandoUri {
	return `sando://artifacts/${artifactIdForRunArtifact(runId, name)}`
}

function finishHostedRunInput(
	result: Result<RunProjectCommandResult>,
	runId: RunId,
	fallbackDurationMs: number,
): FinishHostedRunInput {
	if (result.ok) {
		return {
			runId,
			status: result.value.status,
			exitCode: result.value.exitCode,
			durationMs: result.value.durationMs,
		}
	}

	return {
		runId,
		status: result.error.code === "COMMAND_TIMED_OUT" ? "timed_out" : "failed",
		exitCode: null,
		durationMs: Math.max(0, fallbackDurationMs),
	}
}

async function readRunTextArtifact(
	runId: string,
	name: string,
	runsRootPath?: string,
): Promise<Result<string>> {
	const result = await readNamedRunArtifact(
		resolve(runsRootPath ?? projectRunArtifactsRootPath),
		runId,
		name,
	)

	if (!result.ok) {
		return result
	}

	return ok(result.value.content)
}

async function readRunArtifactById(
	runsRootPath: string,
	artifactId: string,
): Promise<Result<{ readonly artifact: RuntimeArtifact; readonly content: string }>> {
	try {
		const runsRootEntries = await lstat(runsRootPath)

		if (!runsRootEntries.isDirectory()) {
			return notFound("Sando runs path is not a directory.", { path: runsRootPath })
		}
	} catch (error) {
		return fileSystemFailure("Could not read runs path.", error, { path: runsRootPath })
	}

	const runDirectories = await listDirectoryNames(runsRootPath)

	if (!runDirectories.ok) {
		return runDirectories
	}

	for (const runId of runDirectories.value) {
		const artifacts = await listRunArtifacts(runsRootPath, runId)

		if (!artifacts.ok) {
			continue
		}

		for (const artifact of artifacts.value) {
			if (artifactIdForRunArtifact(runId, artifact.name) === artifactId) {
				const content = await readTextFileContent(artifact.path)
				return content.ok ? ok({ artifact, content: content.value }) : content
			}
		}
	}

	return notFound("Could not find sando artifact.", { artifactId })
}

async function readNamedRunArtifact(
	runsRootPath: string,
	runId: string,
	name: string,
): Promise<Result<{ readonly artifact: RuntimeArtifact; readonly content: string }>> {
	const artifacts = await listRunArtifacts(runsRootPath, runId)

	if (!artifacts.ok) {
		return artifacts
	}

	const artifact = artifacts.value.find((candidate) => candidate.name === name)

	if (artifact === undefined) {
		return notFound("Could not find run artifact.", { runId, name })
	}

	const content = await readTextFileContent(artifact.path)
	return content.ok ? ok({ artifact, content: content.value }) : content
}

async function listRunArtifacts(
	runsRootPath: string,
	runId: string,
): Promise<Result<RuntimeArtifact[]>> {
	const runRoot = join(runsRootPath, runId)

	return listArtifactsInRoot(runRoot)
}

async function listArtifactsInRoot(
	rootPath: string,
	currentPath: string = rootPath,
): Promise<Result<RuntimeArtifact[]>> {
	const names = await listDirectoryNames(currentPath)

	if (!names.ok) {
		return names
	}

	const artifacts: RuntimeArtifact[] = []

	for (const name of names.value) {
		const path = join(currentPath, name)
		const file = await lstat(path)

		if (file.isDirectory()) {
			const nested = await listArtifactsInRoot(rootPath, path)

			if (!nested.ok) {
				return nested
			}

			artifacts.push(...nested.value)
			continue
		}

		if (!file.isFile()) {
			continue
		}

		artifacts.push({
			name: relative(rootPath, path).split(sep).join("/"),
			path,
			sizeBytes: file.size,
		})
	}

	return ok(artifacts)
}

async function listDirectoryNames(path: string): Promise<Result<string[]>> {
	try {
		const entries = await readdir(path, { withFileTypes: true })
		return ok(entries.map((entry) => entry.name).sort())
	} catch (error) {
		return fileSystemFailure("Could not read directory.", error, { path })
	}
}

async function readTextFileContent(path: string): Promise<Result<string>> {
	try {
		return ok(await readFile(path, "utf8"))
	} catch (error) {
		return fileSystemFailure("Could not read sando artifact.", error, { path })
	}
}

async function readJsonFile(path: string): Promise<Result<unknown>> {
	const content = await readTextFileContent(path)

	if (!content.ok) {
		return content
	}

	try {
		return ok(JSON.parse(content.value) as unknown)
	} catch (error) {
		if (error instanceof SyntaxError) {
			return err(
				sandoError({
					code: "VALIDATION_FAILED",
					message: "Sando JSON artifact contains invalid JSON.",
					details: { path, message: error.message },
				}),
			)
		}

		throw error
	}
}

function notFound(message: string, details: Record<string, string>): Result<never> {
	return err(
		sandoError({
			code: "NOT_FOUND",
			message,
			details,
		}),
	)
}

function fileSystemFailure(
	message: string,
	error: unknown,
	details: Record<string, string>,
): Result<never> {
	return err(
		sandoError({
			code: isNodeError(error) && error.code === "ENOENT" ? "NOT_FOUND" : "INTERNAL",
			message,
			details: {
				...details,
				errorCode: isNodeError(error) && error.code !== undefined ? error.code : "UNKNOWN",
			},
		}),
	)
}

function policyLayers(input: CompileEffectivePolicyInput): readonly PolicyConstraints[] {
	return [
		input.systemPolicy ?? defaultSystemPolicyConstraints,
		input.hostedProjectPolicy,
		input.localProjectPolicy,
		input.templateDefaults ?? defaultNodeTsTemplatePolicyConstraints,
		input.grantConstraints,
	].filter((layer): layer is PolicyConstraints => layer !== undefined)
}

function selectRuntime(layers: readonly PolicyConstraints[]): Result<SandboxRuntimeKind> {
	const runtimes = uniqueValues(
		layers.flatMap((layer) => (layer.runtime === undefined ? [] : [layer.runtime])),
	)

	if (runtimes.length === 0) {
		return ok(defaultSandoPolicy.runtime)
	}

	if (runtimes.length > 1) {
		return policyViolation("Policy layers require incompatible runtimes.", {
			runtimes,
		})
	}

	return ok(runtimes[0] ?? defaultSandoPolicy.runtime)
}

function selectNetwork(
	requestedNetwork: NetworkMode | undefined,
	layers: readonly PolicyConstraints[],
	allowedNetworks: readonly NetworkMode[],
): Result<NetworkMode> {
	if (requestedNetwork !== undefined) {
		if (allowedNetworks.includes(requestedNetwork)) {
			return ok(requestedNetwork)
		}

		return policyViolation("Requested network mode is not allowed by policy.", {
			requestedNetwork,
			allowedNetworks,
		})
	}

	const defaultNetworks = layers.flatMap((layer) =>
		layer.defaultNetwork === undefined ? [] : [layer.defaultNetwork],
	)
	const defaultNetwork = mostRestrictiveNetwork(
		defaultNetworks.filter((network) => allowedNetworks.includes(network)),
	)

	return ok(
		defaultNetwork ?? mostRestrictiveNetwork(allowedNetworks) ?? defaultSandoPolicy.defaultNetwork,
	)
}

function intersectNetworks(sets: readonly (readonly NetworkMode[])[]): readonly NetworkMode[] {
	if (sets.length === 0) {
		return [...networkModes]
	}

	return networkModes.filter((mode) => sets.every((set) => set.includes(mode)))
}

function mostRestrictiveNetwork(networks: readonly NetworkMode[]): NetworkMode | undefined {
	return networkModes.find((mode) => networks.includes(mode))
}

function intersectStringSets(
	sets: readonly (readonly string[])[],
	fallback: readonly string[],
): readonly string[] {
	if (sets.length === 0) {
		return uniqueStrings(fallback)
	}

	const [firstSet, ...remainingSets] = sets

	if (firstSet === undefined) {
		return []
	}

	return uniqueStrings(firstSet).filter((value) =>
		remainingSets.every((set) => set.includes(value)),
	)
}

function unionStringSets(
	sets: readonly (readonly string[])[],
	fallback: readonly string[],
): readonly string[] {
	if (sets.length === 0) {
		return uniqueStrings(fallback)
	}

	return uniqueStrings(sets.flat())
}

function uniqueStrings(values: readonly string[]): string[] {
	return uniqueValues(values)
}

function uniqueValues<Value extends string>(values: readonly Value[]): Value[] {
	return [...new Set(values)]
}

function minPolicyNumber(values: readonly (number | undefined)[], fallback: number): number {
	const definedValues = values.filter((value): value is number => value !== undefined)
	return Math.min(...definedValues, fallback)
}

function policyViolation(message: string, details: Record<string, unknown>): Result<never> {
	return err(
		sandoError({
			code: "POLICY_VIOLATION",
			message,
			details: jsonRecord(details),
		}),
	)
}

function jsonRecord(
	record: Record<string, unknown>,
): Record<string, string | number | boolean | null | string[]> {
	return Object.fromEntries(
		Object.entries(record).map(([key, value]) => [
			key,
			Array.isArray(value) ? value.map(String) : jsonScalar(value),
		]),
	)
}

function jsonScalar(value: unknown): string | number | boolean | null {
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
		return value
	}

	return null
}

async function resolvePolicyProjectRoot(input: LoadProjectPolicyInput): Promise<Result<string>> {
	return resolveProjectRootPath(input)
}

async function resolveProjectRootPath(input: {
	readonly startPath?: string | undefined
	readonly projectRoot?: string | undefined
}): Promise<Result<string>> {
	if (input.projectRoot !== undefined) {
		return ok(resolve(input.projectRoot))
	}

	const projectRoot =
		input.startPath === undefined
			? await findProjectRoot()
			: await findProjectRoot({ startPath: input.startPath })

	if (!projectRoot.ok) {
		return err(projectRoot.error)
	}
	return ok(projectRoot.value.path)
}

async function readTextFile(path: string): Promise<Result<string>> {
	try {
		return ok(await readFile(path, "utf8"))
	} catch (error) {
		if (!isNodeError(error)) {
			throw error
		}

		if (error.code === "ENOENT") {
			return err(
				sandoError({
					code: "NOT_FOUND",
					message: "Sando policy file does not exist.",
					details: { path },
				}),
			)
		}

		if (error.code === "EACCES" || error.code === "EPERM") {
			return err(
				sandoError({
					code: "FORBIDDEN",
					message: "Sando policy file is not readable.",
					details: { path },
				}),
			)
		}

		if (error.code === "EISDIR") {
			return err(
				sandoError({
					code: "VALIDATION_FAILED",
					message: "Sando policy path is not a file.",
					details: { path },
				}),
			)
		}

		throw error
	}
}

function parseJsonFile(content: string, path: string): Result<unknown> {
	try {
		return ok(JSON.parse(content) as unknown)
	} catch (error) {
		if (error instanceof SyntaxError) {
			return err(
				sandoError({
					code: "VALIDATION_FAILED",
					message: "Sando policy file contains invalid JSON.",
					details: { path, message: error.message },
				}),
			)
		}

		throw error
	}
}

async function resolveStartDirectory(startPath: string): Promise<Result<string>> {
	const stat = await statPath(startPath)

	if (stat === undefined) {
		return err(
			sandoError({
				code: "NOT_FOUND",
				message: "Start path does not exist.",
				details: { startPath },
			}),
		)
	}

	if (stat.isDirectory()) {
		return ok(startPath)
	}

	return ok(dirname(startPath))
}

async function findFallbackRoot(directory: string): Promise<ProjectRoot | undefined> {
	const marker = await findExistingMarker(directory, projectRootFallbackMarkers)

	if (marker === undefined) {
		return undefined
	}

	return { path: directory, marker }
}

async function findExistingMarker<Marker extends ProjectRootMarker>(
	directory: string,
	markers: readonly Marker[],
): Promise<Marker | undefined> {
	for (const marker of markers) {
		const stat = await statPath(join(directory, marker))

		if (stat !== undefined && (await isValidProjectRootMarker(directory, marker))) {
			return marker
		}
	}

	return undefined
}

async function isValidProjectRootMarker(
	directory: string,
	marker: ProjectRootMarker,
): Promise<boolean> {
	if (marker !== ".git") {
		return true
	}

	try {
		const { stdout } = await execFileAsync(
			"git",
			["-C", directory, "rev-parse", "--show-toplevel"],
			{
				encoding: "utf8",
			},
		)

		return resolve(stdout.trim()) === resolve(directory)
	} catch (error) {
		if (isExecFileError(error)) {
			return false
		}

		throw error
	}
}

async function statPath(path: string) {
	try {
		return await lstat(path)
	} catch (error) {
		if (isNodeError(error) && error.code === "ENOENT") {
			return undefined
		}

		throw error
	}
}

function* ancestorDirectories(startDirectory: string): Generator<string> {
	let current = isAbsolute(startDirectory) ? startDirectory : resolve(startDirectory)
	const root = parsePath(current).root

	while (true) {
		yield current

		if (current === root) {
			return
		}

		current = dirname(current)
	}
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error
}

type ExecFileError = NodeJS.ErrnoException & {
	readonly stdout?: string | Buffer
	readonly stderr?: string | Buffer
}

function isExecFileError(error: unknown): error is ExecFileError {
	return error instanceof Error && ("code" in error || "stderr" in error)
}

function execOutputToString(output: string | Buffer | undefined): string {
	if (output === undefined) {
		return ""
	}

	return Buffer.isBuffer(output) ? output.toString("utf8") : output
}
