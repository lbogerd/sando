import { execFile } from "node:child_process"
import { lstat, readFile } from "node:fs/promises"
import { dirname, isAbsolute, join, parse as parsePath, resolve } from "node:path"
import { promisify } from "node:util"

import {
	defaultSandoPolicy,
	err,
	networkModes,
	ok,
	parseSandoPolicy,
	sandoError,
	type NetworkMode,
	type ResourceLimits,
	type Result,
	type RunProjectCommandInput,
	type SandboxRuntimeKind,
	type SandoPolicy,
	type SecretPolicy,
} from "@sando/shared"

export const packageName = "runners"

export const projectPolicyFilePath = ".sandhost/policy.json"
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
	paths: [".aws/credentials", ".docker/config.json", ".kube/config"] as const,
} as const

const execFileAsync = promisify(execFile)

export const projectRootStrongMarkers = [
	projectPolicyFilePath,
	".git",
	"pnpm-workspace.yaml",
] as const

export const projectRootFallbackMarkers = ["package.json"] as const

export type ProjectRootMarker =
	| (typeof projectRootStrongMarkers)[number]
	| (typeof projectRootFallbackMarkers)[number]

export type ProjectRoot = {
	readonly path: string
	readonly marker: ProjectRootMarker
}

export type FindProjectRootInput = {
	readonly startPath?: string
}

export type LoadedProjectPolicy = {
	readonly projectRoot: string
	readonly path: string
	readonly policy: SandoPolicy
}

export type LoadProjectPolicyInput = {
	readonly startPath?: string
	readonly projectRoot?: string
}

export type ArchiveFileSelectionInput = {
	readonly startPath?: string
	readonly projectRoot?: string
	readonly gitExecutable?: string
}

export type ArchiveFileSelection = {
	readonly projectRoot: string
	readonly files: readonly string[]
}

export type PolicyConstraints = {
	readonly defaultTemplate?: string
	readonly allowedTemplates?: readonly string[]
	readonly runtime?: SandboxRuntimeKind
	readonly defaultNetwork?: NetworkMode
	readonly allowedNetworks?: readonly NetworkMode[]
	readonly maxTtlSeconds?: number
	readonly maxTimeoutSeconds?: number
	readonly resources?: Partial<ResourceLimits>
	readonly secrets?: SecretPolicy
	readonly artifacts?: readonly string[]
	readonly exclude?: readonly string[]
}

export type CompileEffectivePolicyInput = {
	readonly systemPolicy?: PolicyConstraints
	readonly hostedProjectPolicy?: PolicyConstraints
	readonly localProjectPolicy?: PolicyConstraints
	readonly templateDefaults?: PolicyConstraints
	readonly grantConstraints?: PolicyConstraints
	readonly request?: RunProjectCommandInput
}

export type EffectivePolicy = {
	readonly template: string
	readonly allowedTemplates: readonly string[]
	readonly runtime: SandboxRuntimeKind
	readonly network: NetworkMode
	readonly allowedNetworks: readonly NetworkMode[]
	readonly maxTtlSeconds: number
	readonly maxTimeoutSeconds: number
	readonly timeoutSeconds: number
	readonly resources: ResourceLimits
	readonly secrets: SecretPolicy
	readonly artifacts: readonly string[]
	readonly exclude: readonly string[]
}

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
} as const satisfies PolicyConstraints

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
} as const satisfies PolicyConstraints

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
				message: "Invalid sandhost policy file.",
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
		allowedTemplates,
		runtime: runtime.value,
		network: network.value,
		allowedNetworks,
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
		artifacts: intersectStringSets(
			layers.flatMap((layer) => (layer.artifacts === undefined ? [] : [layer.artifacts])),
			defaultSandoPolicy.artifacts,
		),
		exclude: unionStringSets(
			layers.flatMap((layer) => (layer.exclude === undefined ? [] : [layer.exclude])),
			defaultSandoPolicy.exclude,
		),
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

		return ok({
			projectRoot: projectRoot.value,
			files: filterSensitiveArchiveFiles(parseGitNullDelimitedPaths(stdout)),
		})
	} catch (error) {
		if (!isExecFileError(error)) {
			throw error
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

function parseGitNullDelimitedPaths(output: string): readonly string[] {
	return output
		.split("\0")
		.filter((path) => path.length > 0)
		.sort()
}

export function filterSensitiveArchiveFiles(files: readonly string[]): readonly string[] {
	return files.filter((path) => !isSensitiveArchiveFilePath(path))
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

function stringListIncludes(values: readonly string[], value: string): boolean {
	return values.includes(value)
}

function normalizeArchivePath(path: string): string {
	return path.replaceAll("\\", "/").replace(/^\/+/, "")
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
	readonly startPath?: string
	readonly projectRoot?: string
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
					message: "Sandhost policy file does not exist.",
					details: { path },
				}),
			)
		}

		if (error.code === "EACCES" || error.code === "EPERM") {
			return err(
				sandoError({
					code: "FORBIDDEN",
					message: "Sandhost policy file is not readable.",
					details: { path },
				}),
			)
		}

		if (error.code === "EISDIR") {
			return err(
				sandoError({
					code: "VALIDATION_FAILED",
					message: "Sandhost policy path is not a file.",
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
					message: "Sandhost policy file contains invalid JSON.",
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

		if (stat !== undefined) {
			return marker
		}
	}

	return undefined
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
