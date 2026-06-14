import { execFile } from "node:child_process"
import type { ExecFileOptionsWithStringEncoding } from "node:child_process"
import { promisify } from "node:util"

import type {
	JsonValue,
	NetworkMode,
	ResourceLimits,
	Result,
	RunId,
	SandboxRuntimeKind,
} from "@sando/shared"
import { err, ok, sandoError } from "@sando/shared"

export const packageName = "runtimes"

const execFileAsync = promisify(execFile)

export const defaultPodmanExecutable = "podman"
export const defaultNodeTsPodmanImage = "localhost/sandhost-node-ts:local"
export const defaultPodmanRunnerPath = "/sandhost/runner/run.sh"
export const defaultPodmanWorkspacePath = "/workspace"
export const defaultPodmanArtifactPath = "/artifacts"

export type SandboxHandle = {
	readonly id: string
	readonly runtime: SandboxRuntimeKind
	readonly runId: RunId
	readonly metadata?: JsonValue
}

export type WorkspaceArchive = {
	readonly path: string
	readonly sizeBytes?: number
	readonly sha256?: string
}

export type CreateSandboxInput = {
	readonly runId: RunId
	readonly template: string
	readonly runtime: SandboxRuntimeKind
	readonly network: NetworkMode
	readonly resources: ResourceLimits
	readonly timeoutSeconds: number
	readonly workdir?: string
	readonly artifactDir?: string
	readonly environment?: Readonly<Record<string, string>>
}

export type CommandSpec = {
	readonly command: string
	readonly cwd?: string
	readonly env?: Readonly<Record<string, string>>
	readonly timeoutSeconds?: number
}

export type SandboxCommandStatus = "succeeded" | "failed" | "cancelled" | "timed_out"

export type RunResult = {
	readonly status: SandboxCommandStatus
	readonly exitCode: number | null
	readonly stdout: string
	readonly stderr: string
	readonly logs: string
	readonly startedAt: string
	readonly finishedAt: string
	readonly durationMs: number
}

export type RuntimeArtifact = {
	readonly name: string
	readonly path: string
	readonly contentType?: string
	readonly sizeBytes?: number
}

export type ArtifactBundle = {
	readonly rootPath: string
	readonly artifacts: readonly RuntimeArtifact[]
	readonly resultPath?: string
	readonly logsPath?: string
	readonly diffPath?: string
	readonly changedFilesPath?: string
}

export interface SandboxRuntime {
	readonly kind: SandboxRuntimeKind

	createSandbox(input: CreateSandboxInput): Promise<Result<SandboxHandle>>
	uploadWorkspace(handle: SandboxHandle, archive: WorkspaceArchive): Promise<Result<void>>
	runCommand(handle: SandboxHandle, command: CommandSpec): Promise<Result<RunResult>>
	collectArtifacts(handle: SandboxHandle): Promise<Result<ArtifactBundle>>
	destroySandbox(handle: SandboxHandle): Promise<Result<void>>
}

export type PodmanCommandOptions = {
	readonly cwd?: string
}

export type PodmanCommandResult = {
	readonly exitCode: number
	readonly stdout: string
	readonly stderr: string
}

export type PodmanCommandRunner = (
	command: string,
	args: readonly string[],
	options?: PodmanCommandOptions,
) => Promise<Result<PodmanCommandResult>>

export type PodmanBuildImageSource = {
	readonly kind: "build"
	readonly contextPath: string
	readonly containerfilePath?: string
	readonly buildArgs?: Readonly<Record<string, string>>
}

export type PodmanPullImageSource = {
	readonly kind: "pull"
}

export type PodmanImageSource = PodmanBuildImageSource | PodmanPullImageSource

export type EnsurePodmanImageInput = {
	readonly image: string
	readonly source: PodmanImageSource
	readonly podmanExecutable?: string
	readonly commandRunner?: PodmanCommandRunner
}

export type PodmanImageAction = "existing" | "built" | "pulled"

export type PodmanImageRef = {
	readonly image: string
	readonly action: PodmanImageAction
	readonly stdout: string
	readonly stderr: string
}

export type PodmanRuntimeOptions = {
	readonly image?: string
	readonly imageSource?: PodmanImageSource
	readonly podmanExecutable?: string
	readonly commandRunner?: PodmanCommandRunner
	readonly runnerPath?: string
	readonly workspacePath?: string
	readonly artifactPath?: string
}

export class PodmanRuntime implements SandboxRuntime {
	readonly kind = "podman" as const

	private readonly command: string
	private readonly runner: PodmanCommandRunner
	private readonly image: string
	private readonly imageSource: PodmanImageSource | undefined
	private readonly runnerPath: string
	private readonly workspacePath: string
	private readonly artifactPath: string

	constructor(options: PodmanRuntimeOptions = {}) {
		this.command = options.podmanExecutable ?? defaultPodmanExecutable
		this.runner = options.commandRunner ?? defaultPodmanCommandRunner
		this.image = options.image ?? defaultNodeTsPodmanImage
		this.imageSource = options.imageSource
		this.runnerPath = options.runnerPath ?? defaultPodmanRunnerPath
		this.workspacePath = options.workspacePath ?? defaultPodmanWorkspacePath
		this.artifactPath = options.artifactPath ?? defaultPodmanArtifactPath
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
			return start
		}

		if (start.value.exitCode !== 0) {
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
				workdir,
			},
		})
	}

	async uploadWorkspace(_handle: SandboxHandle, _archive: WorkspaceArchive): Promise<Result<void>> {
		return notImplemented("Podman workspace upload is not implemented yet.")
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
		const result = await this.runner(this.command, args)
		const finishedAt = new Date()

		if (!result.ok) {
			return result
		}

		return ok({
			status: result.value.exitCode === 0 ? "succeeded" : "failed",
			exitCode: result.value.exitCode,
			stdout: result.value.stdout,
			stderr: result.value.stderr,
			logs: combinedLogs(result.value),
			startedAt: startedAt.toISOString(),
			finishedAt: finishedAt.toISOString(),
			durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
		})
	}

	async collectArtifacts(_handle: SandboxHandle): Promise<Result<ArtifactBundle>> {
		return notImplemented("Podman artifact collection is not implemented yet.")
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

type PodmanCreateArgsInput = {
	readonly artifactDir: string
	readonly environment: Readonly<Record<string, string>> | undefined
	readonly image: string
	readonly name: string
	readonly workdir: string
}

function podmanCreateArgs(input: PodmanCreateArgsInput): readonly string[] {
	return [
		"create",
		"--name",
		input.name,
		"--workdir",
		input.workdir,
		...podmanEnvArgs({
			...input.environment,
			SANDHOST_ARTIFACTS: input.artifactDir,
			SANDHOST_WORKSPACE: input.workdir,
		}),
		input.image,
		"sleep",
		"infinity",
	]
}

type PodmanExecArgsInput = {
	readonly command: CommandSpec
	readonly container: string
	readonly runnerPath: string
}

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

function podmanSandboxName(runId: RunId): string {
	return `sandhost-run-${String(runId).replaceAll(/[^a-zA-Z0-9_.-]/g, "-")}`
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

function combinedLogs(result: PodmanCommandResult): string {
	return [result.stdout, result.stderr].filter((value) => value.length > 0).join("")
}

function notImplemented<Value>(message: string): Result<Value> {
	return err(
		sandoError({
			code: "INTERNAL",
			message,
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

	return details
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

type ExecFileError = NodeJS.ErrnoException & {
	readonly stdout?: string | Buffer
	readonly stderr?: string | Buffer
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
