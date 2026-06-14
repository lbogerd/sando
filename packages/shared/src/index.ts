import { z } from "zod"

export const packageName = "shared"

declare const idBrand: unique symbol

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

const jsonValueSchema: z.ZodType<JsonValue> = z.json()

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

export const hostPlatforms = ["linux-wsl"] as const

export const hostPlatformSchema = z.enum(hostPlatforms, {
	error: "Expected a supported host platform.",
})

export type HostPlatform = z.infer<typeof hostPlatformSchema>

export const auditEventTypes = [
	"agent.registered",
	"host.registered",
	"project.initialized",
	"grant.requested",
	"grant.approved",
	"grant.denied",
	"capability.executed",
	"run.created",
	"workspace.archived",
	"sandbox.created",
	"command.started",
	"command.finished",
	"artifact.uploaded",
	"diff.created",
	"sandbox.destroyed",
	"grant.expired",
] as const

export const auditEventTypeSchema = z.enum(auditEventTypes, {
	error: "Expected a supported audit event type.",
})

export type AuditEventType = z.infer<typeof auditEventTypeSchema>

export const auditMetadataSchema = z.record(z.string(), jsonValueSchema)

export type AuditMetadata = z.infer<typeof auditMetadataSchema>

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

export const runStatuses = ["queued", "running", ...runProjectCommandStatuses] as const

export const runStatusSchema = z.enum(runStatuses, {
	error: "Expected a supported run status.",
})

export type RunStatus = z.infer<typeof runStatusSchema>

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

export const projectRecordSchema = z.object({
	id: idSchema("project", "Expected a project ID."),
	userId: idSchema("user", "Expected a user ID."),
	name: nonEmptyStringSchema,
	localFingerprint: nonEmptyStringSchema,
	policyId: idSchema("policy", "Expected a policy ID."),
	createdAt: nonEmptyStringSchema,
})

export type ProjectRecord = z.infer<typeof projectRecordSchema>

export const registerProjectInputSchema = z.object({
	name: nonEmptyStringSchema,
	localFingerprint: nonEmptyStringSchema,
	policyId: idSchema("policy", "Expected a policy ID."),
})

export type RegisterProjectInput = z.infer<typeof registerProjectInputSchema>

export const projectRegistrationResultSchema = z.object({
	project: projectRecordSchema,
	created: z.boolean(),
})

export type ProjectRegistrationResult = z.infer<typeof projectRegistrationResultSchema>

export function parseProjectRecord(value: unknown): Result<ProjectRecord> {
	const result = projectRecordSchema.safeParse(value)

	if (!result.success) {
		return err(validationError("Invalid project record.", result.error))
	}

	return ok(result.data)
}

export function isProjectRecord(value: unknown): value is ProjectRecord {
	return parseProjectRecord(value).ok
}

export function parseRegisterProjectInput(value: unknown): Result<RegisterProjectInput> {
	const result = registerProjectInputSchema.safeParse(value)

	if (!result.success) {
		return err(validationError("Invalid register project input.", result.error))
	}

	return ok(result.data)
}

export function isRegisterProjectInput(value: unknown): value is RegisterProjectInput {
	return parseRegisterProjectInput(value).ok
}

export function parseProjectRegistrationResult(value: unknown): Result<ProjectRegistrationResult> {
	const result = projectRegistrationResultSchema.safeParse(value)

	if (!result.success) {
		return err(validationError("Invalid project registration result.", result.error))
	}

	return ok(result.data)
}

export function isProjectRegistrationResult(value: unknown): value is ProjectRegistrationResult {
	return parseProjectRegistrationResult(value).ok
}

export const hostRecordSchema = z.object({
	id: idSchema("host", "Expected a host ID."),
	userId: idSchema("user", "Expected a user ID."),
	name: nonEmptyStringSchema,
	platform: hostPlatformSchema,
	runtime: sandboxRuntimeKindSchema,
	fingerprint: nonEmptyStringSchema,
	createdAt: nonEmptyStringSchema,
	lastSeenAt: nonEmptyStringSchema,
})

export type HostRecord = z.infer<typeof hostRecordSchema>

export const registerHostInputSchema = z.object({
	name: nonEmptyStringSchema,
	platform: hostPlatformSchema,
	runtime: sandboxRuntimeKindSchema,
	fingerprint: nonEmptyStringSchema,
})

export type RegisterHostInput = z.infer<typeof registerHostInputSchema>

export const hostRegistrationResultSchema = z.object({
	host: hostRecordSchema,
	created: z.boolean(),
})

export type HostRegistrationResult = z.infer<typeof hostRegistrationResultSchema>

export function parseHostRecord(value: unknown): Result<HostRecord> {
	const result = hostRecordSchema.safeParse(value)

	if (!result.success) {
		return err(validationError("Invalid host record.", result.error))
	}

	return ok(result.data)
}

export function isHostRecord(value: unknown): value is HostRecord {
	return parseHostRecord(value).ok
}

export function parseRegisterHostInput(value: unknown): Result<RegisterHostInput> {
	const result = registerHostInputSchema.safeParse(value)

	if (!result.success) {
		return err(validationError("Invalid register host input.", result.error))
	}

	return ok(result.data)
}

export function isRegisterHostInput(value: unknown): value is RegisterHostInput {
	return parseRegisterHostInput(value).ok
}

export function parseHostRegistrationResult(value: unknown): Result<HostRegistrationResult> {
	const result = hostRegistrationResultSchema.safeParse(value)

	if (!result.success) {
		return err(validationError("Invalid host registration result.", result.error))
	}

	return ok(result.data)
}

export function isHostRegistrationResult(value: unknown): value is HostRegistrationResult {
	return parseHostRegistrationResult(value).ok
}

export const runRecordSchema = z.object({
	id: idSchema("run", "Expected a run ID."),
	userId: idSchema("user", "Expected a user ID."),
	projectId: idSchema("project", "Expected a project ID."),
	hostId: idSchema("host", "Expected a host ID."),
	agentId: idSchema("agent", "Expected an agent ID."),
	grantId: idSchema("grant", "Expected a grant ID."),
	command: nonEmptyStringSchema,
	template: nonEmptyStringSchema,
	runtime: sandboxRuntimeKindSchema,
	network: networkModeSchema,
	status: runStatusSchema,
	exitCode: nullableExitCodeSchema.optional(),
	startedAt: nonEmptyStringSchema.optional(),
	finishedAt: nonEmptyStringSchema.optional(),
	durationMs: nonNegativeIntegerSchema.optional(),
})

export type RunRecord = z.infer<typeof runRecordSchema>

export const createRunInputSchema = z.object({
	projectId: idSchema("project", "Expected a project ID."),
	hostId: idSchema("host", "Expected a host ID."),
	agentId: idSchema("agent", "Expected an agent ID."),
	grantId: idSchema("grant", "Expected a grant ID."),
	command: nonEmptyStringSchema,
	template: nonEmptyStringSchema,
	runtime: sandboxRuntimeKindSchema,
	network: networkModeSchema,
})

export type CreateRunInput = z.infer<typeof createRunInputSchema>

export const createRunResultSchema = z.object({
	run: runRecordSchema,
})

export type CreateRunResult = z.infer<typeof createRunResultSchema>

export const finishRunInputSchema = z.object({
	status: runProjectCommandStatusSchema,
	exitCode: nullableExitCodeSchema,
	durationMs: nonNegativeIntegerSchema,
})

export type FinishRunInput = z.infer<typeof finishRunInputSchema>

export const finishRunResultSchema = z.object({
	run: runRecordSchema,
})

export type FinishRunResult = z.infer<typeof finishRunResultSchema>

export function parseRunRecord(value: unknown): Result<RunRecord> {
	const result = runRecordSchema.safeParse(value)

	if (!result.success) {
		return err(validationError("Invalid run record.", result.error))
	}

	return ok(result.data)
}

export function isRunRecord(value: unknown): value is RunRecord {
	return parseRunRecord(value).ok
}

export function parseCreateRunInput(value: unknown): Result<CreateRunInput> {
	const result = createRunInputSchema.safeParse(value)

	if (!result.success) {
		return err(validationError("Invalid create run input.", result.error))
	}

	return ok(result.data)
}

export function isCreateRunInput(value: unknown): value is CreateRunInput {
	return parseCreateRunInput(value).ok
}

export function parseCreateRunResult(value: unknown): Result<CreateRunResult> {
	const result = createRunResultSchema.safeParse(value)

	if (!result.success) {
		return err(validationError("Invalid create run result.", result.error))
	}

	return ok(result.data)
}

export function isCreateRunResult(value: unknown): value is CreateRunResult {
	return parseCreateRunResult(value).ok
}

export function parseFinishRunInput(value: unknown): Result<FinishRunInput> {
	const result = finishRunInputSchema.safeParse(value)

	if (!result.success) {
		return err(validationError("Invalid finish run input.", result.error))
	}

	return ok(result.data)
}

export function isFinishRunInput(value: unknown): value is FinishRunInput {
	return parseFinishRunInput(value).ok
}

export function parseFinishRunResult(value: unknown): Result<FinishRunResult> {
	const result = finishRunResultSchema.safeParse(value)

	if (!result.success) {
		return err(validationError("Invalid finish run result.", result.error))
	}

	return ok(result.data)
}

export function isFinishRunResult(value: unknown): value is FinishRunResult {
	return parseFinishRunResult(value).ok
}

export const auditEventRecordSchema = z.object({
	id: idSchema("auditEvent", "Expected an audit event ID."),
	type: auditEventTypeSchema,
	userId: idSchema("user", "Expected a user ID."),
	projectId: idSchema("project", "Expected a project ID.").optional(),
	hostId: idSchema("host", "Expected a host ID.").optional(),
	agentId: idSchema("agent", "Expected an agent ID.").optional(),
	grantId: idSchema("grant", "Expected a grant ID.").optional(),
	runId: idSchema("run", "Expected a run ID.").optional(),
	timestamp: nonEmptyStringSchema,
	metadata: auditMetadataSchema,
})

export type AuditEventRecord = z.infer<typeof auditEventRecordSchema>

export const appendAuditEventInputSchema = z.object({
	type: auditEventTypeSchema,
	projectId: idSchema("project", "Expected a project ID.").optional(),
	hostId: idSchema("host", "Expected a host ID.").optional(),
	agentId: idSchema("agent", "Expected an agent ID.").optional(),
	grantId: idSchema("grant", "Expected a grant ID.").optional(),
	runId: idSchema("run", "Expected a run ID.").optional(),
	metadata: auditMetadataSchema.default({}),
})

export type AppendAuditEventInput = z.infer<typeof appendAuditEventInputSchema>

export const appendAuditEventResultSchema = z.object({
	auditEvent: auditEventRecordSchema,
})

export type AppendAuditEventResult = z.infer<typeof appendAuditEventResultSchema>

export function parseAuditEventRecord(value: unknown): Result<AuditEventRecord> {
	const result = auditEventRecordSchema.safeParse(value)

	if (!result.success) {
		return err(validationError("Invalid audit event record.", result.error))
	}

	return ok(result.data)
}

export function isAuditEventRecord(value: unknown): value is AuditEventRecord {
	return parseAuditEventRecord(value).ok
}

export function parseAppendAuditEventInput(value: unknown): Result<AppendAuditEventInput> {
	const result = appendAuditEventInputSchema.safeParse(value)

	if (!result.success) {
		return err(validationError("Invalid append audit event input.", result.error))
	}

	return ok(result.data)
}

export function isAppendAuditEventInput(value: unknown): value is AppendAuditEventInput {
	return parseAppendAuditEventInput(value).ok
}

export function parseAppendAuditEventResult(value: unknown): Result<AppendAuditEventResult> {
	const result = appendAuditEventResultSchema.safeParse(value)

	if (!result.success) {
		return err(validationError("Invalid append audit event result.", result.error))
	}

	return ok(result.data)
}

export function isAppendAuditEventResult(value: unknown): value is AppendAuditEventResult {
	return parseAppendAuditEventResult(value).ok
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
