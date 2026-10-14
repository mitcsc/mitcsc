// An error whose message is safe to show to the person who made the request.
export class MembershipError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export function publicMessage(error: unknown, fallback = "Something went wrong. Please try again.") {
  if (error instanceof MembershipError) return error.message;
  console.error(error);
  return fallback;
}
