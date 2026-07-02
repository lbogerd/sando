import { Hono } from "hono"

import { sandoError } from "@sando/shared"

import { readJsonBody } from "./http.js"

export const hostedLoginTtlSeconds = 10 * 60

export type HostedLoginRecord =
	| {
			readonly id: string
			readonly status: "pending"
			readonly createdAt: string
			readonly expiresAt: string
	  }
	| {
			readonly id: string
			readonly status: "completed"
			readonly createdAt: string
			readonly expiresAt: string
			readonly completedAt: string
			readonly token: string
			readonly userId: string
	  }
	| {
			readonly id: string
			readonly status: "expired"
			readonly createdAt: string
			readonly expiresAt: string
	  }

export type StartHostedLoginCommand = {
	readonly now: Date
}

export type CompleteHostedLoginCommand = {
	readonly loginId: string
	readonly now: Date
	readonly token: string
	readonly userId: string
}

export type GetHostedLoginCommand = {
	readonly loginId: string
	readonly now: Date
}

export type HostedLoginRepository = {
	readonly startLogin: (
		input: StartHostedLoginCommand,
	) => HostedLoginRecord | Promise<HostedLoginRecord>
	readonly completeLogin: (
		input: CompleteHostedLoginCommand,
	) => HostedLoginRecord | null | Promise<HostedLoginRecord | null>
	readonly getLogin: (
		input: GetHostedLoginCommand,
	) => HostedLoginRecord | null | Promise<HostedLoginRecord | null>
}

export type MemoryHostedLoginRepositoryOptions = {
	readonly generateId?: () => string
}

export type HostedLoginRoutesOptions = {
	readonly auth?: {
		readonly signInEmail?: unknown
		readonly signUpEmail?: unknown
	}
	readonly loginRepository: HostedLoginRepository
	readonly now: () => Date
}

type EmailPasswordAuthInput = {
	readonly body: Record<string, unknown>
	readonly headers?: Headers
	readonly returnHeaders?: boolean
	readonly returnStatus?: boolean
}

type EmailPasswordAuthMethod = (input: EmailPasswordAuthInput) => Promise<unknown>

type EmailLoginMode = "sign-in" | "sign-up"

export function createMemoryHostedLoginRepository(
	options: MemoryHostedLoginRepositoryOptions = {},
): HostedLoginRepository {
	const generateId = options.generateId ?? (() => crypto.randomUUID())
	const byId = new Map<string, HostedLoginRecord>()

	return {
		startLogin(input) {
			const login: HostedLoginRecord = {
				id: `login_${generateId()}`,
				status: "pending",
				createdAt: input.now.toISOString(),
				expiresAt: expiresAt(input.now, hostedLoginTtlSeconds),
			}

			byId.set(login.id, login)

			return login
		},

		completeLogin(input) {
			const current = getLoginById(byId, input)

			if (current === null || current.status !== "pending") {
				return current
			}

			const completed: HostedLoginRecord = {
				...current,
				status: "completed",
				completedAt: input.now.toISOString(),
				token: input.token,
				userId: input.userId,
			}

			byId.set(completed.id, completed)

			return completed
		},

		getLogin(input) {
			return getLoginById(byId, input)
		},
	}
}

export function createHostedLoginRoutes(options: HostedLoginRoutesOptions): Hono {
	const routes = new Hono()

	routes.post("/login/start", async (context) => {
		const body = await optionalJsonBody(context.req.raw)

		if (!body.ok) {
			return context.json({ error: body.error }, 400)
		}

		const login = await options.loginRepository.startLogin({
			now: options.now(),
		})
		const url = new URL(context.req.url)
		const loginUrl = `${url.origin}/v1/login/${encodeURIComponent(login.id)}`

		return context.json(
			{
				login,
				loginUrl,
				pollUrl: `${loginUrl}/token`,
			},
			201,
		)
	})

	routes.get("/login/:loginId", async (context) => {
		const login = await options.loginRepository.getLogin({
			loginId: context.req.param("loginId"),
			now: options.now(),
		})

		if (login === null) {
			return context.html(loginMessagePage("Login request not found."), 404)
		}

		if (login.status === "completed") {
			return context.html(loginMessagePage("Login complete. You can return to Codex."))
		}

		if (login.status === "expired") {
			return context.html(loginMessagePage("Login request expired."), 410)
		}

		return context.html(loginPage(login))
	})

	routes.post("/login/:loginId/complete", async (context) => {
		const login = await options.loginRepository.getLogin({
			loginId: context.req.param("loginId"),
			now: options.now(),
		})

		if (login === null) {
			return context.html(loginMessagePage("Login request not found."), 404)
		}

		if (login.status === "completed") {
			return context.html(loginMessagePage("Login complete. You can return to Codex."))
		}

		if (login.status === "expired") {
			return context.html(loginMessagePage("Login request expired."), 410)
		}

		const form = await readLoginForm(context.req.raw)

		if (!form.ok) {
			return context.html(loginPage(login, form.error.message), 400)
		}

		const authenticated = await authenticateEmailPassword({
			auth: options.auth,
			form: form.value,
			headers: context.req.raw.headers,
		})

		if (!authenticated.ok) {
			return context.html(loginPage(login, authenticated.error.message), 401)
		}

		const completed = await options.loginRepository.completeLogin({
			loginId: login.id,
			now: options.now(),
			token: authenticated.value.token,
			userId: authenticated.value.userId,
		})

		if (completed === null || completed.status !== "completed") {
			return context.html(loginMessagePage("Login request could not be completed."), 409)
		}

		return context.html(loginMessagePage("Login complete. You can return to Codex."))
	})

	routes.get("/login/:loginId/token", async (context) => {
		const login = await options.loginRepository.getLogin({
			loginId: context.req.param("loginId"),
			now: options.now(),
		})

		if (login === null) {
			return context.json(
				{
					error: sandoError({
						code: "NOT_FOUND",
						message: "Login request not found.",
					}),
				},
				404,
			)
		}

		if (login.status === "pending") {
			return context.json(
				{
					status: "pending",
					expiresAt: login.expiresAt,
				},
				202,
			)
		}

		if (login.status === "expired") {
			return context.json(
				{
					error: sandoError({
						code: "UNAUTHORIZED",
						message: "Login request expired.",
					}),
				},
				410,
			)
		}

		return context.json({
			status: "completed",
			token: login.token,
			user: {
				id: login.userId,
			},
		})
	})

	return routes
}

function getLoginById(
	logins: Map<string, HostedLoginRecord>,
	input: GetHostedLoginCommand,
): HostedLoginRecord | null {
	const login = logins.get(input.loginId)

	if (login === undefined) {
		return null
	}

	if (login.status !== "expired" && new Date(login.expiresAt).getTime() <= input.now.getTime()) {
		const expired: HostedLoginRecord = {
			id: login.id,
			createdAt: login.createdAt,
			expiresAt: login.expiresAt,
			status: "expired",
		}

		logins.set(expired.id, expired)

		return expired
	}

	return login
}

async function optionalJsonBody(request: Request) {
	if ((request.headers.get("content-type") ?? "").includes("application/json")) {
		return readJsonBody(request)
	}

	return { ok: true as const, value: {} }
}

async function readLoginForm(request: Request): Promise<
	| {
			readonly ok: true
			readonly value: {
				readonly email: string
				readonly mode: EmailLoginMode
				readonly name: string
				readonly password: string
			}
	  }
	| {
			readonly ok: false
			readonly error: { readonly message: string }
	  }
> {
	const form = await request.formData()
	const mode = formValue(form, "mode")
	const email = formValue(form, "email")
	const name = formValue(form, "name") || "Sando user"
	const password = formValue(form, "password")

	if (mode !== "sign-in" && mode !== "sign-up") {
		return { ok: false, error: { message: "Choose sign in or sign up." } }
	}

	if (email.length === 0 || password.length === 0) {
		return { ok: false, error: { message: "Email and password are required." } }
	}

	return {
		ok: true,
		value: {
			email,
			mode,
			name,
			password,
		},
	}
}

async function authenticateEmailPassword(input: {
	readonly auth: HostedLoginRoutesOptions["auth"]
	readonly form: {
		readonly email: string
		readonly mode: EmailLoginMode
		readonly name: string
		readonly password: string
	}
	readonly headers: Headers
}): Promise<
	| {
			readonly ok: true
			readonly value: {
				readonly token: string
				readonly userId: string
			}
	  }
	| {
			readonly ok: false
			readonly error: { readonly message: string }
	  }
> {
	const method = input.form.mode === "sign-up" ? input.auth?.signUpEmail : input.auth?.signInEmail

	if (typeof method !== "function") {
		return { ok: false, error: { message: "Hosted login is not configured." } }
	}

	try {
		const result = await (method as EmailPasswordAuthMethod)({
			body:
				input.form.mode === "sign-up"
					? {
							name: input.form.name,
							email: input.form.email,
							password: input.form.password,
							rememberMe: true,
						}
					: {
							email: input.form.email,
							password: input.form.password,
							rememberMe: true,
						},
			headers: input.headers,
			returnHeaders: true,
			returnStatus: true,
		})
		const response = authResponseBody(result)
		const status = authResponseStatus(result)

		if (status !== undefined && status >= 400) {
			return { ok: false, error: { message: authErrorMessage(response) } }
		}

		const token = objectStringField(response, "token")
		const user = objectField(response, "user")
		const userId = user === undefined ? undefined : objectStringField(user, "id")

		if (token === undefined || userId === undefined) {
			return { ok: false, error: { message: "Hosted login did not return a session." } }
		}

		return {
			ok: true,
			value: {
				token,
				userId,
			},
		}
	} catch (error) {
		return {
			ok: false,
			error: {
				message: error instanceof Error ? error.message : String(error),
			},
		}
	}
}

function authResponseBody(value: unknown): unknown {
	if (typeof value === "object" && value !== null && "response" in value) {
		return (value as { readonly response?: unknown }).response
	}

	return value
}

function authResponseStatus(value: unknown): number | undefined {
	if (typeof value !== "object" || value === null || !("status" in value)) {
		return undefined
	}

	const status = (value as { readonly status?: unknown }).status

	return typeof status === "number" ? status : undefined
}

function authErrorMessage(value: unknown): string {
	const message = objectStringField(value, "message")

	if (message !== undefined) {
		return message
	}

	const error = objectField(value, "error")
	const nestedMessage = error === undefined ? undefined : objectStringField(error, "message")

	return nestedMessage ?? "Hosted login failed."
}

function objectField(value: unknown, key: string): Record<string, unknown> | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return undefined
	}

	const field = (value as Record<string, unknown>)[key]

	return typeof field === "object" && field !== null && !Array.isArray(field)
		? (field as Record<string, unknown>)
		: undefined
}

function objectStringField(value: unknown, key: string): string | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return undefined
	}

	const field = (value as Record<string, unknown>)[key]

	return typeof field === "string" && field.length > 0 ? field : undefined
}

function formValue(form: FormData, key: string): string {
	const value = form.get(key)

	return typeof value === "string" ? value.trim() : ""
}

function expiresAt(now: Date, ttlSeconds: number): string {
	return new Date(now.getTime() + ttlSeconds * 1000).toISOString()
}

function loginPage(login: HostedLoginRecord, error?: string): string {
	return htmlDocument(
		"Sign in to sando",
		`
			<main>
				<h1>Sign in to sando.</h1>
				<p>This authorizes Codex on this machine to register the project with your hosted sando session.</p>
				${error === undefined ? "" : `<p role="alert">${escapeHtml(error)}</p>`}
				<form method="post" action="/v1/login/${escapeHtml(login.id)}/complete">
					<label>Email <input required type="email" name="email" autocomplete="email"></label>
					<label>Password <input required type="password" name="password" autocomplete="current-password"></label>
					<label>Name <input type="text" name="name" autocomplete="name"></label>
					<button type="submit" name="mode" value="sign-in">Sign in</button>
					<button type="submit" name="mode" value="sign-up">Create account</button>
				</form>
			</main>
		`,
	)
}

function loginMessagePage(message: string): string {
	return htmlDocument(
		"sando login",
		`
			<main>
				<h1>${escapeHtml(message)}</h1>
			</main>
		`,
	)
}

function htmlDocument(title: string, body: string): string {
	return `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>${escapeHtml(title)}</title>
	<style>
		body { font-family: system-ui, sans-serif; margin: 2rem; line-height: 1.45; color: #17202a; }
		main { max-width: 46rem; }
		form { display: grid; gap: .8rem; max-width: 26rem; }
		label { display: grid; gap: .25rem; font-weight: 700; }
		input { font: inherit; padding: .55rem; border: 1px solid #9aa6b2; border-radius: .35rem; }
		button { font: inherit; padding: .65rem .9rem; border: 1px solid #9aa6b2; border-radius: .35rem; background: #fff; cursor: pointer; }
		button:hover { background: #f4f6f8; }
		[role="alert"] { color: #8a1c1c; font-weight: 700; }
	</style>
</head>
<body>
${body}
</body>
</html>
`
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;")
}
