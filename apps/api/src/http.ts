import { sandoError, type SandoError } from "@sando/shared"

export type JsonBodyResult =
	| { readonly ok: true; readonly value: unknown }
	| { readonly ok: false; readonly error: SandoError }

export async function readJsonBody(request: Request): Promise<JsonBodyResult> {
	try {
		return {
			ok: true,
			value: await request.json(),
		}
	} catch {
		return {
			ok: false,
			error: sandoError({
				code: "VALIDATION_FAILED",
				message: "Expected a JSON request body.",
			}),
		}
	}
}

export function unauthorizedError(): SandoError {
	return sandoError({
		code: "UNAUTHORIZED",
		message: "Authentication required.",
	})
}
