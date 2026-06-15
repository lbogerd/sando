import { defineConfig } from "vitest/config"

export default defineConfig({
	test: {
		include: [
			"apps/**/*.{test,spec}.ts?(x)",
			"packages/**/*.{test,spec}.ts?(x)",
			"scripts/**/*.{test,spec}.mjs",
		],
		passWithNoTests: true,
	},
})
