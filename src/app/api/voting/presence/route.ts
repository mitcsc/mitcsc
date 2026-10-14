import { failure, json, session } from '@/lib/voting/http';
import { redisVoters } from '@/lib/voting/redis-service';
import { readPresence } from '@/lib/voting/presence';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const { config } = await session(true);
    const voters = await redisVoters(config);
    return json({presence:await readPresence(config,voters.map(v=>v.id))});
  } catch (error) { return failure(error); }
}
