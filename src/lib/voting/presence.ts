import { redisCommand, redisKey } from './redis';
import type { Settings } from './service';
export type Presence = 'online' | 'away' | 'offline' | 'unknown';
export function presenceStatus(lastSeen: number, hidden: boolean, now = Date.now()): Presence {
  if (!lastSeen) return 'offline';
  const age = now - lastSeen;
  if (age > 30_000) return 'offline';
  return hidden || age > 25_000 ? 'away' : 'online';
}
const key = (config: Settings, id: string) => redisKey('presence',config.sessionId,config.sheetId,id);
export async function recordPresence(config: Settings, id: string, hidden: boolean) {
  await redisCommand('SET',key(config,id),JSON.stringify({at:Date.now(),hidden}),'EX',120);
}
export async function readPresence(config: Settings, ids: string[]): Promise<Record<string,Presence>> {
  if (!ids.length) return {};
  const values = await redisCommand<(string|null)[]>('MGET',...ids.map(id=>key(config,id)));
  return Object.fromEntries(ids.map((id,i)=>{
    try { const value = values[i] ? JSON.parse(values[i]!) : null; return [id,presenceStatus(value?.at || 0,!!value?.hidden)]; }
    catch { return [id,'unknown']; }
  }));
}
