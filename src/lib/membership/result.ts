import { publicMessage } from "./errors";

// What every server action returns, so the page can show the message without a crash screen.
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export async function attempt<T>(work: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    return { ok: false, error: publicMessage(error) };
  }
}
