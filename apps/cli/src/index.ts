#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { startStdioServer } from "@sando/mcp"
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
export const defaultProjectFile = ".sandhost/project.json"
export const defaultPolicyFile = ".sandhost/policy.json"
export const codexMcpServerName = "sandhost"
export const defaultCodexMcpCommand = ["npx", "-y", "@sandhost/cli", "mcp"] as const

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

type InitCommandOptions = {
	readonly codex: boolean
	readonly projectRoot?: string
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

export type SyncCommandResult = {
	readonly error?: Error
	readonly status: number | null
	readonly stderr: string
	readonly stdout: string
}

export type SyncCommandRunner = (
	command: string,
	args: readonly string[],
	options: { readonly cwd: string },
) => SyncCommandResult

export type InitializeSandhostProjectOptions = {
	readonly codex?: boolean
	readonly codexCommand?: string
	readonly env?: NodeJS.ProcessEnv
	readonly mcpCommand?: readonly string[]
	readonly now?: Date
	readonly projectRoot?: string
	readonly runCommand?: SyncCommandRunner
}

export type InitializeSandhostProjectResult = {
	readonly agents: FileInitStatus
	readonly codex: CodexMcpInitStatus
	readonly policy: FileInitStatus
	readonly project: FileInitStatus
	readonly projectRoot: string
}

export type FileInitStatus = {
	readonly path: string
	readonly status: "created" | "exists" | "updated"
}

export type CodexMcpInitStatus =
	| {
			readonly args: readonly string[]
			readonly command: string
			readonly status: "configured"
	  }
	| {
			readonly args: readonly string[]
			readonly command: string
			readonly error?: string
			readonly status: "failed" | "unavailable"
			readonly stderr: string
	  }
	| {
			readonly status: "skipped"
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
		case "init":
			return initCommand(args, env)
		case "auth":
			return authCommand(args, env)
		case "login":
			return authSaveCommand(args, env)
		case "policy":
			return policyCommand(args)
		case "mcp":
			return mcpCommand(args)
		case "run":
			return runCommand(args)
		default:
			return failure(64, `Unknown command: ${command}\n\n${helpText()}`)
	}
}

function initCommand(args: readonly string[], env: NodeJS.ProcessEnv): CliResult {
	if (args.includes("--help") || args.includes("-h")) {
		return success(initHelpText())
	}

	const parsed = parseInitArgs(args)

	if (!parsed.ok) {
		return failure(64, `${parsed.error}\n`)
	}

	try {
		const result = initializeSandhostProject({
			codex: parsed.value.codex,
			env,
			...(parsed.value.projectRoot === undefined ? {} : { projectRoot: parsed.value.projectRoot }),
		})

		return success(`${JSON.stringify(result, null, 2)}\n`)
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)

		return failure(1, `${message}\n`)
	}
}

function parseInitArgs(
	args: readonly string[],
):
	| { readonly ok: true; readonly value: InitCommandOptions }
	| { readonly ok: false; readonly error: string } {
	const options: {
		codex: boolean
		projectRoot?: string
	} = {
		codex: false,
	}

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index]

		if (arg === undefined) {
			continue
		}

		if (arg === "--codex") {
			options.codex = true
			continue
		}

		if (arg === "--project-root") {
			const value = args[index + 1]

			if (value === undefined) {
				return { ok: false, error: "Expected a value after --project-root." }
			}

			options.projectRoot = value
			index += 1
			continue
		}

		if (arg.startsWith("--project-root=")) {
			options.projectRoot = arg.slice("--project-root=".length)
			continue
		}

		return { ok: false, error: `Unknown init option: ${arg}` }
	}

	return { ok: true, value: options }
}

export function initializeSandhostProject(
	options: InitializeSandhostProjectOptions = {},
): InitializeSandhostProjectResult {
	const env = options.env ?? process.env
	const projectRoot = resolve(options.projectRoot ?? process.cwd())
	const now = options.now ?? new Date()

	mkdirSync(join(projectRoot, ".sandhost"), { recursive: true })

	const project = writeJsonFileIfMissing(
		join(projectRoot, defaultProjectFile),
		defaultProjectConfig(projectRoot, now),
	)
	const policy = writeJsonFileIfMissing(join(projectRoot, defaultPolicyFile), defaultSandoPolicy)
	const agents = upsertAgentsFile(join(projectRoot, "AGENTS.md"))
	const codex =
		options.codex === true
			? configureCodexMcp({
					projectRoot,
					...optionalString("codexCommand", options.codexCommand ?? env.SANDHOST_CODEX_BIN),
					...optionalStringArray(
						"mcpCommand",
						options.mcpCommand ?? parseCommandEnv(env.SANDHOST_CODEX_MCP_COMMAND),
					),
					...(options.runCommand === undefined ? {} : { runCommand: options.runCommand }),
				})
			: { status: "skipped" as const }

	return {
		agents,
		codex,
		policy,
		project,
		projectRoot,
	}
}

function defaultProjectConfig(projectRoot: string, now: Date): Record<string, unknown> {
	return {
		version: 1,
		name: discoverProjectName(projectRoot),
		createdAt: now.toISOString(),
		mcp: {
			serverName: codexMcpServerName,
		},
	}
}

function discoverProjectName(projectRoot: string): string {
	const packageJsonPath = join(projectRoot, "package.json")

	if (existsSync(packageJsonPath)) {
		try {
			const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { name?: unknown }

			if (typeof parsed.name === "string" && parsed.name.trim().length > 0) {
				return parsed.name
			}
		} catch {
			return basename(projectRoot)
		}
	}

	return basename(projectRoot)
}

function writeJsonFileIfMissing(path: string, value: unknown): FileInitStatus {
	if (existsSync(path)) {
		return { path, status: "exists" }
	}

	mkdirSync(dirname(path), { recursive: true })
	writeFileSync(path, `${JSON.stringify(value, null, "\t")}\n`, "utf8")

	return { path, status: "created" }
}

export function upsertAgentsFile(path: string): FileInitStatus {
	const existed = existsSync(path)
	const current = existed ? readFileSync(path, "utf8") : ""
	const next = upsertSandhostAgentsSection(current)

	if (current === next) {
		return { path, status: "exists" }
	}

	writeFileSync(path, next, "utf8")

	return { path, status: existed ? "updated" : "created" }
}

export function upsertSandhostAgentsSection(content: string): string {
	const section = sandhostAgentsSection()
	const markerPattern = /<!-- sandhost:start -->[\s\S]*?<!-- sandhost:end -->/u

	if (markerPattern.test(content)) {
		return content.replace(markerPattern, section)
	}

	const prefix = content.trimEnd()

	if (prefix.length === 0) {
		return `${section}\n`
	}

	return `${prefix}\n\n${section}\n`
}

function sandhostAgentsSection(): string {
	return [
		"<!-- sandhost:start -->",
		"## sandhost",
		"",
		"Use sandhost for commands that may execute generated, dependency-installing, destructive, or risky code.",
		"",
		"Prefer:",
		"",
		"- `sandhost_run_project_command` through MCP",
		'- `sandhost run "<command>"` as a CLI fallback',
		"",
		"Do not apply sandbox changes to the local repo automatically. Inspect `diff.patch` first.",
		"<!-- sandhost:end -->",
	].join("\n")
}

function configureCodexMcp(input: {
	readonly codexCommand?: string
	readonly mcpCommand?: readonly string[]
	readonly projectRoot: string
	readonly runCommand?: SyncCommandRunner
}): CodexMcpInitStatus {
	const command = input.codexCommand ?? "codex"
	const mcpCommand = input.mcpCommand ?? defaultCodexMcpCommand
	const args = ["mcp", "add", codexMcpServerName, "--", ...mcpCommand]
	const runCommand = input.runCommand ?? runSyncCommand
	const result = runCommand(command, args, { cwd: input.projectRoot })

	if (result.status === 0) {
		return {
			command,
			args,
			status: "configured",
		}
	}

	const errorMessage = result.error instanceof Error ? result.error.message : undefined
	const unavailable = result.error !== undefined && nodeErrorCode(result.error) === "ENOENT"

	return {
		command,
		args,
		...(errorMessage === undefined ? {} : { error: errorMessage }),
		status: unavailable ? "unavailable" : "failed",
		stderr: result.stderr,
	}
}

function parseCommandEnv(value: string | undefined): readonly string[] | undefined {
	if (value === undefined || value.trim().length === 0) {
		return undefined
	}

	return value.trim().split(/\s+/u)
}

function optionalString<Key extends string>(
	key: Key,
	value: string | undefined,
): { readonly [Property in Key]?: string } {
	return value === undefined ? {} : ({ [key]: value } as { readonly [Property in Key]?: string })
}

function optionalStringArray<Key extends string>(
	key: Key,
	value: readonly string[] | undefined,
): { readonly [Property in Key]?: readonly string[] } {
	return value === undefined
		? {}
		: ({ [key]: value } as { readonly [Property in Key]?: readonly string[] })
}

function runSyncCommand(
	command: string,
	args: readonly string[],
	options: { readonly cwd: string },
): SyncCommandResult {
	const result = spawnSync(command, [...args], {
		cwd: options.cwd,
		encoding: "utf8",
	})

	return {
		...(result.error === undefined ? {} : { error: result.error }),
		status: result.status,
		stderr: result.stderr ?? "",
		stdout: result.stdout ?? "",
	}
}

function nodeErrorCode(error: Error): string | undefined {
	return typeof (error as NodeJS.ErrnoException).code === "string"
		? (error as NodeJS.ErrnoException).code
		: undefined
}

function mcpCommand(args: readonly string[]): CliResult {
	if (args.length === 0) {
		return success("sandhost MCP server runs over stdio.\n")
	}

	if (args.length === 1 && (args[0] === "--help" || args[0] === "-h" || args[0] === "help")) {
		return success(mcpHelpText())
	}

	return failure(64, `Unknown mcp option: ${args.join(" ")}\n\n${mcpHelpText()}`)
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
	readonly codex: {
		readonly available: boolean
		readonly command: string
		readonly mcpList?: {
			readonly status: number | null
			readonly stderr: string
			readonly stdout: string
		}
		readonly sandhostConfigured: boolean | null
	}
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
		codex: codexDoctorReport(env),
		defaultNetwork: runProjectCommandInputMetadata.defaults.network,
		sessionFile: resolveSessionFile(undefined, env),
	}
}

function codexDoctorReport(env: NodeJS.ProcessEnv): {
	readonly available: boolean
	readonly command: string
	readonly mcpList?: {
		readonly status: number | null
		readonly stderr: string
		readonly stdout: string
	}
	readonly sandhostConfigured: boolean | null
} {
	const command = env.SANDHOST_CODEX_BIN ?? "codex"
	const result = runSyncCommand(command, ["mcp", "list"], { cwd: process.cwd() })

	if (result.error !== undefined && nodeErrorCode(result.error) === "ENOENT") {
		return {
			available: false,
			command,
			sandhostConfigured: null,
		}
	}

	const output = `${result.stdout}\n${result.stderr}`

	return {
		available: result.error === undefined,
		command,
		mcpList: {
			status: result.status,
			stderr: result.stderr,
			stdout: result.stdout,
		},
		sandhostConfigured: output.includes(codexMcpServerName),
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
  sandhost init --codex
  sandhost auth save --token <token> [--api-url https://api.example] [--user-id user_123]
  sandhost auth show
  sandhost auth clear
  sandhost policy defaults
  sandhost mcp
  sandhost run --command "pnpm test" [--network none|default] [--template node-ts] [--timeout 600]

`
}

function initHelpText(): string {
	return `Usage:
  sandhost init [--codex] [--project-root <path>]

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

function mcpHelpText(): string {
	return `Usage:
  sandhost mcp

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

export async function main(): Promise<void> {
	const argv = process.argv.slice(2)

	if (shouldStartMcpServer(argv)) {
		await startStdioServer()
		return
	}

	const result = runCli()

	process.stdout.write(result.stdout)
	process.stderr.write(result.stderr)
	process.exitCode = result.exitCode
}

function shouldStartMcpServer(argv: readonly string[]): boolean {
	const [command, ...args] = argv

	return (
		command === "mcp" && !args.some((arg) => arg === "--help" || arg === "-h" || arg === "help")
	)
}

function isMainModule(): boolean {
	const entrypoint = process.argv[1]

	return entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href
}

if (isMainModule()) {
	main().catch((error: unknown) => {
		const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
		process.stderr.write(`${message}\n`)
		process.exitCode = 1
	})
}
