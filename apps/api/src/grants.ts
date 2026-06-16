import { Hono } from "hono"

import {
	asId,
	isIdOfKind,
	parseApproveGrantInput,
	parseAuthorizeGrantInput,
	parseRequestGrantInput,
	sandoError,
	type AppendAuditEventInput,
	type AuthorizeGrantInput,
	type AuthorizeGrantResult,
	type Capability,
	type GrantId,
	type GrantRecord,
	type GrantScope,
	type RequestGrantInput,
	type SandoError,
	type UserId,
} from "@sando/shared"

import type { AuditEventRepository } from "./audit-events.js"
import type { CurrentUserResolver } from "./current-user.js"
import { readJsonBody, unauthorizedError } from "./http.js"

export const projectWindowGrantTtlSeconds = 30 * 60
export const oneShotGrantTtlSeconds = 10 * 60
export const pendingGrantTtlSeconds = 10 * 60

export type RequestGrantCommand = RequestGrantInput & {
	readonly userId: UserId
	readonly now: Date
}

export type RequestGrantRepositoryResult = {
	readonly grant: GrantRecord
	readonly created: boolean
}

export type GetGrantCommand = {
	readonly grantId: GrantId
	readonly now: Date
	readonly userId: UserId
}

export type DecideGrantCommand = {
	readonly grantId: GrantId
	readonly now: Date
	readonly scope?: GrantScope
	readonly userId: UserId
}

export type AuthorizeGrantCommand = AuthorizeGrantInput & {
	readonly now: Date
	readonly userId: UserId
}

export type GrantRepository = {
	readonly requestGrant: (
		input: RequestGrantCommand,
	) => RequestGrantRepositoryResult | Promise<RequestGrantRepositoryResult>
	readonly getGrant: (input: GetGrantCommand) => GrantRecord | null | Promise<GrantRecord | null>
	readonly approveGrant: (
		input: DecideGrantCommand & { readonly scope: GrantScope },
	) => GrantRecord | null | Promise<GrantRecord | null>
	readonly denyGrant: (
		input: DecideGrantCommand,
	) => GrantRecord | null | Promise<GrantRecord | null>
	readonly authorizeGrant: (
		input: AuthorizeGrantCommand,
	) => AuthorizeGrantResult | SandoError | Promise<AuthorizeGrantResult | SandoError>
}

export type MemoryGrantRepositoryOptions = {
	readonly generateId?: () => string
}

export type GrantRoutesOptions = {
	readonly auditEventRepository: AuditEventRepository
	readonly currentUser: CurrentUserResolver
	readonly grantRepository: GrantRepository
	readonly now: () => Date
}

export function createMemoryGrantRepository(
	options: MemoryGrantRepositoryOptions = {},
): GrantRepository {
	const generateId = options.generateId ?? (() => crypto.randomUUID())
	const byId = new Map<GrantId, GrantRecord>()

	return {
		requestGrant(input) {
			const existing = findReusableGrant(byId, input)

			if (existing !== undefined) {
				return {
					grant: existing,
					created: false,
				}
			}

			const now = input.now.toISOString()
			const grant: GrantRecord = {
				id: asId("grant", `grant_${generateId()}`),
				userId: input.userId,
				projectId: input.projectId,
				hostId: input.hostId,
				agentId: input.agentId,
				capabilities: [input.capability],
				constraints: input.constraints,
				scope: "one_shot",
				status: "pending",
				createdAt: now,
				expiresAt: expiresAt(input.now, pendingGrantTtlSeconds),
			}

			byId.set(grant.id, grant)

			return {
				grant,
				created: true,
			}
		},

		getGrant(input) {
			const grant = byId.get(input.grantId)

			if (grant === undefined || grant.userId !== input.userId) {
				return null
			}

			return expireGrantIfNeeded(byId, grant, input.now)
		},

		approveGrant(input) {
			const grant = byId.get(input.grantId)

			if (grant === undefined || grant.userId !== input.userId) {
				return null
			}

			const current = expireGrantIfNeeded(byId, grant, input.now)

			if (current.status !== "pending") {
				return current
			}

			const approved: GrantRecord = {
				...current,
				scope: input.scope,
				status: "approved",
				approvedAt: input.now.toISOString(),
				expiresAt: expiresAt(
					input.now,
					input.scope === "project_window" ? projectWindowGrantTtlSeconds : oneShotGrantTtlSeconds,
				),
			}

			byId.set(approved.id, approved)

			return approved
		},

		denyGrant(input) {
			const grant = byId.get(input.grantId)

			if (grant === undefined || grant.userId !== input.userId) {
				return null
			}

			const current = expireGrantIfNeeded(byId, grant, input.now)

			if (current.status !== "pending") {
				return current
			}

			const denied: GrantRecord = {
				...current,
				status: "denied",
			}

			byId.set(denied.id, denied)

			return denied
		},

		authorizeGrant(input) {
			const grant = findAuthorizingGrant(byId, input)

			if (grant === undefined) {
				return grantRequiredError("No approved grant permits this capability execution.", input)
			}

			const current = expireGrantIfNeeded(byId, grant, input.now)

			if (current.status === "expired") {
				return grantRequiredError("Grant has expired.", input)
			}

			if (current.status === "denied") {
				return grantDeniedError("Grant was denied.", input)
			}

			if (current.status !== "approved") {
				return grantRequiredError("Grant is not approved.", input)
			}

			if (!grantAuthorizesInput(current, input)) {
				return grantRequiredError("Grant constraints do not permit this command.", input)
			}

			if (current.scope === "one_shot") {
				byId.set(current.id, {
					...current,
					status: "revoked",
				})
			}

			return {
				authorized: true,
				grant: current,
			}
		},
	}
}

export function createGrantRoutes(options: GrantRoutesOptions): Hono {
	const routes = new Hono()

	routes.post("/grants/request", async (context) => {
		const currentUser = await options.currentUser(context.req.raw)

		if (currentUser === null) {
			return context.json({ error: unauthorizedError() }, 401)
		}

		const rawBody = await readJsonBody(context.req.raw)

		if (!rawBody.ok) {
			return context.json({ error: rawBody.error }, 400)
		}

		const input = parseRequestGrantInput(rawBody.value)

		if (!input.ok) {
			return context.json({ error: input.error }, 400)
		}

		const result = await options.grantRepository.requestGrant({
			...input.value,
			userId: currentUser.userId,
			now: options.now(),
		})

		if (result.created) {
			await appendGrantAudit(options, {
				type: "grant.requested",
				projectId: result.grant.projectId,
				hostId: result.grant.hostId,
				agentId: result.grant.agentId,
				grantId: result.grant.id,
				metadata: grantAuditMetadata(result.grant, input.value.capability),
				userId: currentUser.userId,
				now: options.now(),
			})
		}

		return context.json(
			{
				grant: result.grant,
				approvalUrl: grantApprovalUrl(context.req.raw, result.grant.id),
				created: result.created,
			},
			result.created ? 201 : 200,
		)
	})

	routes.post("/grants/authorize", async (context) => {
		const currentUser = await options.currentUser(context.req.raw)

		if (currentUser === null) {
			return context.json({ error: unauthorizedError() }, 401)
		}

		const rawBody = await readJsonBody(context.req.raw)

		if (!rawBody.ok) {
			return context.json({ error: rawBody.error }, 400)
		}

		const input = parseAuthorizeGrantInput(rawBody.value)

		if (!input.ok) {
			return context.json({ error: input.error }, 400)
		}

		const result = await options.grantRepository.authorizeGrant({
			...input.value,
			userId: currentUser.userId,
			now: options.now(),
		})

		if ("code" in result) {
			return context.json({ error: result }, grantErrorStatus(result))
		}

		await appendGrantAudit(options, {
			type: "capability.executed",
			projectId: result.grant.projectId,
			hostId: result.grant.hostId,
			agentId: result.grant.agentId,
			grantId: result.grant.id,
			metadata: grantAuditMetadata(result.grant, input.value.capability),
			userId: currentUser.userId,
			now: options.now(),
		})

		return context.json(result)
	})

	routes.get("/grants/:grantId", async (context) => {
		const currentUser = await options.currentUser(context.req.raw)

		if (currentUser === null) {
			return context.json({ error: unauthorizedError() }, 401)
		}

		const grantId = parseGrantIdParam(context.req.param("grantId"))

		if (!grantId.ok) {
			return context.json({ error: grantId.error }, 400)
		}

		const grant = await options.grantRepository.getGrant({
			grantId: grantId.value,
			userId: currentUser.userId,
			now: options.now(),
		})

		if (grant === null) {
			return context.json({ error: grantNotFoundError() }, 404)
		}

		return context.json({ grant })
	})

	routes.get("/grants/:grantId/approval", async (context) => {
		const currentUser = await options.currentUser(context.req.raw)

		if (currentUser === null) {
			return context.html(approvalMessagePage("Authentication required."), 401)
		}

		const grantId = parseGrantIdParam(context.req.param("grantId"))

		if (!grantId.ok) {
			return context.html(approvalMessagePage("Invalid grant ID."), 400)
		}

		const grant = await options.grantRepository.getGrant({
			grantId: grantId.value,
			userId: currentUser.userId,
			now: options.now(),
		})

		if (grant === null) {
			return context.html(approvalMessagePage("Grant not found."), 404)
		}

		return context.html(approvalPage(grant))
	})

	routes.post("/grants/:grantId/approve", async (context) => {
		const currentUser = await options.currentUser(context.req.raw)

		if (currentUser === null) {
			return context.json({ error: unauthorizedError() }, 401)
		}

		const grantId = parseGrantIdParam(context.req.param("grantId"))

		if (!grantId.ok) {
			return context.json({ error: grantId.error }, 400)
		}

		const input = await readApproveGrantInput(context.req.raw)

		if (!input.ok) {
			return context.json({ error: input.error }, 400)
		}

		const grant = await options.grantRepository.approveGrant({
			grantId: grantId.value,
			scope: input.value.scope,
			userId: currentUser.userId,
			now: options.now(),
		})

		if (grant === null) {
			return context.json({ error: grantNotFoundError() }, 404)
		}

		if (grant.status === "approved") {
			await appendGrantAudit(options, {
				type: "grant.approved",
				projectId: grant.projectId,
				hostId: grant.hostId,
				agentId: grant.agentId,
				grantId: grant.id,
				metadata: {
					...grantAuditMetadata(grant, grant.capabilities[0] ?? "sandbox.run_project_command"),
					scope: grant.scope,
				},
				userId: currentUser.userId,
				now: options.now(),
			})
		}

		return acceptsHtml(context.req.raw)
			? context.html(approvalMessagePage("Grant approved. You can return to Codex."))
			: context.json({ grant })
	})

	routes.post("/grants/:grantId/deny", async (context) => {
		const currentUser = await options.currentUser(context.req.raw)

		if (currentUser === null) {
			return context.json({ error: unauthorizedError() }, 401)
		}

		const grantId = parseGrantIdParam(context.req.param("grantId"))

		if (!grantId.ok) {
			return context.json({ error: grantId.error }, 400)
		}

		const grant = await options.grantRepository.denyGrant({
			grantId: grantId.value,
			userId: currentUser.userId,
			now: options.now(),
		})

		if (grant === null) {
			return context.json({ error: grantNotFoundError() }, 404)
		}

		if (grant.status === "denied") {
			await appendGrantAudit(options, {
				type: "grant.denied",
				projectId: grant.projectId,
				hostId: grant.hostId,
				agentId: grant.agentId,
				grantId: grant.id,
				metadata: grantAuditMetadata(grant, grant.capabilities[0] ?? "sandbox.run_project_command"),
				userId: currentUser.userId,
				now: options.now(),
			})
		}

		return acceptsHtml(context.req.raw)
			? context.html(approvalMessagePage("Grant denied. You can return to Codex."))
			: context.json({ grant })
	})

	return routes
}

function findReusableGrant(
	grants: Map<GrantId, GrantRecord>,
	input: RequestGrantCommand,
): GrantRecord | undefined {
	for (const grant of grants.values()) {
		const current = expireGrantIfNeeded(grants, grant, input.now)

		if (current.userId !== input.userId || !sameGrantSubject(current, input)) {
			continue
		}

		if (current.status === "pending" && exactGrantRequestMatch(current, input)) {
			return current
		}

		if (current.status === "approved" && grantAuthorizesInput(current, input)) {
			return current
		}
	}

	return undefined
}

function findAuthorizingGrant(
	grants: ReadonlyMap<GrantId, GrantRecord>,
	input: AuthorizeGrantCommand,
): GrantRecord | undefined {
	if (input.grantId !== undefined) {
		const grant = grants.get(input.grantId)

		if (grant !== undefined && grant.userId === input.userId) {
			return grant
		}
	}

	for (const grant of grants.values()) {
		if (grant.userId === input.userId && grantAuthorizesInput(grant, input)) {
			return grant
		}
	}

	return undefined
}

function exactGrantRequestMatch(grant: GrantRecord, input: RequestGrantCommand): boolean {
	return (
		sameGrantSubject(grant, input) &&
		grant.capabilities.includes(input.capability) &&
		grant.constraints.commandHash === input.constraints.commandHash &&
		grant.constraints.command === input.constraints.command &&
		grant.constraints.template === input.constraints.template &&
		grant.constraints.runtime === input.constraints.runtime &&
		grant.constraints.network === input.constraints.network &&
		grant.constraints.timeoutSeconds === input.constraints.timeoutSeconds &&
		grant.constraints.maxTimeoutSeconds === input.constraints.maxTimeoutSeconds
	)
}

function grantAuthorizesInput(
	grant: GrantRecord,
	input: RequestGrantCommand | AuthorizeGrantCommand,
): boolean {
	if (
		!sameGrantSubject(grant, input) ||
		!grant.capabilities.includes(input.capability) ||
		grant.constraints.template !== input.constraints.template ||
		grant.constraints.runtime !== input.constraints.runtime ||
		grant.constraints.network !== input.constraints.network ||
		input.constraints.timeoutSeconds > grant.constraints.maxTimeoutSeconds
	) {
		return false
	}

	if (grant.scope === "one_shot") {
		return grant.constraints.commandHash === input.constraints.commandHash
	}

	return true
}

function sameGrantSubject(
	grant: GrantRecord,
	input: Pick<RequestGrantCommand, "agentId" | "hostId" | "projectId">,
): boolean {
	return (
		grant.projectId === input.projectId &&
		grant.hostId === input.hostId &&
		grant.agentId === input.agentId
	)
}

function expireGrantIfNeeded(
	grants: Map<GrantId, GrantRecord>,
	grant: GrantRecord,
	now: Date,
): GrantRecord {
	if (grant.expiresAt === undefined || new Date(grant.expiresAt).getTime() > now.getTime()) {
		return grant
	}

	if (grant.status !== "pending" && grant.status !== "approved") {
		return grant
	}

	const expired: GrantRecord = {
		...grant,
		status: "expired",
	}

	grants.set(expired.id, expired)

	return expired
}

function expiresAt(now: Date, ttlSeconds: number): string {
	return new Date(now.getTime() + ttlSeconds * 1000).toISOString()
}

async function appendGrantAudit(
	options: Pick<GrantRoutesOptions, "auditEventRepository" | "now">,
	input: AppendAuditEventInput & { readonly now: Date; readonly userId: UserId },
): Promise<void> {
	await options.auditEventRepository.appendAuditEvent(input)
}

function grantAuditMetadata(grant: GrantRecord, capability: Capability) {
	return {
		capability,
		command: grant.constraints.command,
		commandHash: grant.constraints.commandHash,
		maxTimeoutSeconds: grant.constraints.maxTimeoutSeconds,
		network: grant.constraints.network,
		runtime: grant.constraints.runtime,
		template: grant.constraints.template,
		timeoutSeconds: grant.constraints.timeoutSeconds,
	}
}

function grantApprovalUrl(request: Request, grantId: GrantId): string {
	const url = new URL(request.url)

	return `${url.origin}/v1/grants/${grantId}/approval`
}

function parseGrantIdParam(value: string):
	| { readonly ok: true; readonly value: GrantId }
	| {
			readonly ok: false
			readonly error: SandoError
	  } {
	if (isIdOfKind("grant", value)) {
		return { ok: true, value }
	}

	return {
		ok: false,
		error: sandoError({
			code: "VALIDATION_FAILED",
			message: "Invalid grant ID.",
			details: {
				issues: [{ path: "$.grantId", message: "Expected a grant ID." }],
			},
		}),
	}
}

async function readApproveGrantInput(request: Request) {
	const contentType = request.headers.get("content-type") ?? ""

	if (contentType.includes("application/json")) {
		const rawBody = await readJsonBody(request)

		if (!rawBody.ok) {
			return rawBody
		}

		return parseApproveGrantInput(rawBody.value)
	}

	const form = await request.formData()

	return parseApproveGrantInput({
		scope: form.get("scope"),
	})
}

function acceptsHtml(request: Request): boolean {
	return request.headers.get("accept")?.includes("text/html") ?? false
}

function grantErrorStatus(error: SandoError): 403 | 404 {
	return error.code === "NOT_FOUND" ? 404 : 403
}

function grantNotFoundError(): SandoError {
	return sandoError({
		code: "NOT_FOUND",
		message: "Grant not found.",
	})
}

function grantRequiredError(message: string, input: AuthorizeGrantCommand): SandoError {
	return sandoError({
		code: "GRANT_REQUIRED",
		message,
		details: {
			projectId: input.projectId,
			hostId: input.hostId,
			agentId: input.agentId,
			commandHash: input.constraints.commandHash,
		},
	})
}

function grantDeniedError(message: string, input: AuthorizeGrantCommand): SandoError {
	return sandoError({
		code: "GRANT_DENIED",
		message,
		details: {
			projectId: input.projectId,
			hostId: input.hostId,
			agentId: input.agentId,
			commandHash: input.constraints.commandHash,
		},
	})
}

function approvalPage(grant: GrantRecord): string {
	if (grant.status !== "pending") {
		return approvalMessagePage(`Grant is ${grant.status}. You can return to Codex.`)
	}

	return htmlDocument(
		"Approve sando command",
		`
			<main>
				<h1>Codex wants to run a project command with sando.</h1>
				<dl>
					<dt>Project</dt><dd>${escapeHtml(grant.projectId)}</dd>
					<dt>Machine</dt><dd>${escapeHtml(grant.hostId)}</dd>
					<dt>Agent</dt><dd>${escapeHtml(grant.agentId)}</dd>
					<dt>Command</dt><dd><code>${escapeHtml(grant.constraints.command)}</code></dd>
					<dt>Command hash</dt><dd><code>${escapeHtml(grant.constraints.commandHash)}</code></dd>
					<dt>Runtime</dt><dd>${escapeHtml(grant.constraints.runtime)}</dd>
					<dt>Template</dt><dd>${escapeHtml(grant.constraints.template)}</dd>
					<dt>Network</dt><dd>${escapeHtml(grant.constraints.network)}</dd>
					<dt>Timeout</dt><dd>${grant.constraints.timeoutSeconds}s requested, ${grant.constraints.maxTimeoutSeconds}s max</dd>
				</dl>
				<p>Requested: package workspace, create a local sandbox, run the command, capture logs, capture diff, collect artifacts, and destroy the sandbox.</p>
				<form method="post" action="/v1/grants/${escapeHtml(grant.id)}/approve">
					<button type="submit" name="scope" value="one_shot">Approve once</button>
					<button type="submit" name="scope" value="project_window">Approve for 30 minutes</button>
				</form>
				<form method="post" action="/v1/grants/${escapeHtml(grant.id)}/deny">
					<button type="submit">Deny</button>
				</form>
			</main>
		`,
	)
}

function approvalMessagePage(message: string): string {
	return htmlDocument(
		"sando approval",
		`
			<main>
				<h1>${escapeHtml(message)}</h1>
			</main>
		`,
	)
}

function htmlDocument(title: string, body: string): string {
	return `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>${escapeHtml(title)}</title>
	<style>
		body { font-family: system-ui, sans-serif; margin: 2rem; line-height: 1.45; color: #17202a; }
		main { max-width: 46rem; }
		dl { display: grid; grid-template-columns: max-content 1fr; gap: .5rem 1rem; }
		dt { font-weight: 700; }
		dd { margin: 0; overflow-wrap: anywhere; }
		code { background: #eef2f6; padding: .1rem .25rem; border-radius: .25rem; }
		form { display: inline-block; margin: 1rem .5rem 0 0; }
		button { font: inherit; padding: .65rem .9rem; border: 1px solid #9aa6b2; border-radius: .35rem; background: #fff; cursor: pointer; }
		button:hover { background: #f4f6f8; }
	</style>
</head>
<body>
${body}
</body>
</html>
`
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;")
}
