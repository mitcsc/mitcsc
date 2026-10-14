export type QuestionType = "short" | "long" | "dropdown" | "multiple" | "checkboxes";
export type BuiltinQuestion = "kerb" | "name" | "classYear" | "dorm";

export interface Question {
  id: string;
  label: string;
  type: QuestionType;
  required: boolean;
  options?: string[];
  // Built-in questions are always asked and feed fixed member fields.
  builtin?: BuiltinQuestion;
}

export interface FormConfig {
  // The heading on /join. Empty or missing (years made before it was editable) shows DEFAULT_FORM_TITLE.
  title?: string;
  intro: string;
  benefits: string[];
  questions: Question[];
  calendarUrl: string;
  instagram: string;
}

export interface YearConfig {
  year: string; // "2026-2027"
  signupsOpen: boolean;
  closesOn: string | null; // "2026-11-30", signups close at the end of this day in Boston
  walletExpiresOn: string; // "2027-06-01"
  prices: { new: number; returning: number };
  venmo: string; // handle without "@"
  zelle: string;
  cashAllowed: boolean;
  form: FormConfig;
  folderId: string | null; // holds the membership sheet, inside the club's "MIT CSC" folder
  sheetId: string | null;
  sheetName: string;
  createdAt: number;
}

export type PaymentMethod = "venmo" | "zelle" | "cash";

export interface Member {
  year: string;
  kerb: string;
  name: string;
  classYear: string;
  dorm: string;
  answers: Record<string, string | string[]>;
  type: "new" | "returning";
  price: number;
  method: PaymentMethod;
  status: "unpaid" | "paid";
  // The member pressed "I've paid" or "I'll pay at an event".
  reportedAt: number | null;
  paidAt: number | null;
  paidVia: PaymentMethod | null;
  // "Venmo check" or the email of the exec who confirmed it.
  confirmedBy: string | null;
  venmoMessageId: string | null;
  // googleUrl is missing on cards made before the Apple and Google buttons existed.
  wallet: { serial: string; shareUrl: string; googleUrl?: string } | null;
  createdAt: number;
}

export interface EventInfo {
  id: string;
  year: string;
  name: string;
  date: string; // "2026-10-13"
  sheetId: string | null;
  sheetTab: string;
  createdBy: string;
  createdAt: number;
}

export interface Attendance {
  kerb: string;
  name: string;
  classYear: string;
  paid: boolean;
  at: number;
  by: string;
}
