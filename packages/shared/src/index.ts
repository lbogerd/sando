import { createHash } from "node:crypto"

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

export const agentKinds = ["codex"] as const

export const agentKindSchema = z.enum(agentKinds, {
	error: "Expected a supported agent kind.",
})

export type AgentKind = z.infer<typeof agentKindSchema>

export const sandboxCapabilities = [
	"sandbox.list_templates",
	"sandbox.explain_policy",
	"sandbox.run_project_command",
	"sandbox.read_logs",
	"sandbox.get_diff",
	"sandbox.download_artifact",
] as const

export const capabilitySchema = z.enum(sandboxCapabilities, {
	error: "Expected a supported sando capability.",
})

export type Capability = z.infer<typeof capabilitySchema>

export const grantScopes = ["one_shot", "project_window"] as const

export const grantScopeSchema = z.enum(grantScopes, {
	error: "Expected a supported grant scope.",
})

export type GrantScope = z.infer<typeof grantScopeSchema>

export const grantStatuses = ["pending", "approved", "denied", "expired", "revoked"] as const

export const grantStatusSchema = z.enum(grantStatuses, {
	error: "Expected a supported grant status.",
})

export type GrantStatus = z.infer<typeof grantStatusSchema>

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
	artifacts: ["coverage/**", "test-results/**", "*.patch"],
	exclude: [
		".git",
		"node_modules",
		".env",
		".env.*",
		"dist",
		"build",
		"coverage",
		".sando/runs",
		".sando/session.json",
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
		return err(validationError("Invalid sando policy.", result.error))
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

export const commandHashSchema = z
	.string()
	.regex(/^sha256:[a-f0-9]{64}$/u, "Expected a SHA-256 command hash.")

export type CommandHash = z.infer<typeof commandHashSchema>

export const runProjectCommandGrantShapeSchema = z.object({
	command: nonEmptyStringSchema,
	template: nonEmptyStringSchema,
	runtime: sandboxRuntimeKindSchema,
	network: networkModeSchema,
	timeoutSeconds: positiveIntegerSchema,
})

export type RunProjectCommandGrantShape = z.infer<typeof runProjectCommandGrantShapeSchema>

export const grantConstraintsSchema = z.object({
	command: nonEmptyStringSchema,
	commandHash: commandHashSchema,
	maxTimeoutSeconds: positiveIntegerSchema,
	network: networkModeSchema,
	runtime: sandboxRuntimeKindSchema,
	template: nonEmptyStringSchema,
	timeoutSeconds: positiveIntegerSchema,
})

export type GrantConstraints = z.infer<typeof grantConstraintsSchema>

export const grantRecordSchema = z.object({
	id: idSchema("grant", "Expected a grant ID."),
	userId: idSchema("user", "Expected a user ID."),
	projectId: idSchema("project", "Expected a project ID."),
	hostId: idSchema("host", "Expected a host ID."),
	agentId: idSchema("agent", "Expected an agent ID."),
	capabilities: z.array(capabilitySchema).min(1, "Expected at least one capability."),
	constraints: grantConstraintsSchema,
	scope: grantScopeSchema,
	status: grantStatusSchema,
	createdAt: nonEmptyStringSchema,
	expiresAt: nonEmptyStringSchema.optional(),
	approvedAt: nonEmptyStringSchema.optional(),
})

export type GrantRecord = z.infer<typeof grantRecordSchema>

export const requestGrantInputSchema = z.object({
	projectId: idSchema("project", "Expected a project ID."),
	hostId: idSchema("host", "Expected a host ID."),
	agentId: idSchema("agent", "Expected an agent ID."),
	capability: capabilitySchema,
	constraints: grantConstraintsSchema,
})

export type RequestGrantInput = z.infer<typeof requestGrantInputSchema>

export const requestGrantResultSchema = z.object({
	grant: grantRecordSchema,
	approvalUrl: nonEmptyStringSchema,
	created: z.boolean(),
})

export type RequestGrantResult = z.infer<typeof requestGrantResultSchema>

export const approveGrantInputSchema = z.object({
	scope: grantScopeSchema,
})

export type ApproveGrantInput = z.infer<typeof approveGrantInputSchema>

export const authorizeGrantInputSchema = requestGrantInputSchema.extend({
	grantId: idSchema("grant", "Expected a grant ID.").optional(),
})

export type AuthorizeGrantInput = z.infer<typeof authorizeGrantInputSchema>

export const authorizeGrantResultSchema = z.object({
	grant: grantRecordSchema,
	authorized: z.literal(true),
})

export type AuthorizeGrantResult = z.infer<typeof authorizeGrantResultSchema>

export const agentConfigurationResultSchema = z.object({
	issuer: nonEmptyStringSchema,
	capabilities: z.array(capabilitySchema),
	grantRequestEndpoint: nonEmptyStringSchema,
	grantAuthorizationEndpoint: nonEmptyStringSchema,
})

export type AgentConfigurationResult = z.infer<typeof agentConfigurationResultSchema>

export function runProjectCommandHash(input: RunProjectCommandGrantShape): CommandHash {
	const value = runProjectCommandGrantShapeSchema.parse(input)
	const canonical = canonicalJson(value)
	const digest = createHash("sha256").update(canonical).digest("hex")

	return `sha256:${digest}` as CommandHash
}

export function parseGrantRecord(value: unknown): Result<GrantRecord> {
	const result = grantRecordSchema.safeParse(value)

	if (!result.success) {
		return err(validationError("Invalid grant record.", result.error))
	}

	return ok(result.data)
}

export function isGrantRecord(value: unknown): value is GrantRecord {
	return parseGrantRecord(value).ok
}

export function parseRequestGrantInput(value: unknown): Result<RequestGrantInput> {
	const result = requestGrantInputSchema.safeParse(value)

	if (!result.success) {
		return err(validationError("Invalid request grant input.", result.error))
	}

	return ok(result.data)
}

export function isRequestGrantInput(value: unknown): value is RequestGrantInput {
	return parseRequestGrantInput(value).ok
}

export function parseRequestGrantResult(value: unknown): Result<RequestGrantResult> {
	const result = requestGrantResultSchema.safeParse(value)

	if (!result.success) {
		return err(validationError("Invalid request grant result.", result.error))
	}

	return ok(result.data)
}

export function isRequestGrantResult(value: unknown): value is RequestGrantResult {
	return parseRequestGrantResult(value).ok
}

export function parseApproveGrantInput(value: unknown): Result<ApproveGrantInput> {
	const result = approveGrantInputSchema.safeParse(value)

	if (!result.success) {
		return err(validationError("Invalid approve grant input.", result.error))
	}

	return ok(result.data)
}

export function isApproveGrantInput(value: unknown): value is ApproveGrantInput {
	return parseApproveGrantInput(value).ok
}

export function parseAuthorizeGrantInput(value: unknown): Result<AuthorizeGrantInput> {
	const result = authorizeGrantInputSchema.safeParse(value)

	if (!result.success) {
		return err(validationError("Invalid authorize grant input.", result.error))
	}

	return ok(result.data)
}

export function isAuthorizeGrantInput(value: unknown): value is AuthorizeGrantInput {
	return parseAuthorizeGrantInput(value).ok
}

export function parseAuthorizeGrantResult(value: unknown): Result<AuthorizeGrantResult> {
	const result = authorizeGrantResultSchema.safeParse(value)

	if (!result.success) {
		return err(validationError("Invalid authorize grant result.", result.error))
	}

	return ok(result.data)
}

export function isAuthorizeGrantResult(value: unknown): value is AuthorizeGrantResult {
	return parseAuthorizeGrantResult(value).ok
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

export type SandoUri = `sando://${string}`

export const sandoUriSchema = z
	.string()
	.refine((value): value is SandoUri => value.startsWith("sando://"), "Expected a sando URI.")

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

export const artifactRecordSchema = z.object({
	id: idSchema("artifact", "Expected an artifact ID."),
	runId: idSchema("run", "Expected a run ID."),
	projectId: idSchema("project", "Expected a project ID."),
	name: nonEmptyStringSchema,
	path: nonEmptyStringSchema,
	contentType: nonEmptyStringSchema.optional(),
	sizeBytes: nonNegativeIntegerSchema.optional(),
	storageKey: nonEmptyStringSchema,
	private: z.literal(true, "Expected a private artifact."),
	createdAt: nonEmptyStringSchema,
	retentionExpiresAt: nonEmptyStringSchema.optional(),
})

export type ArtifactRecord = z.infer<typeof artifactRecordSchema>

export const listRunArtifactsResultSchema = z.object({
	artifacts: z.array(artifactRecordSchema),
})

export type ListRunArtifactsResult = z.infer<typeof listRunArtifactsResultSchema>

export function parseArtifactRecord(value: unknown): Result<ArtifactRecord> {
	const result = artifactRecordSchema.safeParse(value)

	if (!result.success) {
		return err(validationError("Invalid artifact record.", result.error))
	}

	return ok(result.data)
}

export function isArtifactRecord(value: unknown): value is ArtifactRecord {
	return parseArtifactRecord(value).ok
}

export function parseListRunArtifactsResult(value: unknown): Result<ListRunArtifactsResult> {
	const result = listRunArtifactsResultSchema.safeParse(value)

	if (!result.success) {
		return err(validationError("Invalid list run artifacts result.", result.error))
	}

	return ok(result.data)
}

export function isListRunArtifactsResult(value: unknown): value is ListRunArtifactsResult {
	return parseListRunArtifactsResult(value).ok
}

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
	uriScheme: "sando://",
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

export const agentRecordSchema = z.object({
	id: idSchema("agent", "Expected an agent ID."),
	userId: idSchema("user", "Expected a user ID."),
	hostId: idSchema("host", "Expected a host ID."),
	kind: agentKindSchema,
	displayName: nonEmptyStringSchema,
	createdAt: nonEmptyStringSchema,
	lastSeenAt: nonEmptyStringSchema,
})

export type AgentRecord = z.infer<typeof agentRecordSchema>

export const registerAgentInputSchema = z.object({
	hostId: idSchema("host", "Expected a host ID."),
	kind: agentKindSchema,
	displayName: nonEmptyStringSchema,
})

export type RegisterAgentInput = z.infer<typeof registerAgentInputSchema>

export const agentRegistrationResultSchema = z.object({
	agent: agentRecordSchema,
	created: z.boolean(),
})

export type AgentRegistrationResult = z.infer<typeof agentRegistrationResultSchema>

export function parseAgentRecord(value: unknown): Result<AgentRecord> {
	const result = agentRecordSchema.safeParse(value)

	if (!result.success) {
		return err(validationError("Invalid agent record.", result.error))
	}

	return ok(result.data)
}

export function isAgentRecord(value: unknown): value is AgentRecord {
	return parseAgentRecord(value).ok
}

export function parseRegisterAgentInput(value: unknown): Result<RegisterAgentInput> {
	const result = registerAgentInputSchema.safeParse(value)

	if (!result.success) {
		return err(validationError("Invalid register agent input.", result.error))
	}

	return ok(result.data)
}

export function isRegisterAgentInput(value: unknown): value is RegisterAgentInput {
	return parseRegisterAgentInput(value).ok
}

export function parseAgentRegistrationResult(value: unknown): Result<AgentRegistrationResult> {
	const result = agentRegistrationResultSchema.safeParse(value)

	if (!result.success) {
		return err(validationError("Invalid agent registration result.", result.error))
	}

	return ok(result.data)
}

export function isAgentRegistrationResult(value: unknown): value is AgentRegistrationResult {
	return parseAgentRegistrationResult(value).ok
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

function canonicalJson(value: JsonValue): string {
	if (Array.isArray(value)) {
		return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`
	}

	if (value !== null && typeof value === "object") {
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key] ?? null)}`)
			.join(",")}}`
	}

	return JSON.stringify(value)
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
