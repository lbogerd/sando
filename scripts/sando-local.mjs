#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const image = "localhost/sando-node-ts:local"
const fixtureRoot = join(repoRoot, "packages", "runners", "fixtures", "node-ts-basic")
const localRunsRoot = join(repoRoot, ".sando", "local-tests")

const [command = "help", ...args] = process.argv.slice(2)

switch (command) {
	case "doctor":
		doctor()
		break
	case "build-node-ts":
		buildNodeTsImage()
		break
	case "smoke-node-ts":
		smokeNodeTs(args)
		break
	case "help":
	case "--help":
	case "-h":
		help()
		break
	default:
		console.error(`Unknown command: ${command}`)
		help()
		process.exitCode = 64
}

function help() {
	console.log(`sando local test helper

Usage:
  node scripts/sando-local.mjs doctor
  node scripts/sando-local.mjs build-node-ts
  node scripts/sando-local.mjs smoke-node-ts [--skip-build] [--command="pnpm test"]

pnpm aliases:
  pnpm local:doctor
  pnpm local:smoke
`)
}

function doctor() {
	const wsl = detectWsl()
	console.log("Host")
	console.log(`  platform: ${process.platform}`)
	console.log(`  WSL: ${wsl.detected ? "yes" : "no"}`)
	if (wsl.distroName !== undefined) {
		console.log(`  WSL distro: ${wsl.distroName}`)
	}

	const version = run("podman", ["--version"], { capture: true, allowFailure: true })
	reportCommand("podman --version", version)

	if (version.status !== 0) {
		process.exitCode = 1
		return
	}

	const info = run("podman", ["info", "--format", "json"], {
		capture: true,
		allowFailure: true,
	})
	reportCommand("podman info --format json", info)

	if (info.status !== 0) {
		process.exitCode = 1
		return
	}

	try {
		const parsed = JSON.parse(info.stdout)
		const rootless = parsed?.host?.security?.rootless
		const versionText = parsed?.version?.Version ?? parsed?.version?.version
		console.log("Podman info")
		console.log(`  version: ${versionText ?? "unknown"}`)
		console.log(`  rootless: ${rootless === undefined ? "unknown" : String(rootless)}`)
		console.log(`  os/arch: ${parsed?.host?.os ?? "unknown"}/${parsed?.host?.arch ?? "unknown"}`)
	} catch (error) {
		console.log(`Podman info JSON parse warning: ${error.message}`)
	}
}

function buildNodeTsImage() {
	const containerfile = join(repoRoot, "packages", "templates", "node-ts", "Containerfile")
	const context = join(repoRoot, "packages", "templates", "node-ts")

	run("podman", ["build", "--tag", image, "--file", containerfile, context])
	console.log(`Built ${image}`)
}

function smokeNodeTs(args) {
	const options = parseSmokeArgs(args)

	if (!existsSync(fixtureRoot)) {
		throw new Error(`Fixture does not exist: ${fixtureRoot}`)
	}

	if (!options.skipBuild) {
		buildNodeTsImage()
	}

	mkdirSync(localRunsRoot, { recursive: true })

	const runId = `local-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`
	const containerName = `sando-${runId}`
	const artifactRoot = join(localRunsRoot, runId)

	rmSync(artifactRoot, { recursive: true, force: true })
	mkdirSync(artifactRoot, { recursive: true })
	run("podman", ["rm", "--force", containerName], { allowFailure: true, quiet: true })

	let commandResult

	try {
		run("podman", [
			"create",
			"--name",
			containerName,
			"--network",
			"none",
			"--cpus",
			"1",
			"--memory",
			"512m",
			"--workdir",
			"/workspace",
			"--env",
			"SANDO_ARTIFACTS=/artifacts",
			"--env",
			"SANDO_WORKSPACE=/workspace",
			image,
			"sleep",
			"infinity",
		])
		run("podman", ["cp", `${fixtureRoot}/.`, `${containerName}:/workspace/`])
		run("podman", ["start", containerName])

		commandResult = run(
			"podman",
			["exec", containerName, "/sando/runner/run.sh", "bash", "-lc", options.command],
			{ allowFailure: true },
		)

		run("podman", ["cp", `${containerName}:/artifacts/.`, artifactRoot], {
			allowFailure: true,
		})
	} finally {
		run("podman", ["rm", "--force", containerName], { allowFailure: true, quiet: true })
	}

	console.log("")
	console.log(`Artifacts copied to ${artifactRoot}`)
	console.log(`Inspect logs with: sed -n '1,160p' ${join(artifactRoot, "logs.txt")}`)
	console.log(`Inspect diff with: sed -n '1,160p' ${join(artifactRoot, "diff.patch")}`)

	process.exitCode = commandResult?.status ?? 1
}

function parseSmokeArgs(args) {
	let skipBuild = false
	let command = "pnpm test"

	for (const arg of args) {
		if (arg === "--skip-build") {
			skipBuild = true
			continue
		}

		if (arg.startsWith("--command=")) {
			command = arg.slice("--command=".length)
			continue
		}

		throw new Error(`Unknown smoke-node-ts option: ${arg}`)
	}

	return { command, skipBuild }
}

function run(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: repoRoot,
		encoding: "utf8",
		stdio: options.capture || options.quiet ? "pipe" : "inherit",
	})
	const status = result.status ?? 1
	const stdout = result.stdout ?? ""
	const stderr = result.stderr ?? result.error?.message ?? ""

	if (!options.allowFailure && status !== 0) {
		throw new Error(`Command failed (${status}): ${command} ${args.join(" ")}`)
	}

	return {
		status,
		stdout,
		stderr,
	}
}

function reportCommand(label, result) {
	const status = result.status === 0 ? "ok" : `failed (${result.status})`
	console.log(`${label}: ${status}`)
	if (result.stdout.trim().length > 0) {
		console.log(`  stdout: ${result.stdout.trim()}`)
	}
	if (result.stderr.trim().length > 0) {
		console.log(`  stderr: ${result.stderr.trim()}`)
	}
}

function detectWsl() {
	return {
		detected: process.env.WSL_DISTRO_NAME !== undefined || process.env.WSL_INTEROP !== undefined,
		distroName: process.env.WSL_DISTRO_NAME,
	}
}
