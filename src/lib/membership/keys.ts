const PREFIX = "csc:membership:v1";

export const keys = {
  currentYear: `${PREFIX}:current-year`,
  years: `${PREFIX}:years`,
  year: (year: string) => `${PREFIX}:year:${year}`,
  member: (year: string, kerb: string) => `${PREFIX}:member:${year}:${kerb}`,
  members: (year: string) => `${PREFIX}:members:${year}`,
  // The signed Apple Wallet file for a member's card, kept apart so member reads stay small.
  walletPass: (year: string, kerb: string) => `${PREFIX}:wallet-pass:${year}:${kerb}`,
  // An unused card link from an email. Deleted when the link is used.
  cardLink: (id: string) => `${PREFIX}:card-link:${id}`,
  // Everyone who paid on this site in any year. They get the returning price.
  paidEver: `${PREFIX}:paid-ever`,
  // Kerbs imported once from the old Google Form sheets. They also get the returning price.
  pastImported: `${PREFIX}:past-imported`,
  venmoMessage: (messageId: string) => `${PREFIX}:venmo-message:${messageId}`,
  venmoCheck: (year: string) => `${PREFIX}:venmo-check:${year}`,
  events: (year: string) => `${PREFIX}:events:${year}`,
  event: (id: string) => `${PREFIX}:event:${id}`,
  attendance: (id: string) => `${PREFIX}:attendance:${id}`,
  google: `${PREFIX}:google`,
  // The image files in Drive's "Front Page Photos" folder, as last listed.
  homePhotos: `${PREFIX}:home-photos`,
  // Drive file ids of the photos turned on for the home page.
  homePhotosShown: `${PREFIX}:home-photos:shown`,
  // Why a photo last failed to load from Drive, by file id. Cleared when it loads again.
  homePhotoFailures: `${PREFIX}:home-photos:failures`,
  execAccess: `${PREFIX}:exec-access`,
  sync: (target: string) => `${PREFIX}:sync:${target}`,
  rateLimit: (scope: string, id: string) => `${PREFIX}:limit:${scope}:${id}`,
};
