import { z } from "zod"

export const packageName = "shared"

declare const idBrand: unique symbol

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export type Id<Kind extends string> = string & {
	readonly [idBrand]: Kind
}

export const idPrefixes = {
	user: "user",
	project: "proj",
	policy: "policy",
	host: "host",
	agent: "agent",
	grant: "grant",
	run: "run",
	artifact: "art",
	auditEvent: "audit",
} as const

export type IdKind = keyof typeof idPrefixes
export type IdForKind<Kind extends IdKind> = Id<Kind>

export type UserId = IdForKind<"user">
export type ProjectId = IdForKind<"project">
export type PolicyId = IdForKind<"policy">
export type HostId = IdForKind<"host">
export type AgentId = IdForKind<"agent">
export type GrantId = IdForKind<"grant">
export type RunId = IdForKind<"run">
export type ArtifactId = IdForKind<"artifact">
export type AuditEventId = IdForKind<"auditEvent">

export function asId<Kind extends IdKind>(kind: Kind, value: string): IdForKind<Kind> {
	return value as IdForKind<Kind>
}

export function isIdOfKind<Kind extends IdKind>(
	kind: Kind,
	value: unknown,
): value is IdForKind<Kind> {
	return typeof value === "string" && value.startsWith(`${idPrefixes[kind]}_`)
}

export type Ok<Value> = {
	readonly ok: true
	readonly value: Value
}

export type Err<ErrorValue = SandoError> = {
	readonly ok: false
	readonly error: ErrorValue
}

export type Result<Value, ErrorValue = SandoError> = Ok<Value> | Err<ErrorValue>

export function ok<Value>(value: Value): Ok<Value> {
	return { ok: true, value }
}

export function err<ErrorValue = SandoError>(error: ErrorValue): Err<ErrorValue> {
	return { ok: false, error }
}

export const sandoErrorCodes = [
	"UNKNOWN",
	"VALIDATION_FAILED",
	"NOT_FOUND",
	"UNAUTHORIZED",
	"FORBIDDEN",
	"GRANT_REQUIRED",
	"GRANT_DENIED",
	"POLICY_VIOLATION",
	"RUNTIME_UNAVAILABLE",
	"SANDBOX_FAILED",
	"COMMAND_FAILED",
	"COMMAND_TIMED_OUT",
	"ARTIFACT_UPLOAD_FAILED",
	"NETWORK_UNAVAILABLE",
	"INTERNAL",
] as const

export type SandoErrorCode = (typeof sandoErrorCodes)[number]

export type SandoError = {
	readonly code: SandoErrorCode
	readonly message: string
	readonly details?: JsonValue
	readonly cause?: SandoError
}

export type SandoErrorInput = {
	readonly code: SandoErrorCode
	readonly message: string
	readonly details?: JsonValue
	readonly cause?: SandoError
}

export function sandoError(input: SandoErrorInput): SandoError {
	return input
}

export type ValidationIssue = {
	readonly path: string
	readonly message: string
}

export const networkModes = ["none", "default"] as const

export const networkModeSchema = z.enum(networkModes, {
	error: "Expected a supported network mode.",
})

export type NetworkMode = z.infer<typeof networkModeSchema>

export const sandboxRuntimeKinds = ["podman", "docker", "kubernetes"] as const

export const sandboxRuntimeKindSchema = z.enum(sandboxRuntimeKinds, {
	error: "Expected a supported sandbox runtime.",
})

export type SandboxRuntimeKind = z.infer<typeof sandboxRuntimeKindSchema>

const nonEmptyStringSchema = z
	.string()
	.refine((value) => value.trim().length > 0, "Expected a non-empty string.")

const positiveIntegerSchema = z
	.number()
	.int("Expected a positive integer.")
	.positive("Expected a positive integer.")

const nonNegativeIntegerSchema = z
	.number()
	.int("Expected a non-negative integer.")
	.nonnegative("Expected a non-negative integer.")

const nullableExitCodeSchema = z.custom<number | null>(
	(value) => value === null || (typeof value === "number" && Number.isInteger(value) && value >= 0),
	"Expected null or a non-negative integer.",
)

const positiveNumberSchema = z.number().positive("Expected a positive number.")

export const resourceLimitsSchema = z.object({
	cpu: positiveNumberSchema,
	memoryMb: positiveIntegerSchema,
})

export type ResourceLimits = z.infer<typeof resourceLimitsSchema>

export const secretPolicySchema = z.object({
	allow: z.array(z.string()),
})

export type SecretPolicy = z.infer<typeof secretPolicySchema>

export const sandoPolicySchema = z
	.object({
		version: z.literal(1, "Expected version 1."),
		defaultTemplate: nonEmptyStringSchema,
		runtime: sandboxRuntimeKindSchema,
		defaultNetwork: networkModeSchema,
		allowedNetworks: z
			.array(networkModeSchema, "Expected an array of network modes.")
			.min(1, "Expected at least one network mode."),
		maxTtlSeconds: positiveIntegerSchema,
		maxTimeoutSeconds: positiveIntegerSchema,
		resources: resourceLimitsSchema,
		secrets: secretPolicySchema,
		artifacts: z.array(nonEmptyStringSchema),
		exclude: z.array(nonEmptyStringSchema),
	})
	.refine((policy) => policy.allowedNetworks.includes(policy.defaultNetwork), {
		path: ["defaultNetwork"],
		message: "Expected the default network to be allowed.",
	})

export type SandoPolicy = z.infer<typeof sandoPolicySchema>

export const defaultSandoPolicy = {
	version: 1,
	defaultTemplate: "node-ts",
	runtime: "podman",
	defaultNetwork: "none",
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
	artifacts: ["coverage/**", "test-results/**", "playwright-report/**", "*.patch"],
	exclude: [
		".git",
		"node_modules",
		".env",
		".env.*",
		"dist",
		"build",
		"coverage",
		".sandhost/runs",
	],
} as const satisfies SandoPolicy

export const sandoPolicyMetadata = {
	version: 1,
	runtimes: sandboxRuntimeKinds,
	networks: networkModes,
	defaults: defaultSandoPolicy,
} as const

export function parseSandoPolicy(value: unknown): Result<SandoPolicy> {
	const result = sandoPolicySchema.safeParse(value)

	if (!result.success) {
		return err(validationError("Invalid sandhost policy.", result.error))
	}

	return ok(result.data)
}

export function isSandoPolicy(value: unknown): value is SandoPolicy {
	return parseSandoPolicy(value).ok
}

export const runProjectCommandInputSchema = z.object({
	command: nonEmptyStringSchema,
	template: nonEmptyStringSchema.optional(),
	network: networkModeSchema.optional(),
	timeoutSeconds: positiveIntegerSchema.optional(),
})

export type RunProjectCommandInput = z.infer<typeof runProjectCommandInputSchema>

export const runProjectCommandInputMetadata = {
	networks: networkModes,
	defaults: {
		template: defaultSandoPolicy.defaultTemplate,
		network: defaultSandoPolicy.defaultNetwork,
		timeoutSeconds: defaultSandoPolicy.maxTimeoutSeconds,
	},
} as const

export function parseRunProjectCommandInput(value: unknown): Result<RunProjectCommandInput> {
	const result = runProjectCommandInputSchema.safeParse(value)

	if (!result.success) {
		return err(validationError("Invalid run project command input.", result.error))
	}

	return ok(result.data)
}

export function isRunProjectCommandInput(value: unknown): value is RunProjectCommandInput {
	return parseRunProjectCommandInput(value).ok
}

export const runProjectCommandStatuses = ["succeeded", "failed", "cancelled", "timed_out"] as const

export const runProjectCommandStatusSchema = z.enum(runProjectCommandStatuses, {
	error: "Expected a terminal run status.",
})

export type RunProjectCommandStatus = z.infer<typeof runProjectCommandStatusSchema>

export type SandoUri = `sandhost://${string}`

export const sandoUriSchema = z
	.string()
	.refine((value): value is SandoUri => value.startsWith("sandhost://"), "Expected a sandhost URI.")

export function isSandoUri(value: unknown): value is SandoUri {
	return sandoUriSchema.safeParse(value).success
}

function idSchema<Kind extends IdKind>(kind: Kind, message: string): z.ZodType<IdForKind<Kind>> {
	return z.custom<IdForKind<Kind>>((value) => isIdOfKind(kind, value), message)
}

export const artifactRefSchema = z.object({
	id: idSchema("artifact", "Expected an artifact ID.").optional(),
	name: nonEmptyStringSchema,
	uri: sandoUriSchema,
	contentType: nonEmptyStringSchema.optional(),
	sizeBytes: nonNegativeIntegerSchema.optional(),
})

export type ArtifactRef = z.infer<typeof artifactRefSchema>

export const runProjectCommandResultSchema = z.object({
	runId: idSchema("run", "Expected a run ID."),
	status: runProjectCommandStatusSchema,
	exitCode: nullableExitCodeSchema,
	durationMs: nonNegativeIntegerSchema,
	command: nonEmptyStringSchema,
	network: networkModeSchema,
	summary: z.string(),
	logsRef: sandoUriSchema,
	stdoutRef: sandoUriSchema,
	stderrRef: sandoUriSchema,
	diffRef: sandoUriSchema.optional(),
	changedFilesRef: sandoUriSchema.optional(),
	artifacts: z.array(artifactRefSchema),
	auditRef: sandoUriSchema,
})

export type RunProjectCommandResult = z.infer<typeof runProjectCommandResultSchema>

export const runProjectCommandResultMetadata = {
	statuses: runProjectCommandStatuses,
	networks: networkModes,
	uriScheme: "sandhost://",
} as const

export function parseRunProjectCommandResult(value: unknown): Result<RunProjectCommandResult> {
	const result = runProjectCommandResultSchema.safeParse(value)

	if (!result.success) {
		return err(validationError("Invalid run project command result.", result.error))
	}

	return ok(result.data)
}

export function isRunProjectCommandResult(value: unknown): value is RunProjectCommandResult {
	return parseRunProjectCommandResult(value).ok
}

function validationError(message: string, error: z.ZodError): SandoError {
	return sandoError({
		code: "VALIDATION_FAILED",
		message,
		details: {
			issues: error.issues.map((issue) => ({
				path: zodIssuePath(issue.path),
				message: issue.message,
			})),
		},
	})
}

function zodIssuePath(path: PropertyKey[]): string {
	if (path.length === 0) {
		return "$"
	}

	return path.reduce<string>((result, segment) => {
		if (typeof segment === "number") {
			return `${result}[${segment}]`
		}

		return `${result}.${String(segment)}`
	}, "$")
}
