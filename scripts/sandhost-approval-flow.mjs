#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { pathToFileURL } from "node:url"

import { createMemoryAuditEventRepository } from "../apps/api/src/audit-events.ts"
import { createMemoryGrantRepository } from "../apps/api/src/grants.ts"
import { serveHostedApp } from "../apps/api/src/index.ts"
import {
	HostedAgentAuthority,
	projectPolicyFilePath,
	runProjectCommand,
} from "../packages/runners/src/index.ts"
import { asId, defaultSandoPolicy, ok } from "../packages/shared/src/index.ts"

export async function main() {
	const options = parseArgs(process.argv.slice(2))
	const tempRoots = []
	const auditEvents = []
	const auditRepository = createMemoryAuditEventRepository({
		generateId: () => String(auditEvents.length + 1),
	})
	const recordingAuditRepository = {
		appendAuditEvent(input) {
			auditEvents.push(input)
			return auditRepository.appendAuditEvent(input)
		},
	}
	const server = serveHostedApp({
		hostname: "127.0.0.1",
		port: options.port,
		auditEventRepository: recordingAuditRepository,
		currentUser: () => ({ userId: asId("user", "user_manual") }),
		grantRepository: createMemoryGrantRepository({ generateId: idSequence("manual") }),
	})

	try {
		const projectRoot = await createTempProject(tempRoots)
		const artifactRoot = await mkdtemp(join(tmpdir(), "sandhost-approval-artifacts-"))
		tempRoots.push(artifactRoot)
		const authority = new HostedAgentAuthority({
			apiUrl: `http://127.0.0.1:${options.port}`,
			token: "manual-dev-token",
			projectId: asId("project", "proj_manual"),
			hostId: asId("host", "host_manual"),
			agentId: asId("agent", "agent_codex_manual"),
			openApprovalUrl,
			pollIntervalMs: 500,
		})
		const result = await runProjectCommand(
			{
				command: options.command,
				timeoutSeconds: 60,
			},
			{
				authority,
				projectRoot,
				runId: "run_manual",
				runtime: fakeRuntime(artifactRoot),
			},
		)

		console.log(JSON.stringify(result, null, 2))
		console.log("")
		console.log(`Audit events: ${auditEvents.map((event) => event.type).join(", ")}`)
	} finally {
		await new Promise((resolvePromise) => {
			server.close(resolvePromise)
		})
		await Promise.all(tempRoots.map((path) => rm(path, { force: true, recursive: true })))
	}
}

function parseArgs(args) {
	const options = {
		command: "pnpm test",
		port: 3123,
	}

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index]

		if (arg === "--") {
			continue
		}

		if (arg === "--command") {
			options.command = requiredValue(args, index, arg)
			index += 1
			continue
		}

		if (arg?.startsWith("--command=")) {
			options.command = arg.slice("--command=".length)
			continue
		}

		if (arg === "--port") {
			options.port = Number.parseInt(requiredValue(args, index, arg), 10)
			index += 1
			continue
		}

		if (arg?.startsWith("--port=")) {
			options.port = Number.parseInt(arg.slice("--port=".length), 10)
			continue
		}

		if (arg === "--help" || arg === "-h") {
			console.log(`Usage:
  pnpm approval:manual
  pnpm approval:manual -- --command "pnpm build" --port 3124
`)
			process.exit(0)
		}

		throw new Error(`Unknown option: ${arg}`)
	}

	if (!Number.isFinite(options.port)) {
		throw new Error("Expected --port to be an integer.")
	}

	return options
}

function requiredValue(args, index, name) {
	const value = args[index + 1]

	if (value === undefined) {
		throw new Error(`Expected a value after ${name}.`)
	}

	return value
}

async function createTempProject(tempRoots) {
	const root = await mkdtemp(join(tmpdir(), "sandhost-approval-project-"))
	tempRoots.push(root)

	await mkdir(join(root, dirname(projectPolicyFilePath)), { recursive: true })
	await writeFile(
		join(root, projectPolicyFilePath),
		`${JSON.stringify(defaultSandoPolicy, null, 2)}\n`,
	)
	await writeFile(
		join(root, "package.json"),
		`${JSON.stringify({ name: "sandhost-approval-manual", scripts: { test: "node -e true" } }, null, 2)}\n`,
	)
	await writeFile(join(root, "README.md"), "# sandhost approval manual project\n")
	execFileSync("git", ["init"], { cwd: root, stdio: "ignore" })
	execFileSync("git", ["config", "user.email", "sandhost@example.local"], {
		cwd: root,
		stdio: "ignore",
	})
	execFileSync("git", ["config", "user.name", "sandhost"], {
		cwd: root,
		stdio: "ignore",
	})
	execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" })
	execFileSync("git", ["commit", "-m", "manual approval fixture"], {
		cwd: root,
		stdio: "ignore",
	})

	return root
}

function fakeRuntime(artifactRoot) {
	return {
		kind: "podman",
		createSandbox: async (input) =>
			ok({
				id: "manual-sandbox",
				runtime: "podman",
				runId: input.runId,
				metadata: {},
			}),
		uploadWorkspace: async () => ok(undefined),
		runCommand: async (_handle, command) =>
			ok({
				status: "succeeded",
				exitCode: 0,
				stdout: `fake runtime accepted: ${command.command}\n`,
				stderr: "",
				logs: `fake runtime accepted: ${command.command}\n`,
				startedAt: new Date().toISOString(),
				finishedAt: new Date().toISOString(),
				durationMs: 1,
			}),
		collectArtifacts: async () => {
			const rootPath = join(artifactRoot, "run_manual")
			await mkdir(rootPath, { recursive: true })
			const logsPath = join(rootPath, "logs.txt")
			const stdoutPath = join(rootPath, "stdout.txt")
			const stderrPath = join(rootPath, "stderr.txt")
			const diffPath = join(rootPath, "diff.patch")
			const changedFilesPath = join(rootPath, "changed-files.txt")
			const resultPath = join(rootPath, "result.json")

			await writeFile(logsPath, "manual fake runtime logs\n")
			await writeFile(stdoutPath, "manual fake runtime stdout\n")
			await writeFile(stderrPath, "")
			await writeFile(diffPath, "")
			await writeFile(changedFilesPath, "")
			await writeFile(resultPath, "{}\n")

			return ok({
				rootPath,
				logsPath,
				diffPath,
				changedFilesPath,
				resultPath,
				artifacts: [
					{ name: "logs.txt", path: logsPath, contentType: "text/plain", sizeBytes: 25 },
					{ name: "stdout.txt", path: stdoutPath, contentType: "text/plain", sizeBytes: 27 },
					{ name: "stderr.txt", path: stderrPath, contentType: "text/plain", sizeBytes: 0 },
					{ name: "diff.patch", path: diffPath, contentType: "text/plain", sizeBytes: 0 },
					{
						name: "changed-files.txt",
						path: changedFilesPath,
						contentType: "text/plain",
						sizeBytes: 0,
					},
					{ name: "result.json", path: resultPath, contentType: "application/json", sizeBytes: 3 },
				],
			})
		},
		destroySandbox: async () => ok(undefined),
	}
}

export async function openApprovalUrl(
	url,
	{
		env = process.env,
		platform = process.platform,
		spawnCommand = spawn,
		stdout = console.log,
		stderr = console.warn,
	} = {},
) {
	stdout("")
	stdout(`Approval URL: ${url}`)
	stdout("Choose Approve once, Approve for 30 minutes, or Deny in the browser.")

	const command = browserOpenCommand(url, { env, platform })

	if (command === undefined) {
		return
	}

	const child = spawnCommand(command.command, command.args, {
		detached: true,
		stdio: "ignore",
	})

	child.on("error", (error) => {
		stderr(`Could not open the approval URL automatically: ${error.message}`)
		stderr(`Open this URL manually: ${url}`)
	})
	child.unref()
}

export function browserOpenCommand(url, { env = process.env, platform = process.platform } = {}) {
	if (platform === "darwin") {
		return { command: "open", args: [url] }
	}

	if (platform === "win32") {
		return { command: "cmd.exe", args: ["/c", "start", "", url] }
	}

	if (env.WSL_DISTRO_NAME !== undefined || env.WSL_INTEROP !== undefined) {
		return { command: "wslview", args: [url] }
	}

	if (platform === "linux") {
		return { command: "xdg-open", args: [url] }
	}

	return undefined
}

function idSequence(...ids) {
	let index = 0

	return () => ids[index++] ?? `extra_${index}`
}

function isMainModule() {
	const entrypoint = process.argv[1]

	return entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href
}

if (isMainModule()) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.stack || error.message : String(error))
		process.exitCode = 1
	})
}
