#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { startStdioServer } from "@sando/mcp"
import {
	defaultSandoPolicy,
	runProjectCommandInputMetadata,
	sandoPolicyMetadata,
	type NetworkMode,
} from "@sando/shared"

export const appName = "sando"
export const cliVersion = "0.0.0"
export const defaultProjectFile = ".sando/project.json"
export const defaultPolicyFile = ".sando/policy.json"
export const codexMcpServerName = "sando"
export const defaultCodexMcpCommand = ["npx", "-y", "@sando/cli", "mcp"] as const

export type CliResult = {
	readonly exitCode: number
	readonly stderr: string
	readonly stdout: string
}

type InitCommandOptions = {
	readonly codex: boolean
	readonly projectRoot?: string
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

export type InitializeSandoProjectOptions = {
	readonly codex?: boolean
	readonly codexCommand?: string
	readonly env?: NodeJS.ProcessEnv
	readonly mcpCommand?: readonly string[]
	readonly now?: Date
	readonly projectRoot?: string
	readonly runCommand?: SyncCommandRunner
}

export type InitializeSandoProjectResult = {
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
		case "policy":
			return policyCommand(args)
		case "mcp":
			return mcpCommand(args)
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
		const result = initializeSandoProject({
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

export function initializeSandoProject(
	options: InitializeSandoProjectOptions = {},
): InitializeSandoProjectResult {
	const env = options.env ?? process.env
	const projectRoot = resolve(options.projectRoot ?? process.cwd())
	const now = options.now ?? new Date()

	mkdirSync(join(projectRoot, ".sando"), { recursive: true })

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
					...optionalString("codexCommand", options.codexCommand ?? env.SANDO_CODEX_BIN),
					...optionalStringArray(
						"mcpCommand",
						options.mcpCommand ?? parseCommandEnv(env.SANDO_CODEX_MCP_COMMAND),
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
	const next = upsertSandoAgentsSection(current)

	if (current === next) {
		return { path, status: "exists" }
	}

	writeFileSync(path, next, "utf8")

	return { path, status: existed ? "updated" : "created" }
}

export function upsertSandoAgentsSection(content: string): string {
	const section = sandoAgentsSection()
	const markerPattern = /<!-- sando:start -->[\s\S]*?<!-- sando:end -->/u

	if (markerPattern.test(content)) {
		return content.replace(markerPattern, section)
	}

	const prefix = content.trimEnd()

	if (prefix.length === 0) {
		return `${section}\n`
	}

	return `${prefix}\n\n${section}\n`
}

function sandoAgentsSection(): string {
	return [
		"<!-- sando:start -->",
		"## sando",
		"",
		"Use sando for commands that may execute generated, dependency-installing, destructive, or risky code.",
		"",
		"Prefer:",
		"",
		"- `sando_run_project_command` through MCP",
		"",
		"Do not apply sandbox changes to the local repo automatically. Inspect `diff.patch` first.",
		"<!-- sando:end -->",
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
		return success("sando MCP server runs over stdio.\n")
	}

	if (args.length === 1 && (args[0] === "--help" || args[0] === "-h" || args[0] === "help")) {
		return success(mcpHelpText())
	}

	return failure(64, `Unknown mcp option: ${args.join(" ")}\n\n${mcpHelpText()}`)
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
		readonly sandoConfigured: boolean | null
	}
	readonly defaultNetwork: NetworkMode
	readonly platform: NodeJS.Platform
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
		apiUrl: env.SANDO_API_URL ?? null,
		codex: codexDoctorReport(env),
		defaultNetwork: runProjectCommandInputMetadata.defaults.network,
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
	readonly sandoConfigured: boolean | null
} {
	const command = env.SANDO_CODEX_BIN ?? "codex"
	const result = runSyncCommand(command, ["mcp", "list"], { cwd: process.cwd() })

	if (result.error !== undefined && nodeErrorCode(result.error) === "ENOENT") {
		return {
			available: false,
			command,
			sandoConfigured: null,
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
		sandoConfigured: output.includes(codexMcpServerName),
	}
}

function helpText(): string {
	return `sando ${cliVersion}

Usage:
  sando help
  sando version
  sando status
  sando doctor
  sando init --codex
  sando policy defaults
  sando mcp

`
}

function initHelpText(): string {
	return `Usage:
  sando init [--codex] [--project-root <path>]

`
}

function policyHelpText(): string {
	return `Usage:
  sando policy defaults

`
}

function mcpHelpText(): string {
	return `Usage:
  sando mcp

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
