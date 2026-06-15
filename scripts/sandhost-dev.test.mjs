import { describe, expect, it } from "vitest"

import {
	apiEnv,
	databaseUrl,
	devDefaults,
	helpText,
	parseDevArgs,
	podmanPostgresRunArgs,
} from "./sandhost-dev.mjs"

describe("sandhost dev script", () => {
	it("parses default options", () => {
		expect(parseDevArgs([])).toEqual({
			ok: true,
			help: false,
			options: {
				apiHost: "127.0.0.1",
				apiPort: 3000,
				keepPodman: false,
				postgresContainerName: "sandhost-postgres",
				postgresDatabase: "sandhost",
				postgresImage: "docker.io/library/postgres:16-alpine",
				postgresPassword: "sandhost",
				postgresPort: 54329,
				postgresUser: "sandhost",
				postgresVolume: "sandhost-postgres-data",
				skipApi: false,
				skipPodman: false,
			},
		})
	})

	it("parses overridden ports and skip flags", () => {
		expect(
			parseDevArgs([
				"--",
				"--api-only",
				"--api-port=3001",
				"--api-host",
				"0.0.0.0",
				"--postgres-port",
				"54330",
				"--keep-podman",
			]),
		).toMatchObject({
			ok: true,
			options: {
				apiHost: "0.0.0.0",
				apiPort: 3001,
				keepPodman: true,
				postgresPort: 54330,
				skipPodman: true,
			},
		})
	})

	it("parses help after the pnpm argument separator", () => {
		expect(parseDevArgs(["--", "--help"])).toMatchObject({
			ok: true,
			help: true,
		})
	})

	it("builds a local database URL", () => {
		expect(databaseUrl(devDefaults)).toBe("postgresql://sandhost:sandhost@127.0.0.1:54329/sandhost")
	})

	it("does not overwrite explicit process env values", () => {
		expect(
			apiEnv(
				{
					DATABASE_URL: "postgresql://custom",
					HOST: "0.0.0.0",
					PORT: "4000",
				},
				devDefaults,
			),
		).toMatchObject({
			DATABASE_URL: "postgresql://custom",
			HOST: "0.0.0.0",
			PORT: "4000",
			TMPDIR: "/tmp",
		})
	})

	it("builds the Podman Postgres run command", () => {
		expect(podmanPostgresRunArgs(devDefaults)).toEqual([
			"run",
			"--detach",
			"--replace",
			"--name",
			"sandhost-postgres",
			"--publish",
			"54329:5432",
			"--env",
			"POSTGRES_DB=sandhost",
			"--env",
			"POSTGRES_PASSWORD=sandhost",
			"--env",
			"POSTGRES_USER=sandhost",
			"--volume",
			"sandhost-postgres-data:/var/lib/postgresql/data",
			"docker.io/library/postgres:16-alpine",
		])
	})

	it("prints root pnpm dev usage", () => {
		expect(helpText()).toContain("pnpm dev")
		expect(helpText()).toContain("--skip-podman")
	})
})
