import { describe, expect, it } from "vitest"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { defaultSandoPolicy } from "@sando/shared"

import {
	appName,
	cliVersion,
	defaultPolicyFile,
	defaultProjectFile,
	defaultSessionFile,
	initializeSandoProject,
	runCli,
} from "./index.js"

describe("sando CLI", () => {
	it("prints help", async () => {
		const result = await runCli(["help"])

		expect(result).toMatchObject({
			exitCode: 0,
			stderr: "",
		})
		expect(result.stdout).toContain(`sando ${cliVersion}`)
		expect(result.stdout).toContain("sando init --codex")
		expect(result.stdout).toContain("sando mcp")
		expect(result.stdout).not.toContain("sando run")
		expect(result.stdout).not.toContain("sando auth")
	})

	it("prints version", async () => {
		await expect(runCli(["version"])).resolves.toEqual({
			exitCode: 0,
			stdout: `${appName} ${cliVersion}\n`,
			stderr: "",
		})
	})

	it("prints status metadata", async () => {
		const result = await runCli(["status"])

		expect(result.exitCode).toBe(0)
		expect(result.stdout).toContain("default template: node-ts")
		expect(result.stdout).toContain("default runtime: podman")
		expect(result.stdout).toContain("supported networks: none, default")
	})

	it("prints default policy JSON", async () => {
		const result = await runCli(["policy", "defaults"])

		expect(result.exitCode).toBe(0)
		expect(JSON.parse(result.stdout)).toEqual(defaultSandoPolicy)
	})

	it("prints a small doctor report", async () => {
		const result = await runCli(["doctor"], {
			SANDO_API_URL: "https://api.example.test",
			SANDO_CODEX_BIN: "missing-codex-for-test",
			WSL_DISTRO_NAME: "Ubuntu",
		})

		expect(result.exitCode).toBe(0)
		expect(JSON.parse(result.stdout)).toMatchObject({
			apiUrl: "https://api.example.test",
			codex: {
				available: false,
				command: "missing-codex-for-test",
				sandoConfigured: null,
			},
			defaultNetwork: "none",
			wsl: {
				detected: true,
				distroName: "Ubuntu",
			},
		})
	})

	it("returns an EX_USAGE-style error for unknown commands", async () => {
		const result = await runCli(["wat"])

		expect(result.exitCode).toBe(64)
		expect(result.stdout).toBe("")
		expect(result.stderr).toContain("Unknown command: wat")
	})

	it("does not expose removed direct run or local auth commands", async () => {
		for (const command of ["run", "auth", "login"]) {
			const result = await runCli([command])

			expect(result.exitCode).toBe(64)
			expect(result.stdout).toBe("")
			expect(result.stderr).toContain(`Unknown command: ${command}`)
		}
	})

	it("initializes project files and configures Codex MCP", async () => {
		const root = mkdtempSync(join(tmpdir(), "sando-cli-init-"))
		const calls: Array<{
			args: readonly string[]
			command: string
			cwd: string
			env?: NodeJS.ProcessEnv
		}> = []

		try {
			writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture-app" }))

			const result = await initializeSandoProject({
				codex: true,
				env: {
					CODEX_HOME: "/tmp/sando-demo-codex",
					HOME: "/tmp/sando-demo-home",
					SANDO_API_URL: "https://api.example.test",
					WSL_DISTRO_NAME: "Ubuntu",
					HOSTNAME: "host-a",
				},
				fetch: fakeHostedFetch(),
				openLoginUrl: () => true,
				now: new Date("2026-06-15T12:00:00.000Z"),
				projectRoot: root,
				runCommand: (command, args, options) => {
					calls.push({
						command,
						args,
						cwd: options.cwd,
						...(options.env === undefined ? {} : { env: options.env }),
					})
					return {
						status: 0,
						stdout: "",
						stderr: "",
					}
				},
			})

			expect(result).toMatchObject({
				projectRoot: root,
				project: {
					path: join(root, defaultProjectFile),
					status: "updated",
				},
				policy: {
					path: join(root, defaultPolicyFile),
					status: "created",
				},
				agents: {
					path: join(root, "AGENTS.md"),
					status: "created",
				},
				codex: {
					command: "codex",
					args: ["mcp", "add", "sando", "--", "sando", "mcp", "--project-root", root],
					status: "configured",
				},
				login: {
					opened: true,
					url: "https://api.example.test/v1/login/login_123",
				},
			})
			expect(calls).toHaveLength(1)
			expect(calls[0]).toMatchObject({
				command: "codex",
				args: ["mcp", "add", "sando", "--", "sando", "mcp", "--project-root", root],
				cwd: root,
				env: {
					CODEX_HOME: "/tmp/sando-demo-codex",
					HOME: "/tmp/sando-demo-home",
					HOSTNAME: "host-a",
					SANDO_API_URL: "https://api.example.test",
					WSL_DISTRO_NAME: "Ubuntu",
				},
			})
			expect(JSON.parse(readFileSync(join(root, defaultProjectFile), "utf8"))).toMatchObject({
				version: 1,
				name: "fixture-app",
				createdAt: "2026-06-15T12:00:00.000Z",
				apiUrl: "https://api.example.test",
				projectId: "proj_123",
				hostId: "host_123",
				agentId: "agent_123",
				mcp: {
					serverName: "sando",
				},
			})
			expect(JSON.parse(readFileSync(join(root, defaultSessionFile), "utf8"))).toMatchObject({
				version: 1,
				token: "session_123",
			})
			expect(JSON.parse(readFileSync(join(root, defaultPolicyFile), "utf8"))).toEqual(
				defaultSandoPolicy,
			)
			expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toContain("sando_run_project_command")
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	it("keeps init idempotent and reports unavailable Codex without failing setup", async () => {
		const root = mkdtempSync(join(tmpdir(), "sando-cli-init-"))

		try {
			const first = await initializeSandoProject({
				codex: false,
				projectRoot: root,
			})
			const second = await initializeSandoProject({
				codex: true,
				env: {
					SANDO_API_URL: "https://api.example.test",
				},
				fetch: fakeHostedFetch(),
				openLoginUrl: () => false,
				projectRoot: root,
				runCommand: () => ({
					error: Object.assign(new Error("spawn codex ENOENT"), { code: "ENOENT" }),
					status: null,
					stdout: "",
					stderr: "",
				}),
			})

			expect(first.project.status).toBe("created")
			expect(second.project.status).toBe("updated")
			expect(second.policy.status).toBe("exists")
			expect(second.agents.status).toBe("exists")
			expect(second.codex).toMatchObject({
				status: "unavailable",
				command: "codex",
			})
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	it("reports the hosted login fallback URL while init waits", async () => {
		const root = mkdtempSync(join(tmpdir(), "sando-cli-init-"))
		const prompts: string[] = []

		try {
			const result = await initializeSandoProject({
				codex: true,
				env: {
					SANDO_API_URL: "https://api.example.test",
					SANDO_CODEX_BIN: "missing-codex-for-test",
				},
				fetch: fakeHostedFetch(),
				onLoginUrl: (prompt) => {
					prompts.push(prompt.url)
				},
				openLoginUrl: () => false,
				projectRoot: root,
			})

			expect(result.login).toEqual({
				opened: false,
				url: "https://api.example.test/v1/login/login_123",
			})
			expect(prompts).toEqual(["https://api.example.test/v1/login/login_123"])
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	it("fails init when hosted login polling times out", async () => {
		const root = mkdtempSync(join(tmpdir(), "sando-cli-init-"))

		try {
			await expect(
				initializeSandoProject({
					codex: true,
					env: {
						SANDO_API_URL: "https://api.example.test",
					},
					fetch: fakeHostedFetch({ loginCompletes: false }),
					hostedLoginPollIntervalMs: 0,
					hostedLoginWaitTimeoutMs: 0,
					openLoginUrl: () => false,
					projectRoot: root,
				}),
			).rejects.toThrow("Timed out waiting for hosted login.")
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})
})

function fakeHostedFetch(options: { readonly loginCompletes?: boolean } = {}): typeof fetch {
	const loginCompletes = options.loginCompletes ?? true

	return async (url, init) => {
		const path = new URL(String(url)).pathname
		const body = init?.body === undefined ? undefined : JSON.parse(String(init.body))

		if (path === "/v1/login/start") {
			return Response.json({
				login: {
					id: "login_123",
					status: "pending",
					createdAt: "2026-06-15T12:00:00.000Z",
					expiresAt: "2026-06-15T12:10:00.000Z",
				},
				loginUrl: "https://api.example.test/v1/login/login_123",
				pollUrl: "https://api.example.test/v1/login/login_123/token",
			})
		}

		if (path === "/v1/login/login_123/token") {
			if (!loginCompletes) {
				return Response.json({ status: "pending" }, { status: 202 })
			}

			return Response.json({
				status: "completed",
				token: "session_123",
				user: { id: "user_123" },
			})
		}

		if (path === "/v1/projects/register") {
			return Response.json(
				{
					project: {
						id: "proj_123",
						...(typeof body === "object" && body !== null ? body : {}),
					},
					created: true,
				},
				{ status: 201 },
			)
		}

		if (path === "/v1/hosts/register") {
			return Response.json(
				{
					host: {
						id: "host_123",
						...(typeof body === "object" && body !== null ? body : {}),
					},
					created: true,
				},
				{ status: 201 },
			)
		}

		if (path === "/v1/agents/register") {
			return Response.json(
				{
					agent: {
						id: "agent_123",
						...(typeof body === "object" && body !== null ? body : {}),
					},
					created: true,
				},
				{ status: 201 },
			)
		}

		return Response.json({ error: "not found" }, { status: 404 })
	}
}
