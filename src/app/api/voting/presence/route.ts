import { failure, json, pollSession } from '@/lib/voting/http';
import { redisVoters } from '@/lib/voting/redis-service';
import { readPresence } from '@/lib/voting/presence';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const { config, view } = await pollSession(request, true);
    const voters = await redisVoters(config, view);
    return json({presence:await readPresence(config,voters.map(v=>v.id))});
  } catch (error) { return failure(error); }
}
