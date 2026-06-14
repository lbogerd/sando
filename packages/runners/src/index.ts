import { lstat, readFile } from "node:fs/promises"
import { dirname, isAbsolute, join, parse as parsePath, resolve } from "node:path"

import { err, ok, parseSandoPolicy, sandoError, type Result, type SandoPolicy } from "@sando/shared"

export const packageName = "runners"

export const projectPolicyFilePath = ".sandhost/policy.json"

export const projectRootStrongMarkers = [
	projectPolicyFilePath,
	".git",
	"pnpm-workspace.yaml",
] as const

export const projectRootFallbackMarkers = ["package.json"] as const

export type ProjectRootMarker =
	| (typeof projectRootStrongMarkers)[number]
	| (typeof projectRootFallbackMarkers)[number]

export type ProjectRoot = {
	readonly path: string
	readonly marker: ProjectRootMarker
}

export type FindProjectRootInput = {
	readonly startPath?: string
}

export type LoadedProjectPolicy = {
	readonly projectRoot: string
	readonly path: string
	readonly policy: SandoPolicy
}

export type LoadProjectPolicyInput = {
	readonly startPath?: string
	readonly projectRoot?: string
}

export async function findProjectRoot(
	input: FindProjectRootInput = {},
): Promise<Result<ProjectRoot>> {
	const startPath = resolve(input.startPath ?? process.cwd())
	const startDirectory = await resolveStartDirectory(startPath)

	if (!startDirectory.ok) {
		return startDirectory
	}

	let fallback: ProjectRoot | undefined

	for (const directory of ancestorDirectories(startDirectory.value)) {
		const strongMarker = await findExistingMarker(directory, projectRootStrongMarkers)

		if (strongMarker !== undefined) {
			return ok({ path: directory, marker: strongMarker })
		}

		fallback ??= await findFallbackRoot(directory)
	}

	if (fallback !== undefined) {
		return ok(fallback)
	}

	return err(
		sandoError({
			code: "NOT_FOUND",
			message: "Could not find a project root.",
			details: {
				startPath,
				markers: [...projectRootStrongMarkers, ...projectRootFallbackMarkers],
			},
		}),
	)
}

export async function loadProjectPolicy(
	input: LoadProjectPolicyInput = {},
): Promise<Result<LoadedProjectPolicy>> {
	const projectRoot = await resolvePolicyProjectRoot(input)

	if (!projectRoot.ok) {
		return projectRoot
	}

	const policyPath = join(projectRoot.value, projectPolicyFilePath)
	const file = await readTextFile(policyPath)

	if (!file.ok) {
		return file
	}

	const json = parseJsonFile(file.value, policyPath)

	if (!json.ok) {
		return json
	}

	const policy = parseSandoPolicy(json.value)

	if (!policy.ok) {
		return err(
			sandoError({
				code: "VALIDATION_FAILED",
				message: "Invalid sandhost policy file.",
				details: { path: policyPath },
				cause: policy.error,
			}),
		)
	}

	return ok({
		projectRoot: projectRoot.value,
		path: policyPath,
		policy: policy.value,
	})
}

async function resolvePolicyProjectRoot(input: LoadProjectPolicyInput): Promise<Result<string>> {
	if (input.projectRoot !== undefined) {
		return ok(resolve(input.projectRoot))
	}

	const projectRoot =
		input.startPath === undefined
			? await findProjectRoot()
			: await findProjectRoot({ startPath: input.startPath })

	if (!projectRoot.ok) {
		return err(projectRoot.error)
	}

	return ok(projectRoot.value.path)
}

async function readTextFile(path: string): Promise<Result<string>> {
	try {
		return ok(await readFile(path, "utf8"))
	} catch (error) {
		if (!isNodeError(error)) {
			throw error
		}

		if (error.code === "ENOENT") {
			return err(
				sandoError({
					code: "NOT_FOUND",
					message: "Sandhost policy file does not exist.",
					details: { path },
				}),
			)
		}

		if (error.code === "EACCES" || error.code === "EPERM") {
			return err(
				sandoError({
					code: "FORBIDDEN",
					message: "Sandhost policy file is not readable.",
					details: { path },
				}),
			)
		}

		if (error.code === "EISDIR") {
			return err(
				sandoError({
					code: "VALIDATION_FAILED",
					message: "Sandhost policy path is not a file.",
					details: { path },
				}),
			)
		}

		throw error
	}
}

function parseJsonFile(content: string, path: string): Result<unknown> {
	try {
		return ok(JSON.parse(content) as unknown)
	} catch (error) {
		if (error instanceof SyntaxError) {
			return err(
				sandoError({
					code: "VALIDATION_FAILED",
					message: "Sandhost policy file contains invalid JSON.",
					details: { path, message: error.message },
				}),
			)
		}

		throw error
	}
}

async function resolveStartDirectory(startPath: string): Promise<Result<string>> {
	const stat = await statPath(startPath)

	if (stat === undefined) {
		return err(
			sandoError({
				code: "NOT_FOUND",
				message: "Start path does not exist.",
				details: { startPath },
			}),
		)
	}

	if (stat.isDirectory()) {
		return ok(startPath)
	}

	return ok(dirname(startPath))
}

async function findFallbackRoot(directory: string): Promise<ProjectRoot | undefined> {
	const marker = await findExistingMarker(directory, projectRootFallbackMarkers)

	if (marker === undefined) {
		return undefined
	}

	return { path: directory, marker }
}

async function findExistingMarker<Marker extends ProjectRootMarker>(
	directory: string,
	markers: readonly Marker[],
): Promise<Marker | undefined> {
	for (const marker of markers) {
		const stat = await statPath(join(directory, marker))

		if (stat !== undefined) {
			return marker
		}
	}

	return undefined
}

async function statPath(path: string) {
	try {
		return await lstat(path)
	} catch (error) {
		if (isNodeError(error) && error.code === "ENOENT") {
			return undefined
		}

		throw error
	}
}

function* ancestorDirectories(startDirectory: string): Generator<string> {
	let current = isAbsolute(startDirectory) ? startDirectory : resolve(startDirectory)
	const root = parsePath(current).root

	while (true) {
		yield current

		if (current === root) {
			return
		}

		current = dirname(current)
	}
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error
}
