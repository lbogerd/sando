import { execFile } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { afterEach, describe, expect, it } from "vitest"

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const nodeTsContainerfilePath = resolve(packageRoot, "node-ts", "Containerfile")
const nodeTsRunnerScriptPath = resolve(
	packageRoot,
	"node-ts",
	"rootfs",
	"sandhost",
	"runner",
	"run.sh",
)
const tempRoots: string[] = []
const execFileAsync = promisify(execFile)

afterEach(async () => {
	await Promise.all(tempRoots.splice(0).map((path) => rm(path, { force: true, recursive: true })))
})

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
		expect(containerfile).toContain(
			"COPY --chown=sandhost:sandhost rootfs/sandhost/runner/run.sh /sandhost/runner/run.sh",
		)
		expect(containerfile).toContain("chmod 0755 /sandhost/runner/run.sh")
		expect(containerfile).toContain("useradd --create-home --shell /bin/bash")
		expect(containerfile).toContain("WORKDIR /workspace")
		expect(containerfile).toContain("USER sandhost")
		expect(containerfile).toContain('CMD ["/sandhost/runner/run.sh"]')
	})
})

describe("node-ts sandbox runner script", () => {
	it("is executable", async () => {
		const mode = (await stat(nodeTsRunnerScriptPath)).mode

		expect(mode & 0o111).not.toBe(0)
	})

	it("runs argv commands from the workspace and prepares artifacts", async () => {
		const { artifacts, workspace } = await tempSandboxDirs()

		await execFileAsync(
			nodeTsRunnerScriptPath,
			["bash", "-lc", 'pwd > "$SANDHOST_ARTIFACTS/pwd.txt"'],
			{
				env: sandboxEnv(workspace, artifacts),
			},
		)

		await expect(readFile(join(artifacts, "pwd.txt"), "utf8")).resolves.toBe(`${workspace}\n`)
	})

	it("captures argv command stdout, stderr, and logs", async () => {
		const { artifacts, workspace } = await tempSandboxDirs()

		await expect(
			execFileAsync(
				nodeTsRunnerScriptPath,
				["bash", "-lc", 'printf "out\\n"; printf "err\\n" >&2; exit 7'],
				{
					env: sandboxEnv(workspace, artifacts),
				},
			),
		).rejects.toMatchObject({
			code: 7,
			stdout: "out\n",
			stderr: "err\n",
		})

		await expect(readFile(join(artifacts, "stdout.txt"), "utf8")).resolves.toBe("out\n")
		await expect(readFile(join(artifacts, "stderr.txt"), "utf8")).resolves.toBe("err\n")

		const logs = await readFile(join(artifacts, "logs.txt"), "utf8")
		expect(logs).toContain("out\n")
		expect(logs).toContain("err\n")
	})

	it("runs SANDHOST_COMMAND when no argv command is provided", async () => {
		const { artifacts, workspace } = await tempSandboxDirs()

		await execFileAsync(nodeTsRunnerScriptPath, [], {
			env: {
				...sandboxEnv(workspace, artifacts),
				SANDHOST_COMMAND: 'printf "ok" > "$SANDHOST_ARTIFACTS/result.txt"',
			},
		})

		await expect(readFile(join(artifacts, "result.txt"), "utf8")).resolves.toBe("ok")
	})

	it("captures SANDHOST_COMMAND stdout, stderr, and logs", async () => {
		const { artifacts, workspace } = await tempSandboxDirs()

		const result = await execFileAsync(nodeTsRunnerScriptPath, [], {
			env: {
				...sandboxEnv(workspace, artifacts),
				SANDHOST_COMMAND: 'printf "cmd-out\\n"; printf "cmd-err\\n" >&2',
			},
		})

		expect(result.stdout).toBe("cmd-out\n")
		expect(result.stderr).toBe("cmd-err\n")
		await expect(readFile(join(artifacts, "stdout.txt"), "utf8")).resolves.toBe("cmd-out\n")
		await expect(readFile(join(artifacts, "stderr.txt"), "utf8")).resolves.toBe("cmd-err\n")

		const logs = await readFile(join(artifacts, "logs.txt"), "utf8")
		expect(logs).toContain("cmd-out\n")
		expect(logs).toContain("cmd-err\n")
	})

	it("fails with usage when no command is provided", async () => {
		const { artifacts, workspace } = await tempSandboxDirs()

		await expect(
			execFileAsync(nodeTsRunnerScriptPath, [], {
				env: sandboxEnv(workspace, artifacts),
			}),
		).rejects.toMatchObject({
			code: 64,
			stderr: expect.stringContaining("usage:"),
		})
		await expect(readFile(join(artifacts, "stderr.txt"), "utf8")).resolves.toEqual(
			expect.stringContaining("usage:"),
		)
		await expect(readFile(join(artifacts, "logs.txt"), "utf8")).resolves.toEqual(
			expect.stringContaining("usage:"),
		)
	})
})

async function tempSandboxDirs(): Promise<{ artifacts: string; workspace: string }> {
	const root = await mkdtemp(join(tmpdir(), "sando-template-"))
	const workspace = join(root, "workspace")
	const artifacts = join(root, "artifacts")
	tempRoots.push(root)

	await mkdir(workspace, { recursive: true })

	return { artifacts, workspace }
}

function sandboxEnv(workspace: string, artifacts: string): NodeJS.ProcessEnv {
	return {
		...process.env,
		SANDHOST_WORKSPACE: workspace,
		SANDHOST_ARTIFACTS: artifacts,
	}
}
