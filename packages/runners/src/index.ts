import { lstat } from "node:fs/promises"
import { dirname, isAbsolute, join, parse, resolve } from "node:path"

import { err, ok, sandoError, type Result } from "@sando/shared"

export const packageName = "runners"

export const projectRootStrongMarkers = [
	".sandhost/policy.json",
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
	const root = parse(current).root

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
