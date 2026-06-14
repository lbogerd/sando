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
