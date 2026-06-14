import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const nodeTsContainerfilePath = resolve(packageRoot, "node-ts", "Containerfile")

describe("node-ts Containerfile", () => {
	it("declares the expected base runtime and toolchain", async () => {
		const containerfile = await readFile(nodeTsContainerfilePath, "utf8")

		expect(containerfile).toContain("FROM docker.io/library/node:lts-bookworm")
		expect(containerfile).toContain("ARG PNPM_VERSION=10.30.3")
		expect(containerfile).toContain('npm install --global "pnpm@${PNPM_VERSION}"')

		for (const packageName of [
			"bash",
			"build-essential",
			"ca-certificates",
			"coreutils",
			"curl",
			"git",
			"python3",
			"ripgrep",
		]) {
			expect(containerfile).toContain(packageName)
		}
	})

	it("sets the expected sandbox directories and non-root user", async () => {
		const containerfile = await readFile(nodeTsContainerfilePath, "utf8")

		expect(containerfile).toContain("SANDHOST_WORKSPACE=/workspace")
		expect(containerfile).toContain("SANDHOST_ARTIFACTS=/artifacts")
		expect(containerfile).toContain("mkdir -p /workspace /artifacts /sandhost/runner")
		expect(containerfile).toContain("useradd --create-home --shell /bin/bash")
		expect(containerfile).toContain("WORKDIR /workspace")
		expect(containerfile).toContain("USER sandhost")
		expect(containerfile).toContain('CMD ["bash"]')
	})
})
