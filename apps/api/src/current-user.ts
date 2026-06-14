import type { UserId } from "@sando/shared"

export type CurrentUser = {
	readonly userId: UserId
}

export type CurrentUserResolver = (
	request: Request,
) => CurrentUser | null | Promise<CurrentUser | null>
