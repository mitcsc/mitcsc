import { cookies } from 'next/headers';
import { PRESIDENT_COOKIE, requirePresident } from '@/lib/voting/president';
import { currentElection, redisVoters } from '@/lib/voting/redis-service';
import { readPresence } from '@/lib/voting/presence';
import { failure, json } from '@/lib/voting/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    requirePresident((await cookies()).get(PRESIDENT_COOKIE)?.value);
    const config = await currentElection();
    if (!config?.password) return json({presence:{}});
    const voters = await redisVoters(config);
    return json({presence:await readPresence(config,voters.map(v=>v.id))});
  } catch (error) { return failure(error); }
}
