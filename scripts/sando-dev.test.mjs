import { describe, expect, it } from "vitest"

import {
	apiEnv,
	databaseUrl,
	devDefaults,
	helpText,
	parseDevArgs,
	podmanPostgresRunArgs,
} from "./sando-dev.mjs"

describe("sando dev script", () => {
	it("parses default options", () => {
		expect(parseDevArgs([])).toEqual({
			ok: true,
			help: false,
			options: {
				apiHost: "127.0.0.1",
				apiPort: 3000,
				keepPodman: false,
				postgresContainerName: "sando-postgres",
				postgresDatabase: "sando",
				postgresImage: "docker.io/library/postgres:16-alpine",
				postgresPassword: "sando",
				postgresPort: 54329,
				postgresUser: "sando",
				postgresVolume: "sando-postgres-data",
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
		expect(databaseUrl(devDefaults)).toBe("postgresql://sando:sando@127.0.0.1:54329/sando")
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
			SANDO_DEV_AUTH_TOKEN: "sando-dev-token",
			SANDO_DEV_USER_ID: "user_dev",
			TMPDIR: "/tmp",
		})
	})

	it("builds the Podman Postgres run command", () => {
		expect(podmanPostgresRunArgs(devDefaults)).toEqual([
			"run",
			"--detach",
			"--replace",
			"--name",
			"sando-postgres",
			"--publish",
			"54329:5432",
			"--env",
			"POSTGRES_DB=sando",
			"--env",
			"POSTGRES_PASSWORD=sando",
			"--env",
			"POSTGRES_USER=sando",
			"--volume",
			"sando-postgres-data:/var/lib/postgresql/data",
			"docker.io/library/postgres:16-alpine",
		])
	})

	it("prints root pnpm dev usage", () => {
		expect(helpText()).toContain("pnpm dev")
		expect(helpText()).toContain("Authorization: Bearer sando-dev-token")
		expect(helpText()).toContain("--skip-podman")
	})
})
