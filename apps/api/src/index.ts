import { serve, type ServerType } from "@hono/node-server"
import { Hono } from "hono"
import { pathToFileURL } from "node:url"

import { authBasePath, type SandhostAuth } from "@sando/auth"
import {
	runProjectCommandInputMetadata,
	sandboxCapabilities,
	sandoPolicyMetadata,
} from "@sando/shared"

import {
	createAuditEventRoutes,
	createMemoryAuditEventRepository,
	type AuditEventRepository,
} from "./audit-events.js"
import {
	createArtifactRoutes,
	createMemoryArtifactRepository,
	type ArtifactRepository,
} from "./artifacts.js"
import { currentUserResolverFromEnv, type CurrentUserResolver } from "./current-user.js"
import { createGrantRoutes, createMemoryGrantRepository, type GrantRepository } from "./grants.js"
import { createHostRoutes, createMemoryHostRepository, type HostRepository } from "./hosts.js"
import {
	createMemoryProjectRepository,
	createProjectRoutes,
	type ProjectRepository,
} from "./projects.js"
import { createMemoryRunRepository, createRunRoutes, type RunRepository } from "./runs.js"

export const apiServiceName = "sandhost-api"
export const apiVersion = "v1"

export type HostedAppOptions = {
	readonly auth?: Pick<SandhostAuth, "handler">
	readonly now?: () => Date
	readonly auditEventRepository?: AuditEventRepository
	readonly artifactRepository?: ArtifactRepository
	readonly currentUser?: CurrentUserResolver
	readonly grantRepository?: GrantRepository
	readonly hostRepository?: HostRepository
	readonly projectRepository?: ProjectRepository
	readonly runRepository?: RunRepository
}

export type HostedServerOptions = HostedAppOptions & {
	readonly hostname?: string
	readonly port?: number
}

export function createHostedApp(options: HostedAppOptions = {}): Hono {
	const now = options.now ?? (() => new Date())
	const auditEventRepository = options.auditEventRepository ?? createMemoryAuditEventRepository()
	const artifactRepository = options.artifactRepository ?? createMemoryArtifactRepository()
	const currentUser = options.currentUser ?? currentUserResolverFromEnv()
	const grantRepository = options.grantRepository ?? createMemoryGrantRepository()
	const hostRepository = options.hostRepository ?? createMemoryHostRepository()
	const projectRepository = options.projectRepository ?? createMemoryProjectRepository()
	const runRepository = options.runRepository ?? createMemoryRunRepository()
	const app = new Hono()
	const auth = options.auth

	if (auth !== undefined) {
		app.on(["GET", "POST"], `${authBasePath}/*`, (context) => auth.handler(context.req.raw))
	}

	app.get("/", (context) =>
		context.json({
			service: apiServiceName,
			version: apiVersion,
			status: "ok",
		}),
	)

	app.get("/health", (context) =>
		context.json({
			ok: true,
			service: apiServiceName,
			checkedAt: now().toISOString(),
		}),
	)

	app.get("/.well-known/agent-configuration", (context) => {
		const origin = new URL(context.req.url).origin

		return context.json({
			issuer: origin,
			capabilities: sandboxCapabilities,
			grantRequestEndpoint: `${origin}/${apiVersion}/grants/request`,
			grantAuthorizationEndpoint: `${origin}/${apiVersion}/grants/authorize`,
		})
	})

	const v1 = new Hono()

	v1.get("/status", (context) =>
		context.json({
			service: "sandhost-control-plane",
			version: apiVersion,
			status: "ok",
			metadata: {
				policy: {
					version: sandoPolicyMetadata.version,
					runtimes: sandoPolicyMetadata.runtimes,
					networks: sandoPolicyMetadata.networks,
					defaults: sandoPolicyMetadata.defaults,
				},
				runCommand: runProjectCommandInputMetadata,
			},
		}),
	)

	v1.route(
		"/",
		createProjectRoutes({
			currentUser,
			now,
			projectRepository,
		}),
	)
	v1.route(
		"/",
		createHostRoutes({
			currentUser,
			hostRepository,
			now,
		}),
	)
	v1.route(
		"/",
		createRunRoutes({
			currentUser,
			now,
			runRepository,
		}),
	)
	v1.route(
		"/",
		createGrantRoutes({
			auditEventRepository,
			currentUser,
			grantRepository,
			now,
		}),
	)
	v1.route(
		"/",
		createAuditEventRoutes({
			auditEventRepository,
			currentUser,
			now,
		}),
	)
	v1.route(
		"/",
		createArtifactRoutes({
			artifactRepository,
			currentUser,
		}),
	)

	app.route(`/${apiVersion}`, v1)

	app.notFound((context) =>
		context.json(
			{
				error: {
					code: "NOT_FOUND",
					message: "Route not found.",
				},
			},
			404,
		),
	)

	app.onError((error, context) => {
		console.error(error)

		return context.json(
			{
				error: {
					code: "INTERNAL",
					message: "Internal server error.",
				},
			},
			500,
		)
	})

	return app
}

export const app = createHostedApp()

export function serveHostedApp(options: HostedServerOptions = {}): ServerType {
	const port = options.port ?? Number.parseInt(process.env.PORT ?? "3000", 10)
	const hostname = options.hostname ?? process.env.HOST ?? "0.0.0.0"
	const hostedApp = createHostedApp({
		...(options.auth === undefined ? {} : { auth: options.auth }),
		...(options.now === undefined ? {} : { now: options.now }),
		...(options.auditEventRepository === undefined
			? {}
			: { auditEventRepository: options.auditEventRepository }),
		...(options.artifactRepository === undefined
			? {}
			: { artifactRepository: options.artifactRepository }),
		...(options.currentUser === undefined ? {} : { currentUser: options.currentUser }),
		...(options.grantRepository === undefined ? {} : { grantRepository: options.grantRepository }),
		...(options.hostRepository === undefined ? {} : { hostRepository: options.hostRepository }),
		...(options.projectRepository === undefined
			? {}
			: { projectRepository: options.projectRepository }),
		...(options.runRepository === undefined ? {} : { runRepository: options.runRepository }),
	})

	return serve(
		{
			fetch: hostedApp.fetch,
			hostname,
			port,
		},
		(info) => {
			console.log(`${apiServiceName} listening on http://${info.address}:${info.port}`)
		},
	)
}

function isMainModule(): boolean {
	const entrypoint = process.argv[1]

	return entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href
}

if (isMainModule()) {
	serveHostedApp()
}
