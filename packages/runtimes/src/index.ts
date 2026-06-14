import type {
	JsonValue,
	NetworkMode,
	ResourceLimits,
	Result,
	RunId,
	SandboxRuntimeKind,
} from "@sando/shared"

export const packageName = "runtimes"

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
