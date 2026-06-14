import { execFile } from "node:child_process"
import type { ExecFileOptionsWithStringEncoding } from "node:child_process"
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises"
import { join, relative, resolve, sep } from "node:path"
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
export const defaultPodmanRunsRootPath = ".sandhost/runs"

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

export type RuntimeResultJson = {
	readonly runId: string
	readonly runtime: SandboxRuntimeKind
	readonly command: string
	readonly status: SandboxCommandStatus
	readonly exitCode: number | null
	readonly startedAt: string
	readonly finishedAt: string
	readonly durationMs: number
	readonly network?: NetworkMode
	readonly artifacts: {
		readonly logs: "logs.txt"
		readonly stdout: "stdout.txt"
		readonly stderr: "stderr.txt"
		readonly diff: "diff.patch"
		readonly changedFiles: "changed-files.txt"
	}
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

export type PodmanCommandOptions = {
	readonly cwd?: string
	readonly timeoutMs?: number
}

export type PodmanCommandResult = {
	readonly exitCode: number | null
	readonly stdout: string
	readonly stderr: string
	readonly timedOut?: boolean
	readonly signal?: string
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
	readonly runsRootPath?: string
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

type PodmanCreateArgsInput = {
	readonly artifactDir: string
	readonly environment: Readonly<Record<string, string>> | undefined
	readonly image: string
	readonly name: string
	readonly network: NetworkMode
	readonly resources: ResourceLimits
	readonly workdir: string
}

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
			SANDHOST_ARTIFACTS: input.artifactDir,
			SANDHOST_WORKSPACE: input.workdir,
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

function podmanArtifactDir(handle: SandboxHandle, fallback: string): string {
	if (isRecord(handle.metadata) && typeof handle.metadata.artifactDir === "string") {
		return handle.metadata.artifactDir
	}

	return fallback
}

function podmanArtifactCopySource(container: string, artifactDir: string): string {
	return `${container}:${artifactDir.replace(/\/+$/, "")}/.`
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

function notImplemented<Value>(message: string): Result<Value> {
	return err(
		sandoError({
			code: "INTERNAL",
			message,
		}),
	)
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
