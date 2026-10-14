const PREFIX = "csc:membership:v1";

export const keys = {
  currentYear: `${PREFIX}:current-year`,
  years: `${PREFIX}:years`,
  year: (year: string) => `${PREFIX}:year:${year}`,
  member: (year: string, kerb: string) => `${PREFIX}:member:${year}:${kerb}`,
  members: (year: string) => `${PREFIX}:members:${year}`,
  // Everyone who paid in any year. They get the returning price.
  paidEver: `${PREFIX}:paid-ever`,
  venmoMessage: (messageId: string) => `${PREFIX}:venmo-message:${messageId}`,
  venmoCheck: (year: string) => `${PREFIX}:venmo-check:${year}`,
  events: (year: string) => `${PREFIX}:events:${year}`,
  event: (id: string) => `${PREFIX}:event:${id}`,
  attendance: (id: string) => `${PREFIX}:attendance:${id}`,
  google: `${PREFIX}:google`,
  execAccess: `${PREFIX}:exec-access`,
  sync: (target: string) => `${PREFIX}:sync:${target}`,
  rateLimit: (scope: string, id: string) => `${PREFIX}:limit:${scope}:${id}`,
};
