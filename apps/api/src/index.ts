import { serve, type ServerType } from "@hono/node-server"
import { Hono } from "hono"
import { pathToFileURL } from "node:url"

import { authBasePath, type SandhostAuth } from "@sando/auth"
import { runProjectCommandInputMetadata, sandoPolicyMetadata } from "@sando/shared"

import type { CurrentUserResolver } from "./current-user.js"
import { createHostRoutes, createMemoryHostRepository, type HostRepository } from "./hosts.js"
import {
	createMemoryProjectRepository,
	createProjectRoutes,
	type ProjectRepository,
} from "./projects.js"

export const apiServiceName = "sandhost-api"
export const apiVersion = "v1"

export type HostedAppOptions = {
	readonly auth?: Pick<SandhostAuth, "handler">
	readonly now?: () => Date
	readonly currentUser?: CurrentUserResolver
	readonly hostRepository?: HostRepository
	readonly projectRepository?: ProjectRepository
}

export type HostedServerOptions = HostedAppOptions & {
	readonly hostname?: string
	readonly port?: number
}

export function createHostedApp(options: HostedAppOptions = {}): Hono {
	const now = options.now ?? (() => new Date())
	const currentUser = options.currentUser ?? (() => null)
	const hostRepository = options.hostRepository ?? createMemoryHostRepository()
	const projectRepository = options.projectRepository ?? createMemoryProjectRepository()
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
		...(options.currentUser === undefined ? {} : { currentUser: options.currentUser }),
		...(options.hostRepository === undefined ? {} : { hostRepository: options.hostRepository }),
		...(options.projectRepository === undefined
			? {}
			: { projectRepository: options.projectRepository }),
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
