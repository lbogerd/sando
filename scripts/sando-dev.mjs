#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")

export const devDefaults = {
	apiHost: "127.0.0.1",
	apiPort: 3000,
	devAuthToken: "sando-dev-token",
	devUserId: "user_dev",
	postgresContainerName: "sando-postgres",
	postgresDatabase: "sando",
	postgresImage: "docker.io/library/postgres:16-alpine",
	postgresPassword: "sando",
	postgresPort: 54329,
	postgresUser: "sando",
	postgresVolume: "sando-postgres-data",
}

export function parseDevArgs(args) {
	const options = {
		apiHost: devDefaults.apiHost,
		apiPort: devDefaults.apiPort,
		keepPodman: false,
		postgresContainerName: devDefaults.postgresContainerName,
		postgresDatabase: devDefaults.postgresDatabase,
		postgresImage: devDefaults.postgresImage,
		postgresPassword: devDefaults.postgresPassword,
		postgresPort: devDefaults.postgresPort,
		postgresUser: devDefaults.postgresUser,
		postgresVolume: devDefaults.postgresVolume,
		skipApi: false,
		skipPodman: false,
	}

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index]

		if (arg === "--help" || arg === "-h") {
			return { ok: true, help: true, options }
		}

		if (arg === "--") {
			continue
		}

		if (arg === "--skip-podman" || arg === "--api-only") {
			options.skipPodman = true
			continue
		}

		if (arg === "--skip-api" || arg === "--db-only") {
			options.skipApi = true
			continue
		}

		if (arg === "--keep-podman") {
			options.keepPodman = true
			continue
		}

		const parsed = parseOptionValue(args, index, arg, {
			"--api-host": "string",
			"--api-port": "number",
			"--postgres-container": "string",
			"--postgres-db": "string",
			"--postgres-image": "string",
			"--postgres-password": "string",
			"--postgres-port": "number",
			"--postgres-user": "string",
			"--postgres-volume": "string",
		})

		if (!parsed.ok) {
			return parsed
		}

		if (parsed.matched) {
			switch (parsed.name) {
				case "--api-host":
					options.apiHost = parsed.value
					break
				case "--api-port":
					options.apiPort = parsed.value
					break
				case "--postgres-container":
					options.postgresContainerName = parsed.value
					break
				case "--postgres-db":
					options.postgresDatabase = parsed.value
					break
				case "--postgres-image":
					options.postgresImage = parsed.value
					break
				case "--postgres-password":
					options.postgresPassword = parsed.value
					break
				case "--postgres-port":
					options.postgresPort = parsed.value
					break
				case "--postgres-user":
					options.postgresUser = parsed.value
					break
				case "--postgres-volume":
					options.postgresVolume = parsed.value
					break
			}

			index = parsed.nextIndex
			continue
		}

		return { ok: false, error: `Unknown dev option: ${arg}` }
	}

	return { ok: true, help: false, options }
}

function parseOptionValue(args, index, arg, schema) {
	const equalsIndex = arg.indexOf("=")
	const rawName = equalsIndex === -1 ? arg : arg.slice(0, equalsIndex)
	const kind = schema[rawName]

	if (kind === undefined) {
		return { ok: true, matched: false }
	}

	const rawValue = equalsIndex === -1 ? args[index + 1] : arg.slice(equalsIndex + 1)

	if (rawValue === undefined) {
		return { ok: false, error: `Expected a value after ${rawName}.` }
	}

	if (kind === "number") {
		const value = Number.parseInt(rawValue, 10)

		if (!Number.isFinite(value)) {
			return { ok: false, error: `Expected ${rawName} to be an integer.` }
		}

		return {
			ok: true,
			matched: true,
			name: rawName,
			nextIndex: equalsIndex === -1 ? index + 1 : index,
			value,
		}
	}

	return {
		ok: true,
		matched: true,
		name: rawName,
		nextIndex: equalsIndex === -1 ? index + 1 : index,
		value: rawValue,
	}
}

export function databaseUrl(options) {
	return `postgresql://${encodeURIComponent(options.postgresUser)}:${encodeURIComponent(
		options.postgresPassword,
	)}@127.0.0.1:${options.postgresPort}/${encodeURIComponent(options.postgresDatabase)}`
}

export function apiEnv(baseEnv, options) {
	const apiUrl = `http://${options.apiHost}:${options.apiPort}`

	return {
		...baseEnv,
		BETTER_AUTH_SECRET: baseEnv.BETTER_AUTH_SECRET ?? "sando-dev-better-auth-secret",
		BETTER_AUTH_URL: baseEnv.BETTER_AUTH_URL ?? apiUrl,
		DATABASE_URL: baseEnv.DATABASE_URL ?? databaseUrl(options),
		HOST: baseEnv.HOST ?? options.apiHost,
		PORT: baseEnv.PORT ?? String(options.apiPort),
		SANDO_DEV_AUTH_TOKEN: baseEnv.SANDO_DEV_AUTH_TOKEN ?? devDefaults.devAuthToken,
		SANDO_DEV_USER_ID: baseEnv.SANDO_DEV_USER_ID ?? devDefaults.devUserId,
		TMPDIR: baseEnv.TMPDIR ?? "/tmp",
	}
}

export function podmanPostgresRunArgs(options) {
	return [
		"run",
		"--detach",
		"--replace",
		"--name",
		options.postgresContainerName,
		"--publish",
		`${options.postgresPort}:5432`,
		"--env",
		`POSTGRES_DB=${options.postgresDatabase}`,
		"--env",
		`POSTGRES_PASSWORD=${options.postgresPassword}`,
		"--env",
		`POSTGRES_USER=${options.postgresUser}`,
		"--volume",
		`${options.postgresVolume}:/var/lib/postgresql/data`,
		options.postgresImage,
	]
}

export function helpText() {
	return `sando local development stack

Usage:
  pnpm dev
  pnpm dev -- --skip-podman
  pnpm dev -- --db-only
  pnpm dev -- --api-port 3001 --postgres-port 54330

Starts:
  - Podman Postgres container: ${devDefaults.postgresContainerName}
  - Hosted API: http://${devDefaults.apiHost}:${devDefaults.apiPort}

Development auth:
  Authorization: Bearer ${devDefaults.devAuthToken}
  User: ${devDefaults.devUserId}

Options:
  --skip-podman, --api-only      Start only the API process.
  --skip-api, --db-only          Start only the Podman Postgres container.
  --keep-podman                  Leave the Postgres container running on exit.
  --api-host <host>              API host. Default: ${devDefaults.apiHost}
  --api-port <port>              API port. Default: ${devDefaults.apiPort}
  --postgres-port <port>         Host Postgres port. Default: ${devDefaults.postgresPort}
  --postgres-container <name>    Podman container name.
  --postgres-volume <name>       Podman volume name.
  --postgres-image <image>       Postgres image.
  --postgres-user <user>         Postgres user.
  --postgres-password <password> Postgres password.
  --postgres-db <database>       Postgres database.

`
}

async function main() {
	const parsed = parseDevArgs(process.argv.slice(2))

	if (!parsed.ok) {
		console.error(parsed.error)
		console.error("")
		console.error(helpText())
		process.exitCode = 64
		return
	}

	if (parsed.help) {
		process.stdout.write(helpText())
		return
	}

	const options = parsed.options
	let postgresStarted = false

	try {
		if (!options.skipPodman) {
			ensurePodman()
			startPostgres(options)
			postgresStarted = true
			await waitForPostgres(options)
			console.log(`Postgres ready: ${databaseUrl(options)}`)
		}

		if (options.skipApi) {
			console.log("API skipped. Stop the database with Ctrl-C.")
			await waitUntilInterrupted()
			return
		}

		prepareDatabase(options)
		const api = startApi(options)

		for (const signal of ["SIGINT", "SIGTERM"]) {
			process.once(signal, () => {
				api.kill(signal)
			})
		}

		process.exitCode = await waitForChild(api)
	} finally {
		if (postgresStarted && !options.keepPodman) {
			stopPostgres(options)
		}
	}
}

function ensurePodman() {
	const result = spawnSync("podman", ["--version"], {
		encoding: "utf8",
		stdio: "pipe",
	})

	if (result.status !== 0) {
		const detail = result.stderr?.trim() || result.error?.message || "podman is not available"

		throw new Error(`Podman is required for pnpm dev unless --skip-podman is set: ${detail}`)
	}
}

function startPostgres(options) {
	run("podman", podmanPostgresRunArgs(options))
}

async function waitForPostgres(options) {
	for (let attempt = 0; attempt < 60; attempt += 1) {
		const result = spawnSync(
			"podman",
			[
				"exec",
				options.postgresContainerName,
				"pg_isready",
				"--username",
				options.postgresUser,
				"--dbname",
				options.postgresDatabase,
			],
			{
				encoding: "utf8",
				stdio: "pipe",
			},
		)

		if (result.status === 0) {
			return
		}

		await delay(500)
	}

	throw new Error(`Timed out waiting for ${options.postgresContainerName} to accept connections.`)
}

function startApi(options) {
	const env = apiEnv(process.env, options)
	const apiUrl = `http://${env.HOST}:${env.PORT}`

	console.log(`API starting: ${apiUrl}`)

	return spawn(tsxExecutable(), ["apps/api/src/index.ts"], {
		cwd: repoRoot,
		env,
		stdio: "inherit",
	})
}

export function drizzleKitMigrateArgs() {
	return ["migrate", "--config", "drizzle.config.ts"]
}

export function databasePrepareArgs() {
	return ["scripts/sando-prepare-database.ts"]
}

export function databaseVerifyArgs() {
	return ["scripts/sando-verify-database.ts"]
}

function prepareDatabase(options) {
	const env = apiEnv(process.env, options)

	console.log("Preparing database schema")
	run(tsxExecutable(), databasePrepareArgs(), {
		env,
	})

	console.log("Applying database migrations with drizzle-kit migrate")
	run(drizzleKitExecutable(), drizzleKitMigrateArgs(), {
		env,
	})

	console.log("Verifying database schema")
	run(tsxExecutable(), databaseVerifyArgs(), {
		env,
	})
}

function drizzleKitExecutable() {
	const executable = process.platform === "win32" ? "drizzle-kit.cmd" : "drizzle-kit"
	const local = resolve(repoRoot, "node_modules", ".bin", executable)

	return existsSync(local) ? local : executable
}

function tsxExecutable() {
	const executable = process.platform === "win32" ? "tsx.cmd" : "tsx"
	const local = resolve(repoRoot, "node_modules", ".bin", executable)

	return existsSync(local) ? local : executable
}

function stopPostgres(options) {
	run("podman", ["stop", options.postgresContainerName], {
		allowFailure: true,
		quiet: true,
	})
}

function run(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: repoRoot,
		encoding: "utf8",
		env: options.env ?? process.env,
		stdio: options.quiet ? "pipe" : "inherit",
	})

	if (!options.allowFailure && result.status !== 0) {
		throw new Error(`Command failed (${result.status ?? 1}): ${command} ${args.join(" ")}`)
	}

	return result
}

function waitForChild(child) {
	return new Promise((resolvePromise) => {
		child.on("exit", (code, signal) => {
			if (code !== null) {
				resolvePromise(code)
				return
			}

			resolvePromise(signal === "SIGINT" ? 130 : 1)
		})
	})
}

function waitUntilInterrupted() {
	return new Promise((resolvePromise) => {
		for (const signal of ["SIGINT", "SIGTERM"]) {
			process.once(signal, resolvePromise)
		}
	})
}

function delay(ms) {
	return new Promise((resolvePromise) => {
		setTimeout(resolvePromise, ms)
	})
}

function isMainModule() {
	const entrypoint = process.argv[1]

	return entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href
}

if (isMainModule()) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error))
		process.exitCode = 1
	})
}
