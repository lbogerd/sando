import { describe, expect, it } from "vitest"

import { defaultSandoPolicy } from "@sando/shared"

import { appName, cliVersion, runCli } from "./index.js"

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
			WSL_DISTRO_NAME: "Ubuntu",
		})

		expect(result.exitCode).toBe(0)
		expect(JSON.parse(result.stdout)).toMatchObject({
			apiUrl: "https://api.example.test",
			defaultNetwork: "none",
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
})
