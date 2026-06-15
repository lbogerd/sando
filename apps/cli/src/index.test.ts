import { describe, expect, it } from "vitest"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { defaultSandoPolicy } from "@sando/shared"

import {
	appName,
	cliVersion,
	defaultCodexMcpCommand,
	defaultPolicyFile,
	defaultProjectFile,
	formatSessionEnv,
	initializeSandhostProject,
	readLocalAuthSession,
	runCli,
} from "./index.js"

describe("sandhost CLI", () => {
	it("prints help", () => {
		const result = runCli(["help"])

		expect(result).toMatchObject({
			exitCode: 0,
			stderr: "",
		})
		expect(result.stdout).toContain(`sandhost ${cliVersion}`)
		expect(result.stdout).toContain("sandhost init --codex")
		expect(result.stdout).toContain("sandhost mcp")
		expect(result.stdout).toContain("sandhost run --command")
	})

	it("prints version", () => {
		expect(runCli(["version"])).toEqual({
			exitCode: 0,
			stdout: `${appName} ${cliVersion}\n`,
			stderr: "",
		})
	})

	it("prints status metadata", () => {
		const result = runCli(["status"])

		expect(result.exitCode).toBe(0)
		expect(result.stdout).toContain("default template: node-ts")
		expect(result.stdout).toContain("default runtime: podman")
		expect(result.stdout).toContain("supported networks: none, default")
	})

	it("prints default policy JSON", () => {
		const result = runCli(["policy", "defaults"])

		expect(result.exitCode).toBe(0)
		expect(JSON.parse(result.stdout)).toEqual(defaultSandoPolicy)
	})

	it("validates and normalizes run requests", () => {
		const result = runCli(["run", "--command", "pnpm test"])

		expect(result.exitCode).toBe(0)
		expect(JSON.parse(result.stdout)).toEqual({
			command: "pnpm test",
			template: "node-ts",
			network: "none",
			timeoutSeconds: 600,
		})
	})

	it("accepts positional run commands and explicit options", () => {
		const result = runCli([
			"run",
			"pnpm",
			"test",
			"--network=default",
			"--template=node-ts",
			"--timeout=120",
		])

		expect(result.exitCode).toBe(0)
		expect(JSON.parse(result.stdout)).toEqual({
			command: "pnpm test",
			template: "node-ts",
			network: "default",
			timeoutSeconds: 120,
		})
	})

	it("reports validation errors for invalid run requests", () => {
		const result = runCli(["run", "--command", "", "--network", "private"])

		expect(result.exitCode).toBe(65)
		expect(result.stdout).toBe("")
		expect(result.stderr).toContain("VALIDATION_FAILED")
		expect(result.stderr).toContain("Expected a non-empty string.")
		expect(result.stderr).toContain("Expected a supported network mode.")
	})

	it("prints a small doctor report", () => {
		const result = runCli(["doctor"], {
			SANDHOST_API_URL: "https://api.example.test",
			SANDHOST_CODEX_BIN: "missing-codex-for-test",
			SANDHOST_SESSION_FILE: "/tmp/sandhost-session.env",
			WSL_DISTRO_NAME: "Ubuntu",
		})

		expect(result.exitCode).toBe(0)
		expect(JSON.parse(result.stdout)).toMatchObject({
			apiUrl: "https://api.example.test",
			codex: {
				available: false,
				command: "missing-codex-for-test",
				sandhostConfigured: null,
			},
			defaultNetwork: "none",
			sessionFile: "/tmp/sandhost-session.env",
			wsl: {
				detected: true,
				distroName: "Ubuntu",
			},
		})
	})

	it("returns an EX_USAGE-style error for unknown commands", () => {
		const result = runCli(["wat"])

		expect(result.exitCode).toBe(64)
		expect(result.stdout).toBe("")
		expect(result.stderr).toContain("Unknown command: wat")
	})

	it("initializes project files and configures Codex MCP", () => {
		const root = mkdtempSync(join(tmpdir(), "sandhost-cli-init-"))
		const calls: Array<{ args: readonly string[]; command: string; cwd: string }> = []

		try {
			writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture-app" }))

			const result = initializeSandhostProject({
				codex: true,
				now: new Date("2026-06-15T12:00:00.000Z"),
				projectRoot: root,
				runCommand: (command, args, options) => {
					calls.push({ command, args, cwd: options.cwd })
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
					status: "created",
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
					args: ["mcp", "add", "sandhost", "--", ...defaultCodexMcpCommand],
					status: "configured",
				},
			})
			expect(calls).toEqual([
				{
					command: "codex",
					args: ["mcp", "add", "sandhost", "--", ...defaultCodexMcpCommand],
					cwd: root,
				},
			])
			expect(JSON.parse(readFileSync(join(root, defaultProjectFile), "utf8"))).toEqual({
				version: 1,
				name: "fixture-app",
				createdAt: "2026-06-15T12:00:00.000Z",
				mcp: {
					serverName: "sandhost",
				},
			})
			expect(JSON.parse(readFileSync(join(root, defaultPolicyFile), "utf8"))).toEqual(
				defaultSandoPolicy,
			)
			expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toContain(
				"sandhost_run_project_command",
			)
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	it("keeps init idempotent and reports unavailable Codex without failing setup", () => {
		const root = mkdtempSync(join(tmpdir(), "sandhost-cli-init-"))

		try {
			const first = initializeSandhostProject({
				codex: false,
				projectRoot: root,
			})
			const second = initializeSandhostProject({
				codex: true,
				projectRoot: root,
				runCommand: () => ({
					error: Object.assign(new Error("spawn codex ENOENT"), { code: "ENOENT" }),
					status: null,
					stdout: "",
					stderr: "",
				}),
			})

			expect(first.project.status).toBe("created")
			expect(second.project.status).toBe("exists")
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

	it("stores, redacts, and clears local auth sessions", () => {
		const root = mkdtempSync(join(tmpdir(), "sandhost-cli-"))
		const sessionFile = join(root, ".sandhost", ".env")

		try {
			const saved = runCli([
				"auth",
				"save",
				"--token",
				"secret-token",
				"--api-url",
				"https://api.example.test",
				"--user-id",
				"user_123",
				"--session-file",
				sessionFile,
			])

			expect(saved.exitCode).toBe(0)
			expect(saved.stdout).toContain(sessionFile)
			expect(readFileSync(sessionFile, "utf8")).toContain('SANDHOST_SESSION_TOKEN="secret-token"')
			expect(readLocalAuthSession(sessionFile)).toEqual({
				token: "secret-token",
				apiUrl: "https://api.example.test",
				userId: "user_123",
			})

			const shown = runCli(["auth", "show", "--session-file", sessionFile])

			expect(shown.exitCode).toBe(0)
			expect(JSON.parse(shown.stdout)).toEqual({
				authenticated: true,
				sessionFile,
				apiUrl: "https://api.example.test",
				token: "set",
				userId: "user_123",
			})
			expect(shown.stdout).not.toContain("secret-token")

			const cleared = runCli(["auth", "clear", "--session-file", sessionFile])

			expect(cleared.exitCode).toBe(0)
			expect(existsSync(sessionFile)).toBe(false)
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	it("uses environment values when saving local auth sessions", () => {
		const root = mkdtempSync(join(tmpdir(), "sandhost-cli-"))
		const sessionFile = join(root, ".sandhost", ".env")

		try {
			const saved = runCli(["login", "--session-file", sessionFile], {
				SANDHOST_API_URL: "https://api.example.test",
				SANDHOST_SESSION_TOKEN: "env-token",
			})

			expect(saved.exitCode).toBe(0)
			expect(readLocalAuthSession(sessionFile)).toEqual({
				token: "env-token",
				apiUrl: "https://api.example.test",
			})
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	it("reports missing local auth sessions", () => {
		const root = mkdtempSync(join(tmpdir(), "sandhost-cli-"))
		const sessionFile = join(root, ".sandhost", ".env")

		try {
			const result = runCli(["auth", "show", "--session-file", sessionFile])

			expect(result.exitCode).toBe(0)
			expect(JSON.parse(result.stdout)).toEqual({
				authenticated: false,
				sessionFile,
			})
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	it("formats quoted session env values", () => {
		expect(
			formatSessionEnv({
				token: "tok en",
				apiUrl: "https://api.example.test",
			}),
		).toContain('SANDHOST_SESSION_TOKEN="tok en"')
	})
})
