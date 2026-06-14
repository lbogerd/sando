#!/usr/bin/env node
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
		case "policy":
			return policyCommand(args)
		case "run":
			return runCommand(args)
		default:
			return failure(64, `Unknown command: ${command}\n\n${helpText()}`)
	}
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
	}
}

function helpText(): string {
	return `sandhost ${cliVersion}

Usage:
  sandhost help
  sandhost version
  sandhost status
  sandhost doctor
  sandhost policy defaults
  sandhost run --command "pnpm test" [--network none|default] [--template node-ts] [--timeout 600]

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
