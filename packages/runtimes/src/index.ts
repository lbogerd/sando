import { execFile } from "node:child_process"
import type { ExecFileOptionsWithStringEncoding } from "node:child_process"
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import { release as currentOsRelease } from "node:os"
import { join, relative, resolve, sep } from "node:path"
import { promisify } from "node:util"

import { z } from "zod"

import type {
	JsonValue,
	NetworkMode,
	ResourceLimits,
	Result,
	RunId,
	SandboxRuntimeKind,
	SandoError,
} from "@sando/shared"
import {
	err,
	networkModeSchema,
	ok,
	resourceLimitsSchema,
	runProjectCommandStatusSchema,
	sandboxRuntimeKindSchema,
	sandoError,
} from "@sando/shared"

export const packageName = "runtimes"

const execFileAsync = promisify(execFile)

export const defaultPodmanExecutable = "podman"
export const defaultNodeTsPodmanImage = "localhost/sando-node-ts:local"
export const defaultPodmanRunnerPath = "/sando/runner/run.sh"
export const defaultPodmanWorkspacePath = "/workspace"
export const defaultPodmanArtifactPath = "/artifacts"
export const defaultPodmanRunsRootPath = ".sando/runs"
export const defaultPodmanDiagnosticsTimeoutMs = 5000

const jsonValueSchema = z.custom<JsonValue>()
const runIdSchema = z.custom<RunId>((value) => typeof value === "string")

export const sandboxHandleSchema = z.object({
	id: z.string(),
	runtime: sandboxRuntimeKindSchema,
	runId: runIdSchema,
	metadata: jsonValueSchema.optional(),
})

export type SandboxHandle = z.infer<typeof sandboxHandleSchema>

export const workspaceArchiveSchema = z.object({
	path: z.string(),
	sizeBytes: z.number().optional(),
	sha256: z.string().optional(),
})

export type WorkspaceArchive = z.infer<typeof workspaceArchiveSchema>

export const createSandboxInputSchema = z.object({
	runId: runIdSchema,
	template: z.string(),
	runtime: sandboxRuntimeKindSchema,
	network: networkModeSchema,
	resources: resourceLimitsSchema,
	timeoutSeconds: z.number(),
	workdir: z.string().optional(),
	artifactDir: z.string().optional(),
	environment: z.record(z.string(), z.string()).optional(),
})

export type CreateSandboxInput = z.infer<typeof createSandboxInputSchema>

export const commandSpecSchema = z.object({
	command: z.string(),
	cwd: z.string().optional(),
	env: z.record(z.string(), z.string()).optional(),
	timeoutSeconds: z.number().optional(),
})

export type CommandSpec = z.infer<typeof commandSpecSchema>

export const sandboxCommandStatusSchema = runProjectCommandStatusSchema

export type SandboxCommandStatus = z.infer<typeof sandboxCommandStatusSchema>

export const runResultSchema = z.object({
	status: sandboxCommandStatusSchema,
	exitCode: z.number().nullable(),
	stdout: z.string(),
	stderr: z.string(),
	logs: z.string(),
	startedAt: z.string(),
	finishedAt: z.string(),
	durationMs: z.number(),
})

export type RunResult = z.infer<typeof runResultSchema>

export const runtimeResultJsonSchema = z.object({
	runId: z.string(),
	runtime: sandboxRuntimeKindSchema,
	command: z.string(),
	status: sandboxCommandStatusSchema,
	exitCode: z.number().nullable(),
	startedAt: z.string(),
	finishedAt: z.string(),
	durationMs: z.number(),
	network: networkModeSchema.optional(),
	artifacts: z.object({
		logs: z.literal("logs.txt"),
		stdout: z.literal("stdout.txt"),
		stderr: z.literal("stderr.txt"),
		diff: z.literal("diff.patch"),
		changedFiles: z.literal("changed-files.txt"),
	}),
})

export type RuntimeResultJson = z.infer<typeof runtimeResultJsonSchema>

export const runtimeArtifactSchema = z.object({
	name: z.string(),
	path: z.string(),
	contentType: z.string().optional(),
	sizeBytes: z.number().optional(),
})

export type RuntimeArtifact = z.infer<typeof runtimeArtifactSchema>

export const artifactBundleSchema = z.object({
	rootPath: z.string(),
	artifacts: z.array(runtimeArtifactSchema),
	resultPath: z.string().optional(),
	logsPath: z.string().optional(),
	diffPath: z.string().optional(),
	changedFilesPath: z.string().optional(),
})

export type ArtifactBundle = z.infer<typeof artifactBundleSchema>

export interface SandboxRuntime {
	readonly kind: SandboxRuntimeKind

	createSandbox(input: CreateSandboxInput): Promise<Result<SandboxHandle>>
	uploadWorkspace(handle: SandboxHandle, archive: WorkspaceArchive): Promise<Result<void>>
	runCommand(handle: SandboxHandle, command: CommandSpec): Promise<Result<RunResult>>
	collectArtifacts(handle: SandboxHandle): Promise<Result<ArtifactBundle>>
	destroySandbox(handle: SandboxHandle): Promise<Result<void>>
}

export async function withSandboxCleanup<Value>(
	runtime: SandboxRuntime,
	handle: SandboxHandle,
	operation: (handle: SandboxHandle) => Promise<Result<Value>>,
): Promise<Result<Value>> {
	let operationResult: Result<Value> | undefined
	let operationError: unknown

	try {
		operationResult = await operation(handle)
	} catch (error) {
		operationError = error
	}

	let cleanupResult: Result<void> | undefined
	let cleanupError: unknown

	try {
		cleanupResult = await runtime.destroySandbox(handle)
	} catch (error) {
		cleanupError = error
	}

	if (operationError !== undefined) {
		throw operationError
	}

	if (operationResult !== undefined && !operationResult.ok) {
		return operationResult
	}

	if (cleanupError !== undefined) {
		throw cleanupError
	}

	if (cleanupResult !== undefined && !cleanupResult.ok) {
		return err(cleanupResult.error)
	}

	if (operationResult === undefined) {
		throw new Error("Sandbox operation did not produce a result.")
	}

	return operationResult
}

export const podmanCommandOptionsSchema = z.object({
	cwd: z.string().optional(),
	timeoutMs: z.number().optional(),
})

export type PodmanCommandOptions = z.infer<typeof podmanCommandOptionsSchema>

export const podmanCommandResultSchema = z.object({
	exitCode: z.number().nullable(),
	stdout: z.string(),
	stderr: z.string(),
	timedOut: z.boolean().optional(),
	signal: z.string().optional(),
})

export type PodmanCommandResult = z.infer<typeof podmanCommandResultSchema>

export type PodmanCommandRunner = (
	command: string,
	args: readonly string[],
	options?: PodmanCommandOptions,
) => Promise<Result<PodmanCommandResult>>

export const podmanBuildImageSourceSchema = z.object({
	kind: z.literal("build"),
	contextPath: z.string(),
	containerfilePath: z.string().optional(),
	buildArgs: z.record(z.string(), z.string()).optional(),
})

export type PodmanBuildImageSource = z.infer<typeof podmanBuildImageSourceSchema>

export const podmanPullImageSourceSchema = z.object({
	kind: z.literal("pull"),
})

export type PodmanPullImageSource = z.infer<typeof podmanPullImageSourceSchema>

export const podmanImageSourceSchema = z.discriminatedUnion("kind", [
	podmanBuildImageSourceSchema,
	podmanPullImageSourceSchema,
])

export type PodmanImageSource = z.infer<typeof podmanImageSourceSchema>

export const podmanImageActionSchema = z.enum(["existing", "built", "pulled"])

export type PodmanImageAction = z.infer<typeof podmanImageActionSchema>

export const ensurePodmanImageInputSchema = z.object({
	image: z.string(),
	source: podmanImageSourceSchema,
	podmanExecutable: z.string().optional(),
	commandRunner: z.custom<PodmanCommandRunner>().optional(),
})

export type EnsurePodmanImageInput = z.infer<typeof ensurePodmanImageInputSchema>

export const podmanImageRefSchema = z.object({
	image: z.string(),
	action: podmanImageActionSchema,
	stdout: z.string(),
	stderr: z.string(),
})

export type PodmanImageRef = z.infer<typeof podmanImageRefSchema>

export const podmanDiagnosticStatusSchema = z.enum(["pass", "warn", "fail"])

export type PodmanDiagnosticStatus = z.infer<typeof podmanDiagnosticStatusSchema>

export const podmanDiagnosticCheckSchema = z.object({
	name: z.string(),
	status: podmanDiagnosticStatusSchema,
	message: z.string(),
	details: jsonValueSchema.optional(),
})

export type PodmanDiagnosticCheck = z.infer<typeof podmanDiagnosticCheckSchema>

export const wslDiagnosticsSchema = z.object({
	detected: z.boolean(),
	platform: z.string(),
	osRelease: z.string(),
	sources: z.array(z.string()),
	interopAvailable: z.boolean(),
	distroName: z.string().optional(),
})

export type WslDiagnostics = z.infer<typeof wslDiagnosticsSchema>

export const podmanDiagnosticsSchema = z.object({
	podmanExecutable: z.string(),
	wsl: wslDiagnosticsSchema,
	checks: z.array(podmanDiagnosticCheckSchema),
})

export type PodmanDiagnostics = z.infer<typeof podmanDiagnosticsSchema>

export const diagnosePodmanEnvironmentInputSchema = z.object({
	podmanExecutable: z.string().optional(),
	commandRunner: z.custom<PodmanCommandRunner>().optional(),
	environment: z.record(z.string(), z.string().optional()).optional(),
	platform: z.string().optional(),
	osRelease: z.string().optional(),
	procVersion: z.string().optional(),
	timeoutMs: z.number().optional(),
})

export type DiagnosePodmanEnvironmentInput = z.infer<typeof diagnosePodmanEnvironmentInputSchema>

export const podmanRuntimeOptionsSchema = z.object({
	image: z.string().optional(),
	imageSource: podmanImageSourceSchema.optional(),
	podmanExecutable: z.string().optional(),
	commandRunner: z.custom<PodmanCommandRunner>().optional(),
	runnerPath: z.string().optional(),
	workspacePath: z.string().optional(),
	artifactPath: z.string().optional(),
	runsRootPath: z.string().optional(),
})

export type PodmanRuntimeOptions = z.infer<typeof podmanRuntimeOptionsSchema>

export class PodmanRuntime implements SandboxRuntime {
	readonly kind = "podman" as const

	private readonly command: string
	private readonly runner: PodmanCommandRunner
	private readonly image: string
	private readonly imageSource: PodmanImageSource | undefined
	private readonly runnerPath: string
	private readonly workspacePath: string
	private readonly artifactPath: string
	private readonly runsRootPath: string
	private readonly resultsByRunId = new Map<string, RuntimeResultJson>()

	constructor(options: PodmanRuntimeOptions = {}) {
		this.command = options.podmanExecutable ?? defaultPodmanExecutable
		this.runner = options.commandRunner ?? defaultPodmanCommandRunner
		this.image = options.image ?? defaultNodeTsPodmanImage
		this.imageSource = options.imageSource
		this.runnerPath = options.runnerPath ?? defaultPodmanRunnerPath
		this.workspacePath = options.workspacePath ?? defaultPodmanWorkspacePath
		this.artifactPath = options.artifactPath ?? defaultPodmanArtifactPath
		this.runsRootPath = resolve(options.runsRootPath ?? defaultPodmanRunsRootPath)
	}

	async createSandbox(input: CreateSandboxInput): Promise<Result<SandboxHandle>> {
		if (input.runtime !== "podman") {
			return err(
				sandoError({
					code: "POLICY_VIOLATION",
					message: "PodmanRuntime can only create podman sandboxes.",
					details: { runtime: input.runtime },
				}),
			)
		}

		const image = await this.resolveImage()

		if (!image.ok) {
			return image
		}

		const name = podmanSandboxName(input.runId)
		const workdir = input.workdir ?? this.workspacePath
		const artifactDir = input.artifactDir ?? this.artifactPath
		const createArgs = podmanCreateArgs({
			artifactDir,
			environment: input.environment,
			image: image.value.image,
			name,
			network: input.network,
			resources: input.resources,
			workdir,
		})
		const create = await this.runner(this.command, createArgs)

		if (!create.ok) {
			return create
		}

		if (create.value.exitCode !== 0) {
			return podmanImageFailure(
				"Could not create Podman sandbox.",
				this.command,
				createArgs,
				create.value,
			)
		}

		const startArgs = ["start", name]
		const start = await this.runner(this.command, startArgs)

		if (!start.ok) {
			await cleanupPodmanContainer(this.command, this.runner, name)
			return start
		}

		if (start.value.exitCode !== 0) {
			await cleanupPodmanContainer(this.command, this.runner, name)
			return podmanImageFailure(
				"Could not start Podman sandbox.",
				this.command,
				startArgs,
				start.value,
			)
		}

		return ok({
			id: create.value.stdout.trim() || name,
			runtime: "podman",
			runId: input.runId,
			metadata: {
				artifactDir,
				image: image.value.image,
				name,
				network: input.network,
				resources: input.resources,
				timeoutSeconds: input.timeoutSeconds,
				workdir,
			},
		})
	}

	async uploadWorkspace(handle: SandboxHandle, archive: WorkspaceArchive): Promise<Result<void>> {
		const container = podmanContainerName(handle)

		if (!container.ok) {
			return container
		}

		const source = await podmanWorkspaceCopySource(archive.path)

		if (!source.ok) {
			return source
		}

		const args = [
			"cp",
			source.value,
			podmanWorkspaceCopyTarget(container.value, podmanWorkspaceDir(handle, this.workspacePath)),
		]
		const result = await this.runner(this.command, args)

		if (!result.ok) {
			return result
		}

		if (result.value.exitCode !== 0) {
			return podmanImageFailure(
				"Could not upload workspace to Podman sandbox.",
				this.command,
				args,
				result.value,
			)
		}

		return ok(undefined)
	}

	async runCommand(handle: SandboxHandle, command: CommandSpec): Promise<Result<RunResult>> {
		const container = podmanContainerName(handle)

		if (!container.ok) {
			return container
		}

		const startedAt = new Date()
		const args = podmanExecArgs({
			command,
			container: container.value,
			runnerPath: this.runnerPath,
		})
		const result = await this.runner(
			this.command,
			args,
			podmanTimeoutOptions(podmanCommandTimeoutSeconds(handle, command)),
		)
		const finishedAt = new Date()

		if (!result.ok) {
			return result
		}

		const runResult = {
			status: podmanCommandStatus(result.value),
			exitCode: result.value.exitCode,
			stdout: result.value.stdout,
			stderr: result.value.stderr,
			logs: combinedLogs(result.value),
			startedAt: startedAt.toISOString(),
			finishedAt: finishedAt.toISOString(),
			durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
		}
		const resultJson = runtimeResultJson(handle, command, runResult)
		const written = await writeRuntimeResultJson(
			runArtifactsPath(this.runsRootPath, handle.runId),
			resultJson,
		)

		if (!written.ok) {
			return written
		}

		this.resultsByRunId.set(String(handle.runId), resultJson)

		return ok(runResult)
	}

	async collectArtifacts(handle: SandboxHandle): Promise<Result<ArtifactBundle>> {
		const container = podmanContainerName(handle)

		if (!container.ok) {
			return container
		}

		const rootPath = runArtifactsPath(this.runsRootPath, handle.runId)
		const prepared = await prepareRunArtifactsRoot(rootPath)

		if (!prepared.ok) {
			return prepared
		}

		const args = [
			"cp",
			podmanArtifactCopySource(container.value, podmanArtifactDir(handle, this.artifactPath)),
			rootPath,
		]
		const result = await this.runner(this.command, args)

		if (!result.ok) {
			return result
		}

		if (result.value.exitCode !== 0) {
			return podmanImageFailure(
				"Could not copy Podman artifacts.",
				this.command,
				args,
				result.value,
			)
		}

		const resultJson = this.resultsByRunId.get(String(handle.runId))

		if (resultJson !== undefined) {
			const written = await writeRuntimeResultJson(rootPath, resultJson)

			if (!written.ok) {
				return written
			}
		}

		return artifactBundle(rootPath)
	}

	async destroySandbox(handle: SandboxHandle): Promise<Result<void>> {
		const container = podmanContainerName(handle)

		if (!container.ok) {
			return container
		}

		const args = ["rm", "--force", container.value]
		const result = await this.runner(this.command, args)

		if (!result.ok) {
			return result
		}

		if (result.value.exitCode !== 0) {
			return podmanImageFailure(
				"Could not destroy Podman sandbox.",
				this.command,
				args,
				result.value,
			)
		}

		return ok(undefined)
	}

	private async resolveImage(): Promise<Result<PodmanImageRef>> {
		if (this.imageSource === undefined) {
			return ok({
				image: this.image,
				action: "existing",
				stdout: "",
				stderr: "",
			})
		}

		return ensurePodmanImage({
			image: this.image,
			source: this.imageSource,
			podmanExecutable: this.command,
			commandRunner: this.runner,
		})
	}
}

export async function ensurePodmanImage(
	input: EnsurePodmanImageInput,
): Promise<Result<PodmanImageRef>> {
	const command = input.podmanExecutable ?? defaultPodmanExecutable
	const runner = input.commandRunner ?? defaultPodmanCommandRunner
	const exists = await runner(command, ["image", "exists", input.image])

	if (!exists.ok) {
		return exists
	}

	if (exists.value.exitCode === 0) {
		return ok({
			image: input.image,
			action: "existing",
			stdout: exists.value.stdout,
			stderr: exists.value.stderr,
		})
	}

	if (exists.value.exitCode !== 1) {
		return podmanImageFailure(
			"Could not inspect Podman image.",
			command,
			["image", "exists", input.image],
			exists.value,
		)
	}

	switch (input.source.kind) {
		case "build":
			return buildPodmanImage(command, runner, input.image, input.source)
		case "pull":
			return pullPodmanImage(command, runner, input.image)
	}
}

export async function defaultPodmanCommandRunner(
	command: string,
	args: readonly string[],
	options: PodmanCommandOptions = {},
): Promise<Result<PodmanCommandResult>> {
	const execOptions: ExecFileOptionsWithStringEncoding = {
		encoding: "utf8",
		maxBuffer: 128 * 1024 * 1024,
	}

	if (options.cwd !== undefined) {
		execOptions.cwd = options.cwd
	}

	if (options.timeoutMs !== undefined) {
		execOptions.timeout = options.timeoutMs
	}

	try {
		const result = await execFileAsync(command, [...args], execOptions)

		return ok({
			exitCode: 0,
			stdout: result.stdout,
			stderr: result.stderr,
		})
	} catch (error) {
		if (!isExecFileError(error)) {
			throw error
		}

		if (isExecFileTimeout(error, options)) {
			return ok(podmanTimedOutResult(error))
		}

		if (typeof error.code === "number") {
			return ok({
				exitCode: error.code,
				stdout: execOutputToString(error.stdout),
				stderr: execOutputToString(error.stderr),
			})
		}

		return err(
			sandoError({
				code: "RUNTIME_UNAVAILABLE",
				message: "Podman executable is not available.",
				details: {
					command,
					args: [...args],
					errorCode: typeof error.code === "string" ? error.code : "UNKNOWN",
				},
			}),
		)
	}
}

export async function diagnosePodmanEnvironment(
	input: DiagnosePodmanEnvironmentInput = {},
): Promise<Result<PodmanDiagnostics>> {
	const command = input.podmanExecutable ?? defaultPodmanExecutable
	const runner = input.commandRunner ?? defaultPodmanCommandRunner
	const timeoutMs = input.timeoutMs ?? defaultPodmanDiagnosticsTimeoutMs
	const wsl = await detectWslEnvironment(input)
	const checks: PodmanDiagnosticCheck[] = [wslDiagnosticCheck(wsl)]
	const versionArgs = ["--version"]
	const version = await runner(command, versionArgs, { timeoutMs })

	checks.push(podmanVersionDiagnosticCheck(command, versionArgs, version))

	if (!isSuccessfulPodmanCommand(version)) {
		return ok({
			podmanExecutable: command,
			wsl,
			checks,
		})
	}

	const infoArgs = ["info", "--format", "json"]
	const info = await runner(command, infoArgs, { timeoutMs })

	if (!info.ok) {
		checks.push(
			podmanRunnerErrorCheck(
				"podman.info",
				"Could not run podman info.",
				command,
				infoArgs,
				info.error,
			),
		)
	} else if (info.value.exitCode !== 0) {
		checks.push(
			podmanCommandExitCheck("podman.info", "podman info failed.", command, infoArgs, info.value),
		)
	} else {
		const summary = parsePodmanInfoSummary(info.value.stdout)

		if (!summary.ok) {
			checks.push({
				name: "podman.info",
				status: "warn",
				message: "Podman info ran but did not return JSON diagnostics.",
				details: {
					command,
					args: infoArgs,
					errorMessage: summary.error.message,
				},
			})
		} else {
			checks.push({
				name: "podman.info",
				status: "pass",
				message: "Podman info is available.",
				details: podmanInfoSummaryDetails(summary.value),
			})
			checks.push(podmanRootlessDiagnosticCheck(summary.value))
		}
	}

	return ok({
		podmanExecutable: command,
		wsl,
		checks,
	})
}

async function buildPodmanImage(
	command: string,
	runner: PodmanCommandRunner,
	image: string,
	source: PodmanBuildImageSource,
): Promise<Result<PodmanImageRef>> {
	const args = podmanBuildArgs(image, source)
	const result = await runner(command, args, { cwd: source.contextPath })

	if (!result.ok) {
		return result
	}

	if (result.value.exitCode !== 0) {
		return podmanImageFailure("Could not build Podman image.", command, args, result.value, {
			cwd: source.contextPath,
		})
	}

	return ok({
		image,
		action: "built",
		stdout: result.value.stdout,
		stderr: result.value.stderr,
	})
}

async function pullPodmanImage(
	command: string,
	runner: PodmanCommandRunner,
	image: string,
): Promise<Result<PodmanImageRef>> {
	const args = ["pull", image]
	const result = await runner(command, args)

	if (!result.ok) {
		return result
	}

	if (result.value.exitCode !== 0) {
		return podmanImageFailure("Could not pull Podman image.", command, args, result.value)
	}

	return ok({
		image,
		action: "pulled",
		stdout: result.value.stdout,
		stderr: result.value.stderr,
	})
}

async function cleanupPodmanContainer(
	command: string,
	runner: PodmanCommandRunner,
	container: string,
): Promise<void> {
	try {
		await runner(command, ["rm", "--force", container])
	} catch {
		// Preserve the original lifecycle failure; later orchestration can report cleanup health.
	}
}

function podmanBuildArgs(image: string, source: PodmanBuildImageSource): readonly string[] {
	const args = ["build", "--tag", image]

	if (source.containerfilePath !== undefined) {
		args.push("--file", source.containerfilePath)
	}

	for (const [name, value] of Object.entries(source.buildArgs ?? {}).sort(([left], [right]) =>
		left.localeCompare(right),
	)) {
		args.push("--build-arg", `${name}=${value}`)
	}

	args.push(source.contextPath)

	return args
}

const podmanCreateArgsInputSchema = z.object({
	artifactDir: z.string(),
	environment: z.record(z.string(), z.string()).optional(),
	image: z.string(),
	name: z.string(),
	network: networkModeSchema,
	resources: resourceLimitsSchema,
	workdir: z.string(),
})

type PodmanCreateArgsInput = z.infer<typeof podmanCreateArgsInputSchema>

function podmanCreateArgs(input: PodmanCreateArgsInput): readonly string[] {
	return [
		"create",
		"--name",
		input.name,
		...podmanNetworkArgs(input.network),
		...podmanResourceArgs(input.resources),
		"--workdir",
		input.workdir,
		...podmanEnvArgs({
			...input.environment,
			SANDO_ARTIFACTS: input.artifactDir,
			SANDO_WORKSPACE: input.workdir,
		}),
		input.image,
		"sleep",
		"infinity",
	]
}

function podmanNetworkArgs(network: NetworkMode): readonly string[] {
	return network === "none" ? ["--network", "none"] : []
}

function podmanResourceArgs(resources: ResourceLimits): readonly string[] {
	return ["--cpus", String(resources.cpu), "--memory", `${resources.memoryMb}m`]
}

const podmanExecArgsInputSchema = z.object({
	command: commandSpecSchema,
	container: z.string(),
	runnerPath: z.string(),
})

type PodmanExecArgsInput = z.infer<typeof podmanExecArgsInputSchema>

function podmanExecArgs(input: PodmanExecArgsInput): readonly string[] {
	return [
		"exec",
		...podmanEnvArgs(input.command.env),
		...podmanWorkdirArgs(input.command.cwd),
		input.container,
		input.runnerPath,
		"bash",
		"-lc",
		input.command.command,
	]
}

function podmanEnvArgs(
	environment: Readonly<Record<string, string>> | undefined,
): readonly string[] {
	return Object.entries(environment ?? {})
		.sort(([left], [right]) => left.localeCompare(right))
		.flatMap(([name, value]) => ["--env", `${name}=${value}`])
}

function podmanWorkdirArgs(workdir: string | undefined): readonly string[] {
	return workdir === undefined ? [] : ["--workdir", workdir]
}

function podmanArtifactDir(handle: SandboxHandle, fallback: string): string {
	if (isRecord(handle.metadata) && typeof handle.metadata.artifactDir === "string") {
		return handle.metadata.artifactDir
	}

	return fallback
}

function podmanArtifactCopySource(container: string, artifactDir: string): string {
	return `${container}:${artifactDir.replace(/\/+$/, "")}/.`
}

function podmanWorkspaceDir(handle: SandboxHandle, fallback: string): string {
	if (isRecord(handle.metadata) && typeof handle.metadata.workdir === "string") {
		return handle.metadata.workdir
	}

	return fallback
}

async function podmanWorkspaceCopySource(path: string): Promise<Result<string>> {
	try {
		const pathStat = await stat(path)

		return ok(pathStat.isDirectory() ? `${path.replace(/\/+$/, "")}/.` : path)
	} catch (error) {
		return fileSystemFailure("Could not read workspace archive path.", error, { path })
	}
}

function podmanWorkspaceCopyTarget(container: string, workspaceDir: string): string {
	return `${container}:${workspaceDir.replace(/\/+$/, "")}/`
}

function runArtifactsPath(runsRootPath: string, runId: RunId): string {
	return join(runsRootPath, String(runId))
}

async function prepareRunArtifactsRoot(rootPath: string): Promise<Result<void>> {
	try {
		await rm(rootPath, { force: true, recursive: true })
		await mkdir(rootPath, { recursive: true })
		return ok(undefined)
	} catch (error) {
		return fileSystemFailure("Could not prepare run artifact directory.", error, {
			rootPath,
		})
	}
}

function runtimeResultJson(
	handle: SandboxHandle,
	command: CommandSpec,
	result: RunResult,
): RuntimeResultJson {
	const network = metadataNetworkMode(handle)
	const json = {
		runId: String(handle.runId),
		runtime: handle.runtime,
		command: command.command,
		status: result.status,
		exitCode: result.exitCode,
		startedAt: result.startedAt,
		finishedAt: result.finishedAt,
		durationMs: result.durationMs,
		artifacts: {
			logs: "logs.txt",
			stdout: "stdout.txt",
			stderr: "stderr.txt",
			diff: "diff.patch",
			changedFiles: "changed-files.txt",
		},
	} satisfies RuntimeResultJson

	return network === undefined ? json : { ...json, network }
}

async function writeRuntimeResultJson(
	rootPath: string,
	result: RuntimeResultJson,
): Promise<Result<string>> {
	try {
		await mkdir(rootPath, { recursive: true })

		const path = join(rootPath, "result.json")
		await writeFile(path, `${JSON.stringify(result, null, "\t")}\n`, "utf8")
		return ok(path)
	} catch (error) {
		return fileSystemFailure("Could not write run result file.", error, {
			rootPath,
		})
	}
}

async function artifactBundle(rootPath: string): Promise<Result<ArtifactBundle>> {
	try {
		const artifacts = await listRuntimeArtifacts(rootPath)
		const bundle: {
			rootPath: string
			artifacts: RuntimeArtifact[]
			resultPath?: string
			logsPath?: string
			diffPath?: string
			changedFilesPath?: string
		} = {
			rootPath,
			artifacts,
		}

		for (const artifact of artifacts) {
			switch (artifact.name) {
				case "result.json":
					bundle.resultPath = artifact.path
					break
				case "logs.txt":
					bundle.logsPath = artifact.path
					break
				case "diff.patch":
					bundle.diffPath = artifact.path
					break
				case "changed-files.txt":
					bundle.changedFilesPath = artifact.path
					break
			}
		}

		return ok(bundle)
	} catch (error) {
		return fileSystemFailure("Could not read copied artifact directory.", error, {
			rootPath,
		})
	}
}

async function listRuntimeArtifacts(
	rootPath: string,
	currentPath: string = rootPath,
): Promise<RuntimeArtifact[]> {
	const entries = await readdir(currentPath, { withFileTypes: true })
	const artifacts: RuntimeArtifact[] = []

	for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
		const path = join(currentPath, entry.name)

		if (entry.isDirectory()) {
			artifacts.push(...(await listRuntimeArtifacts(rootPath, path)))
			continue
		}

		if (!entry.isFile()) {
			continue
		}

		const file = await stat(path)
		const name = relative(rootPath, path).split(sep).join("/")
		const contentType = artifactContentType(name)

		artifacts.push({
			name,
			path,
			sizeBytes: file.size,
			...(contentType === undefined ? {} : { contentType }),
		})
	}

	return artifacts
}

function artifactContentType(name: string): string | undefined {
	if (name.endsWith(".json")) {
		return "application/json"
	}

	if (name.endsWith(".patch") || name.endsWith(".txt")) {
		return "text/plain"
	}

	return undefined
}

function podmanCommandTimeoutSeconds(
	handle: SandboxHandle,
	command: CommandSpec,
): number | undefined {
	if (command.timeoutSeconds !== undefined) {
		return command.timeoutSeconds
	}

	if (isRecord(handle.metadata) && typeof handle.metadata.timeoutSeconds === "number") {
		return handle.metadata.timeoutSeconds
	}

	return undefined
}

function podmanTimeoutOptions(
	timeoutSeconds: number | undefined,
): PodmanCommandOptions | undefined {
	if (timeoutSeconds === undefined) {
		return undefined
	}

	return { timeoutMs: timeoutSeconds * 1000 }
}

function podmanCommandStatus(result: PodmanCommandResult): SandboxCommandStatus {
	if (result.timedOut === true) {
		return "timed_out"
	}

	return result.exitCode === 0 ? "succeeded" : "failed"
}

function podmanSandboxName(runId: RunId): string {
	return `sando-run-${String(runId).replaceAll(/[^a-zA-Z0-9_.-]/g, "-")}`
}

function podmanContainerName(handle: SandboxHandle): Result<string> {
	if (handle.runtime !== "podman") {
		return err(
			sandoError({
				code: "SANDBOX_FAILED",
				message: "Sandbox handle does not belong to the Podman runtime.",
				details: { runtime: handle.runtime },
			}),
		)
	}

	if (isRecord(handle.metadata) && typeof handle.metadata.name === "string") {
		return ok(handle.metadata.name)
	}

	return ok(handle.id)
}

function metadataNetworkMode(handle: SandboxHandle): NetworkMode | undefined {
	if (!isRecord(handle.metadata)) {
		return undefined
	}

	return handle.metadata.network === "none" || handle.metadata.network === "default"
		? handle.metadata.network
		: undefined
}

function combinedLogs(result: PodmanCommandResult): string {
	return [result.stdout, result.stderr].filter((value) => value.length > 0).join("")
}

function fileSystemFailure(
	message: string,
	error: unknown,
	details: Record<string, JsonValue>,
): Result<never> {
	return err(
		sandoError({
			code: "INTERNAL",
			message,
			details: {
				...details,
				errorCode: isNodeError(error) && error.code !== undefined ? error.code : "UNKNOWN",
				errorMessage: error instanceof Error ? error.message : String(error),
			},
		}),
	)
}

function podmanImageFailure(
	message: string,
	command: string,
	args: readonly string[],
	result: PodmanCommandResult,
	options: PodmanCommandOptions = {},
): Result<never> {
	return err(
		sandoError({
			code: "SANDBOX_FAILED",
			message,
			details: commandFailureDetails(command, args, result, options),
		}),
	)
}

function commandFailureDetails(
	command: string,
	args: readonly string[],
	result: PodmanCommandResult,
	options: PodmanCommandOptions,
): JsonValue {
	const details: Record<string, JsonValue> = {
		command,
		args: [...args],
		exitCode: result.exitCode,
		stderr: result.stderr,
	}

	if (options.cwd !== undefined) {
		details.cwd = options.cwd
	}

	if (options.timeoutMs !== undefined) {
		details.timeoutMs = options.timeoutMs
	}

	if (result.timedOut === true) {
		details.timedOut = true
	}

	if (result.signal !== undefined) {
		details.signal = result.signal
	}

	return details
}

async function detectWslEnvironment(
	input: DiagnosePodmanEnvironmentInput,
): Promise<WslDiagnostics> {
	const environment = input.environment ?? process.env
	const platform = input.platform ?? process.platform
	const osRelease = input.osRelease ?? currentOsRelease()
	const procVersion =
		input.procVersion ?? (platform === "linux" ? await readLinuxProcVersion() : "")
	const sources: string[] = []

	if (environment.WSL_DISTRO_NAME !== undefined) {
		sources.push("WSL_DISTRO_NAME")
	}

	if (environment.WSL_INTEROP !== undefined) {
		sources.push("WSL_INTEROP")
	}

	if (containsWslMarker(osRelease)) {
		sources.push("os.release")
	}

	if (containsWslMarker(procVersion)) {
		sources.push("/proc/version")
	}

	const diagnostics: WslDiagnostics = {
		detected: sources.length > 0,
		platform,
		osRelease,
		sources,
		interopAvailable: environment.WSL_INTEROP !== undefined,
	}

	return environment.WSL_DISTRO_NAME === undefined
		? diagnostics
		: { ...diagnostics, distroName: environment.WSL_DISTRO_NAME }
}

function wslDiagnosticCheck(wsl: WslDiagnostics): PodmanDiagnosticCheck {
	if (wsl.detected) {
		return {
			name: "wsl",
			status: "pass",
			message: "WSL environment detected.",
			details: wslDiagnosticDetails(wsl),
		}
	}

	if (wsl.platform === "linux") {
		return {
			name: "wsl",
			status: "pass",
			message: "WSL was not detected; plain Linux hosts can use the same Podman runtime.",
			details: wslDiagnosticDetails(wsl),
		}
	}

	return {
		name: "wsl",
		status: "warn",
		message: "WSL or Linux was not detected; the MVP Podman runtime targets Linux and WSL.",
		details: wslDiagnosticDetails(wsl),
	}
}

function podmanVersionDiagnosticCheck(
	command: string,
	args: readonly string[],
	result: Result<PodmanCommandResult>,
): PodmanDiagnosticCheck {
	if (!result.ok) {
		return podmanRunnerErrorCheck(
			"podman.executable",
			"Podman executable is not available.",
			command,
			args,
			result.error,
		)
	}

	if (result.value.exitCode !== 0) {
		return podmanCommandExitCheck(
			"podman.executable",
			"Podman version check failed.",
			command,
			args,
			result.value,
		)
	}

	return {
		name: "podman.executable",
		status: "pass",
		message: "Podman executable is available.",
		details: commandResultDiagnosticDetails(command, args, result.value),
	}
}

function podmanRootlessDiagnosticCheck(summary: PodmanInfoSummary): PodmanDiagnosticCheck {
	if (summary.rootless === true) {
		return {
			name: "podman.rootless",
			status: "pass",
			message: "Podman is running in rootless mode.",
			details: podmanInfoSummaryDetails(summary),
		}
	}

	if (summary.rootless === false) {
		return {
			name: "podman.rootless",
			status: "warn",
			message: "Podman is running rootful; sando prefers rootless Podman.",
			details: podmanInfoSummaryDetails(summary),
		}
	}

	return {
		name: "podman.rootless",
		status: "warn",
		message: "Could not determine whether Podman is rootless.",
		details: podmanInfoSummaryDetails(summary),
	}
}

function podmanRunnerErrorCheck(
	name: string,
	message: string,
	command: string,
	args: readonly string[],
	error: SandoError,
): PodmanDiagnosticCheck {
	return {
		name,
		status: "fail",
		message,
		details: {
			command,
			args: [...args],
			errorCode: error.code,
			errorMessage: error.message,
			...(error.details === undefined ? {} : { errorDetails: error.details }),
		},
	}
}

function podmanCommandExitCheck(
	name: string,
	message: string,
	command: string,
	args: readonly string[],
	result: PodmanCommandResult,
): PodmanDiagnosticCheck {
	return {
		name,
		status: "fail",
		message,
		details: commandResultDiagnosticDetails(command, args, result),
	}
}

function isSuccessfulPodmanCommand(result: Result<PodmanCommandResult>): boolean {
	return result.ok && result.value.exitCode === 0
}

const podmanInfoOutputSchema = z
	.object({
		host: z
			.object({
				arch: z.string().optional(),
				cgroupManager: z.string().optional(),
				cgroupVersion: z.string().optional(),
				os: z.string().optional(),
				security: z
					.object({
						rootless: z.boolean().optional(),
					})
					.passthrough()
					.optional(),
				serviceIsRemote: z.boolean().optional(),
			})
			.passthrough()
			.optional(),
		version: z
			.object({
				Version: z.string().optional(),
				version: z.string().optional(),
			})
			.passthrough()
			.optional(),
	})
	.passthrough()

const podmanInfoSummarySchema = z.object({
	rootless: z.boolean().optional(),
	version: z.string().optional(),
	os: z.string().optional(),
	arch: z.string().optional(),
	cgroupManager: z.string().optional(),
	cgroupVersion: z.string().optional(),
	serviceIsRemote: z.boolean().optional(),
})

type PodmanInfoSummary = z.infer<typeof podmanInfoSummarySchema>

function parsePodmanInfoSummary(stdout: string): Result<PodmanInfoSummary> {
	try {
		const parsed = podmanInfoOutputSchema.safeParse(JSON.parse(stdout) as unknown)

		if (!parsed.success) {
			return err(
				sandoError({
					code: "VALIDATION_FAILED",
					message: "Invalid podman info JSON output.",
					details: {
						issues: parsed.error.issues.map((issue) => ({
							path: issue.path.join("."),
							message: issue.message,
						})),
					},
				}),
			)
		}

		return ok(
			podmanInfoSummarySchema.parse({
				rootless: parsed.data.host?.security?.rootless,
				version: parsed.data.version?.Version ?? parsed.data.version?.version,
				os: parsed.data.host?.os,
				arch: parsed.data.host?.arch,
				cgroupManager: parsed.data.host?.cgroupManager,
				cgroupVersion: parsed.data.host?.cgroupVersion,
				serviceIsRemote: parsed.data.host?.serviceIsRemote,
			}),
		)
	} catch (error) {
		return err(
			sandoError({
				code: "VALIDATION_FAILED",
				message: "Could not parse podman info JSON output.",
				details: {
					errorMessage: error instanceof Error ? error.message : String(error),
				},
			}),
		)
	}
}

function podmanInfoSummaryDetails(summary: PodmanInfoSummary): JsonValue {
	const details: Record<string, JsonValue> = {}

	if (summary.rootless !== undefined) {
		details.rootless = summary.rootless
	}

	if (summary.version !== undefined) {
		details.version = summary.version
	}

	if (summary.os !== undefined) {
		details.os = summary.os
	}

	if (summary.arch !== undefined) {
		details.arch = summary.arch
	}

	if (summary.cgroupManager !== undefined) {
		details.cgroupManager = summary.cgroupManager
	}

	if (summary.cgroupVersion !== undefined) {
		details.cgroupVersion = summary.cgroupVersion
	}

	if (summary.serviceIsRemote !== undefined) {
		details.serviceIsRemote = summary.serviceIsRemote
	}

	return details
}

function commandResultDiagnosticDetails(
	command: string,
	args: readonly string[],
	result: PodmanCommandResult,
): JsonValue {
	const details: Record<string, JsonValue> = {
		command,
		args: [...args],
		exitCode: result.exitCode,
		stdout: result.stdout,
		stderr: result.stderr,
	}

	if (result.timedOut === true) {
		details.timedOut = true
	}

	if (result.signal !== undefined) {
		details.signal = result.signal
	}

	return details
}

function wslDiagnosticDetails(wsl: WslDiagnostics): JsonValue {
	const details: Record<string, JsonValue> = {
		detected: wsl.detected,
		platform: wsl.platform,
		osRelease: wsl.osRelease,
		sources: [...wsl.sources],
		interopAvailable: wsl.interopAvailable,
	}

	if (wsl.distroName !== undefined) {
		details.distroName = wsl.distroName
	}

	return details
}

async function readLinuxProcVersion(): Promise<string> {
	try {
		return await readFile("/proc/version", "utf8")
	} catch {
		return ""
	}
}

function containsWslMarker(value: string): boolean {
	return /microsoft|wsl/i.test(value)
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error
}

type ExecFileError = Error & {
	readonly code?: string | number | null
	readonly stdout?: string | Buffer
	readonly stderr?: string | Buffer
	readonly killed?: boolean
	readonly signal?: string | null
}

function isExecFileError(error: unknown): error is ExecFileError {
	return error instanceof Error && "code" in error
}

function execOutputToString(output: string | Buffer | undefined): string {
	if (output === undefined) {
		return ""
	}

	return Buffer.isBuffer(output) ? output.toString("utf8") : output
}

function isExecFileTimeout(error: ExecFileError, options: PodmanCommandOptions): boolean {
	return options.timeoutMs !== undefined && error.killed === true
}

function podmanTimedOutResult(error: ExecFileError): PodmanCommandResult {
	const result: PodmanCommandResult = {
		exitCode: null,
		stdout: execOutputToString(error.stdout),
		stderr: execOutputToString(error.stderr),
		timedOut: true,
	}

	return typeof error.signal === "string" ? { ...result, signal: error.signal } : result
}
