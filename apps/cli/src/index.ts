#!/usr/bin/env node
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { pathToFileURL } from "node:url"

import {
	defaultSandoPolicy,
	parseRunProjectCommandInput,
	runProjectCommandInputMetadata,
	sandoPolicyMetadata,
	type NetworkMode,
} from "@sando/shared"

export const appName = "sandhost"
export const cliVersion = "0.0.0"
export const defaultSessionFile = ".sandhost/.env"

export type CliResult = {
	readonly exitCode: number
	readonly stderr: string
	readonly stdout: string
}

type RunCommandOptions = {
	readonly command?: string
	readonly network?: string
	readonly template?: string
	readonly timeoutSeconds?: number
}

export type LocalAuthSession = {
	readonly apiUrl?: string
	readonly token: string
	readonly userId?: string
}

type AuthCommandOptions = {
	readonly apiUrl?: string
	readonly sessionFile?: string
	readonly token?: string
	readonly userId?: string
}

export function runCli(
	argv: readonly string[] = process.argv.slice(2),
	env: NodeJS.ProcessEnv = process.env,
): CliResult {
	const [command = "help", ...args] = argv

	switch (command) {
		case "help":
		case "--help":
		case "-h":
			return success(helpText())
		case "version":
		case "--version":
		case "-v":
			return success(`${appName} ${cliVersion}\n`)
		case "status":
			return success(statusText())
		case "doctor":
			return success(`${JSON.stringify(doctorReport(env), null, 2)}\n`)
		case "auth":
			return authCommand(args, env)
		case "login":
			return authSaveCommand(args, env)
		case "policy":
			return policyCommand(args)
		case "run":
			return runCommand(args)
		default:
			return failure(64, `Unknown command: ${command}\n\n${helpText()}`)
	}
}

function authCommand(args: readonly string[], env: NodeJS.ProcessEnv): CliResult {
	const [subcommand = "help", ...rest] = args

	switch (subcommand) {
		case "save":
			return authSaveCommand(rest, env)
		case "show":
			return authShowCommand(rest, env)
		case "clear":
			return authClearCommand(rest, env)
		case "help":
		case "--help":
		case "-h":
			return success(authHelpText())
		default:
			return failure(64, `Unknown auth command: ${subcommand}\n\n${authHelpText()}`)
	}
}

function authSaveCommand(args: readonly string[], env: NodeJS.ProcessEnv): CliResult {
	const parsed = parseAuthArgs(args)

	if (!parsed.ok) {
		return failure(64, `${parsed.error}\n`)
	}

	const token = parsed.value.token ?? env.SANDHOST_SESSION_TOKEN

	if (token === undefined || token.trim().length === 0) {
		return failure(64, "Expected --token or SANDHOST_SESSION_TOKEN.\n")
	}

	const apiUrl = parsed.value.apiUrl ?? env.SANDHOST_API_URL
	const sessionFile = resolveSessionFile(parsed.value.sessionFile, env)
	const session: LocalAuthSession = {
		token,
		...(apiUrl === undefined ? {} : { apiUrl }),
		...(parsed.value.userId === undefined ? {} : { userId: parsed.value.userId }),
	}

	writeLocalAuthSession(sessionFile, session)

	return success(`Saved sandhost auth session to ${sessionFile}\n`)
}

function authShowCommand(args: readonly string[], env: NodeJS.ProcessEnv): CliResult {
	const parsed = parseAuthArgs(args)

	if (!parsed.ok) {
		return failure(64, `${parsed.error}\n`)
	}

	const sessionFile = resolveSessionFile(parsed.value.sessionFile, env)
	const session = readLocalAuthSession(sessionFile)

	return success(
		`${JSON.stringify(
			{
				authenticated: session !== null,
				sessionFile,
				...(session === null
					? {}
					: {
							apiUrl: session.apiUrl ?? null,
							token: "set",
							userId: session.userId ?? null,
						}),
			},
			null,
			2,
		)}\n`,
	)
}

function authClearCommand(args: readonly string[], env: NodeJS.ProcessEnv): CliResult {
	const parsed = parseAuthArgs(args)

	if (!parsed.ok) {
		return failure(64, `${parsed.error}\n`)
	}

	const sessionFile = resolveSessionFile(parsed.value.sessionFile, env)

	rmSync(sessionFile, { force: true })

	return success(`Cleared sandhost auth session at ${sessionFile}\n`)
}

function parseAuthArgs(
	args: readonly string[],
):
	| { readonly ok: true; readonly value: AuthCommandOptions }
	| { readonly ok: false; readonly error: string } {
	const options: {
		apiUrl?: string
		sessionFile?: string
		token?: string
		userId?: string
	} = {}

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index]

		if (arg === undefined) {
			continue
		}

		if (arg === "--help" || arg === "-h") {
			return { ok: false, error: authHelpText() }
		}

		if (arg === "--token") {
			const value = args[index + 1]

			if (value === undefined) {
				return { ok: false, error: "Expected a value after --token." }
			}

			options.token = value
			index += 1
			continue
		}

		if (arg.startsWith("--token=")) {
			options.token = arg.slice("--token=".length)
			continue
		}

		if (arg === "--api-url") {
			const value = args[index + 1]

			if (value === undefined) {
				return { ok: false, error: "Expected a value after --api-url." }
			}

			options.apiUrl = value
			index += 1
			continue
		}

		if (arg.startsWith("--api-url=")) {
			options.apiUrl = arg.slice("--api-url=".length)
			continue
		}

		if (arg === "--user-id") {
			const value = args[index + 1]

			if (value === undefined) {
				return { ok: false, error: "Expected a value after --user-id." }
			}

			options.userId = value
			index += 1
			continue
		}

		if (arg.startsWith("--user-id=")) {
			options.userId = arg.slice("--user-id=".length)
			continue
		}

		if (arg === "--session-file") {
			const value = args[index + 1]

			if (value === undefined) {
				return { ok: false, error: "Expected a value after --session-file." }
			}

			options.sessionFile = value
			index += 1
			continue
		}

		if (arg.startsWith("--session-file=")) {
			options.sessionFile = arg.slice("--session-file=".length)
			continue
		}

		return { ok: false, error: `Unknown auth option: ${arg}` }
	}

	return { ok: true, value: options }
}

function policyCommand(args: readonly string[]): CliResult {
	const [subcommand = "help", ...rest] = args

	if (rest.length > 0) {
		return failure(64, `Unexpected policy arguments: ${rest.join(" ")}\n`)
	}

	switch (subcommand) {
		case "defaults":
			return success(`${JSON.stringify(defaultSandoPolicy, null, 2)}\n`)
		case "help":
		case "--help":
		case "-h":
			return success(policyHelpText())
		default:
			return failure(64, `Unknown policy command: ${subcommand}\n\n${policyHelpText()}`)
	}
}

function runCommand(args: readonly string[]): CliResult {
	if (args.includes("--help") || args.includes("-h")) {
		return success(runHelpText())
	}

	const parsed = parseRunArgs(args)

	if (!parsed.ok) {
		return failure(64, `${parsed.error}\n`)
	}

	const input = parseRunProjectCommandInput(parsed.value)

	if (!input.ok) {
		return failure(
			65,
			`${input.error.code}: ${input.error.message}\n${JSON.stringify(input.error.details, null, 2)}\n`,
		)
	}

	return success(
		`${JSON.stringify(
			{
				command: input.value.command,
				template: input.value.template ?? runProjectCommandInputMetadata.defaults.template,
				network: input.value.network ?? runProjectCommandInputMetadata.defaults.network,
				timeoutSeconds:
					input.value.timeoutSeconds ?? runProjectCommandInputMetadata.defaults.timeoutSeconds,
			},
			null,
			2,
		)}\n`,
	)
}

function parseRunArgs(
	args: readonly string[],
):
	| { readonly ok: true; readonly value: RunCommandOptions }
	| { readonly ok: false; readonly error: string } {
	const options: {
		command?: string
		network?: string
		template?: string
		timeoutSeconds?: number
	} = {}
	const positional: string[] = []

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index]

		if (arg === undefined) {
			continue
		}

		if (arg === "--help" || arg === "-h") {
			return { ok: false, error: runHelpText() }
		}

		if (arg === "--command") {
			const value = args[index + 1]

			if (value === undefined) {
				return { ok: false, error: "Expected a value after --command." }
			}

			options.command = value
			index += 1
			continue
		}

		if (arg.startsWith("--command=")) {
			options.command = arg.slice("--command=".length)
			continue
		}

		if (arg === "--network") {
			const value = args[index + 1]

			if (value === undefined) {
				return { ok: false, error: "Expected a value after --network." }
			}

			options.network = value
			index += 1
			continue
		}

		if (arg.startsWith("--network=")) {
			options.network = arg.slice("--network=".length)
			continue
		}

		if (arg === "--template") {
			const value = args[index + 1]

			if (value === undefined) {
				return { ok: false, error: "Expected a value after --template." }
			}

			options.template = value
			index += 1
			continue
		}

		if (arg.startsWith("--template=")) {
			options.template = arg.slice("--template=".length)
			continue
		}

		if (arg === "--timeout") {
			const value = args[index + 1]

			if (value === undefined) {
				return { ok: false, error: "Expected a value after --timeout." }
			}

			const timeoutSeconds = Number.parseInt(value, 10)

			if (!Number.isFinite(timeoutSeconds)) {
				return { ok: false, error: "Expected --timeout to be an integer number of seconds." }
			}

			options.timeoutSeconds = timeoutSeconds
			index += 1
			continue
		}

		if (arg.startsWith("--timeout=")) {
			const timeoutSeconds = Number.parseInt(arg.slice("--timeout=".length), 10)

			if (!Number.isFinite(timeoutSeconds)) {
				return { ok: false, error: "Expected --timeout to be an integer number of seconds." }
			}

			options.timeoutSeconds = timeoutSeconds
			continue
		}

		if (arg.startsWith("-")) {
			return { ok: false, error: `Unknown run option: ${arg}` }
		}

		positional.push(arg)
	}

	if (options.command === undefined && positional.length > 0) {
		options.command = positional.join(" ")
	}

	return { ok: true, value: options }
}

function statusText(): string {
	return [
		`${appName} ${cliVersion}`,
		`policy version: ${sandoPolicyMetadata.version}`,
		`default template: ${runProjectCommandInputMetadata.defaults.template}`,
		`default runtime: ${defaultSandoPolicy.runtime}`,
		`default network: ${runProjectCommandInputMetadata.defaults.network}`,
		`supported networks: ${runProjectCommandInputMetadata.networks.join(", ")}`,
		"",
	].join("\n")
}

function doctorReport(env: NodeJS.ProcessEnv): {
	readonly apiUrl: string | null
	readonly defaultNetwork: NetworkMode
	readonly platform: NodeJS.Platform
	readonly sessionFile: string
	readonly wsl: {
		readonly detected: boolean
		readonly distroName?: string
	}
} {
	return {
		platform: process.platform,
		wsl: {
			detected: env.WSL_DISTRO_NAME !== undefined || env.WSL_INTEROP !== undefined,
			...(env.WSL_DISTRO_NAME === undefined ? {} : { distroName: env.WSL_DISTRO_NAME }),
		},
		apiUrl: env.SANDHOST_API_URL ?? null,
		defaultNetwork: runProjectCommandInputMetadata.defaults.network,
		sessionFile: resolveSessionFile(undefined, env),
	}
}

function resolveSessionFile(value: string | undefined, env: NodeJS.ProcessEnv): string {
	return resolve(value ?? env.SANDHOST_SESSION_FILE ?? defaultSessionFile)
}

export function writeLocalAuthSession(path: string, session: LocalAuthSession): void {
	mkdirSync(dirname(path), { recursive: true })
	writeFileSync(path, formatSessionEnv(session), { mode: 0o600 })
	chmodSync(path, 0o600)
}

export function readLocalAuthSession(path: string): LocalAuthSession | null {
	if (!existsSync(path)) {
		return null
	}

	const values = parseSessionEnv(readFileSync(path, "utf8"))
	const token = values.SANDHOST_SESSION_TOKEN

	if (token === undefined || token.trim().length === 0) {
		return null
	}

	return {
		token,
		...(values.SANDHOST_API_URL === undefined ? {} : { apiUrl: values.SANDHOST_API_URL }),
		...(values.SANDHOST_USER_ID === undefined ? {} : { userId: values.SANDHOST_USER_ID }),
	}
}

export function formatSessionEnv(session: LocalAuthSession): string {
	return [
		"# sandhost local auth session",
		`SANDHOST_SESSION_TOKEN=${quoteEnvValue(session.token)}`,
		...(session.apiUrl === undefined ? [] : [`SANDHOST_API_URL=${quoteEnvValue(session.apiUrl)}`]),
		...(session.userId === undefined ? [] : [`SANDHOST_USER_ID=${quoteEnvValue(session.userId)}`]),
		"",
	].join("\n")
}

function parseSessionEnv(content: string): Record<string, string> {
	const values: Record<string, string> = {}

	for (const line of content.split(/\r?\n/u)) {
		const trimmed = line.trim()

		if (trimmed.length === 0 || trimmed.startsWith("#")) {
			continue
		}

		const equalsIndex = trimmed.indexOf("=")

		if (equalsIndex === -1) {
			continue
		}

		const key = trimmed.slice(0, equalsIndex).trim()
		const rawValue = trimmed.slice(equalsIndex + 1).trim()

		values[key] = unquoteEnvValue(rawValue)
	}

	return values
}

function quoteEnvValue(value: string): string {
	return JSON.stringify(value)
}

function unquoteEnvValue(value: string): string {
	if (value.startsWith('"')) {
		try {
			const parsed: unknown = JSON.parse(value)

			return typeof parsed === "string" ? parsed : value
		} catch {
			return value
		}
	}

	return value
}

function helpText(): string {
	return `sandhost ${cliVersion}

Usage:
  sandhost help
  sandhost version
  sandhost status
  sandhost doctor
  sandhost auth save --token <token> [--api-url https://api.example] [--user-id user_123]
  sandhost auth show
  sandhost auth clear
  sandhost policy defaults
  sandhost run --command "pnpm test" [--network none|default] [--template node-ts] [--timeout 600]

`
}

function authHelpText(): string {
	return `Usage:
  sandhost auth save --token <token> [--api-url https://api.example] [--user-id user_123] [--session-file .sandhost/.env]
  sandhost auth show [--session-file .sandhost/.env]
  sandhost auth clear [--session-file .sandhost/.env]

`
}

function policyHelpText(): string {
	return `Usage:
  sandhost policy defaults

`
}

function runHelpText(): string {
	return `Usage:
  sandhost run --command "pnpm test" [--network none|default] [--template node-ts] [--timeout 600]

`
}

function success(stdout: string): CliResult {
	return {
		exitCode: 0,
		stdout,
		stderr: "",
	}
}

function failure(exitCode: number, stderr: string): CliResult {
	return {
		exitCode,
		stdout: "",
		stderr,
	}
}

export function main(): void {
	const result = runCli()

	process.stdout.write(result.stdout)
	process.stderr.write(result.stderr)
	process.exitCode = result.exitCode
}

function isMainModule(): boolean {
	const entrypoint = process.argv[1]

	return entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href
}

if (isMainModule()) {
	main()
}
