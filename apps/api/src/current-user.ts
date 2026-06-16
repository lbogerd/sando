import { asId, isIdOfKind, type UserId } from "@sando/shared"

export type CurrentUser = {
	readonly userId: UserId
}

export type CurrentUserResolver = (
	request: Request,
) => CurrentUser | null | Promise<CurrentUser | null>

export type DevCurrentUserEnvironment = {
	readonly SANDO_DEV_AUTH_TOKEN?: string
	readonly SANDO_DEV_USER_ID?: string
}

export function currentUserResolverFromEnv(
	env: DevCurrentUserEnvironment = process.env,
): CurrentUserResolver {
	const token = env.SANDO_DEV_AUTH_TOKEN
	const userId = env.SANDO_DEV_USER_ID

	if (
		token === undefined ||
		token.trim().length === 0 ||
		userId === undefined ||
		!isIdOfKind("user", userId)
	) {
		return () => null
	}

	return createBearerTokenCurrentUserResolver({
		token,
		userId: asId("user", userId),
	})
}

export function createBearerTokenCurrentUserResolver(input: {
	readonly token: string
	readonly userId: UserId
}): CurrentUserResolver {
	const expectedHeader = `Bearer ${input.token}`

	return (request) =>
		request.headers.get("authorization") === expectedHeader ? { userId: input.userId } : null
}
