#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const cliDist = join(repoRoot, "apps", "cli", "dist", "index.mjs")

const options = parseArgs(process.argv.slice(2))

if (options.help) {
	help()
	process.exit(0)
}

const tempRoot = mkdtempSync(join(tmpdir(), "sandhost-codex-mcp-"))
const projectRoot = join(tempRoot, "project")
const isolatedHome = join(tempRoot, "home")
const codexHome = join(isolatedHome, ".codex")

try {
	writeFileSync(join(tempRoot, ".keep"), "sandhost codex MCP smoke temp root\n")
	run("mkdir", ["-p", projectRoot, codexHome])
	writeFileSync(
		join(projectRoot, "package.json"),
		`${JSON.stringify({ name: "sandhost-codex-mcp-smoke" }, null, 2)}\n`,
	)

	console.log("Building local sandhost CLI...")
	run("pnpm", ["--filter", "@sando/cli", "build"], { cwd: repoRoot })

	if (!existsSync(cliDist)) {
		throw new Error(`Expected built CLI at ${cliDist}`)
	}

	const codex = options.codexBin
	const codexVersion = run(codex, ["--version"], {
		allowFailure: true,
		capture: true,
		env: codexEnv(),
	})

	if (codexVersion.status !== 0) {
		throw new Error(
			[
				`Could not run ${codex}.`,
				"Install the Codex CLI or pass --codex-bin <path>.",
				codexVersion.stderr.trim(),
			]
				.filter((line) => line.length > 0)
				.join("\n"),
		)
	}

	console.log(`Codex CLI: ${firstLine(codexVersion.stdout) || codex}`)
	console.log(
		options.realCodexHome
			? "Using real Codex config."
			: `Using isolated Codex config: HOME=${isolatedHome} CODEX_HOME=${codexHome}`,
	)

	const mcpCommand = `${process.execPath} ${cliDist} mcp`
	console.log("Running sandhost init --codex with local dist MCP command...")
	const init = run(process.execPath, [cliDist, "init", "--codex", "--project-root", projectRoot], {
		capture: true,
		cwd: repoRoot,
		env: {
			...codexEnv(),
			SANDHOST_CODEX_BIN: codex,
			SANDHOST_CODEX_MCP_COMMAND: mcpCommand,
		},
	})
	const initResult = parseJson(init.stdout, "sandhost init output")

	console.log(`sandhost init codex status: ${initResult.codex?.status ?? "unknown"}`)
	if (initResult.codex?.status !== "configured") {
		throw new Error(`sandhost init did not configure Codex MCP:\n${init.stdout}\n${init.stderr}`)
	}

	console.log("Running codex mcp list...")
	const list = run(codex, ["mcp", "list"], {
		capture: true,
		cwd: projectRoot,
		env: codexEnv(),
	})
	const listOutput = `${list.stdout}\n${list.stderr}`

	if (!listOutput.includes("sandhost")) {
		throw new Error(`codex mcp list did not include sandhost:\n${listOutput}`)
	}

	console.log("")
	console.log("PASS: Codex MCP config includes sandhost.")
	console.log("")
	console.log("Manual /mcp check:")
	console.log(`  cd ${projectRoot}`)
	if (!options.realCodexHome) {
		console.log(`  HOME=${isolatedHome} CODEX_HOME=${codexHome} ${codex}`)
	} else {
		console.log(`  ${codex}`)
	}
	console.log("  /mcp")
	console.log("")
	console.log("Expected: sandhost tools are listed, including sandhost_run_project_command.")

	if (options.keep) {
		console.log("")
		console.log(`Kept temp root: ${tempRoot}`)
	} else {
		console.log("")
		console.log("Temp root will be removed. Re-run with --keep to try the interactive /mcp step.")
	}
} finally {
	if (!options.keep) {
		rmSync(tempRoot, { force: true, recursive: true })
	}
}

function parseArgs(args) {
	const options = {
		codexBin: "codex",
		help: false,
		keep: false,
		realCodexHome: false,
	}

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index]

		if (arg === "--help" || arg === "-h") {
			options.help = true
			continue
		}

		if (arg === "--") {
			continue
		}

		if (arg === "--keep") {
			options.keep = true
			continue
		}

		if (arg === "--real-codex-home") {
			options.realCodexHome = true
			continue
		}

		if (arg === "--codex-bin") {
			const value = args[index + 1]

			if (value === undefined) {
				throw new Error("Expected a value after --codex-bin.")
			}

			options.codexBin = value
			index += 1
			continue
		}

		if (arg.startsWith("--codex-bin=")) {
			options.codexBin = arg.slice("--codex-bin=".length)
			continue
		}

		throw new Error(`Unknown option: ${arg}`)
	}

	return options
}

function help() {
	console.log(`sandhost Codex MCP smoke test

Usage:
  node scripts/sandhost-codex-mcp-smoke.mjs [--keep] [--real-codex-home] [--codex-bin codex]

By default the script uses isolated temporary HOME and CODEX_HOME values so it
does not alter your real Codex config. Use --real-codex-home when you want the
current Codex install to retain the sandhost MCP entry for manual /mcp
inspection.
`)
}

function codexEnv() {
	if (options.realCodexHome) {
		return process.env
	}

	return {
		...process.env,
		HOME: isolatedHome,
		CODEX_HOME: codexHome,
	}
}

function run(command, args, runOptions = {}) {
	const result = spawnSync(command, args, {
		cwd: runOptions.cwd ?? repoRoot,
		encoding: "utf8",
		env: runOptions.env ?? process.env,
		stdio: runOptions.capture ? "pipe" : "inherit",
	})
	const status = result.status ?? 1
	const stdout = result.stdout ?? ""
	const stderr = result.stderr ?? result.error?.message ?? ""

	if (!runOptions.allowFailure && status !== 0) {
		throw new Error(
			[`Command failed (${status}): ${command} ${args.join(" ")}`, stdout.trim(), stderr.trim()]
				.filter((line) => line.length > 0)
				.join("\n"),
		)
	}

	return {
		status,
		stdout,
		stderr,
	}
}

function parseJson(value, label) {
	try {
		return JSON.parse(value)
	} catch (error) {
		throw new Error(`Could not parse ${label}: ${error.message}\n${value}`)
	}
}

function firstLine(value) {
	return value.trim().split(/\r?\n/u)[0] ?? ""
}
