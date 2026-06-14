import { describe, expect, it } from "vitest"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { defaultSandoPolicy } from "@sando/shared"

import { appName, cliVersion, formatSessionEnv, readLocalAuthSession, runCli } from "./index.js"

describe("sandhost CLI", () => {
	it("prints help", () => {
		const result = runCli(["help"])

		expect(result).toMatchObject({
			exitCode: 0,
			stderr: "",
		})
		expect(result.stdout).toContain(`sandhost ${cliVersion}`)
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
			SANDHOST_SESSION_FILE: "/tmp/sandhost-session.env",
			WSL_DISTRO_NAME: "Ubuntu",
		})

		expect(result.exitCode).toBe(0)
		expect(JSON.parse(result.stdout)).toMatchObject({
			apiUrl: "https://api.example.test",
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
