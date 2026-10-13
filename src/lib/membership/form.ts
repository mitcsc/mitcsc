import { MembershipError } from "./errors";
import type { FormConfig, Question, QuestionType } from "./types";

const QUESTION_TYPES: QuestionType[] = ["short", "long", "dropdown", "multiple", "checkboxes"];

export function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

// Built-in questions keep their type and stay first; exec can only rename them.
export function cleanForm(form: FormConfig, current: FormConfig): FormConfig {
  const builtins = current.questions.filter((q) => q.builtin);
  const incoming = Array.isArray(form.questions) ? form.questions : [];
  const ids = new Set<string>();
  const questions: Question[] = builtins.map((b) => {
    ids.add(b.id);
    const edited = incoming.find((q) => q?.id === b.id);
    return { ...b, label: text(edited?.label, 120) || b.label };
  });
  for (const q of incoming) {
    if (!q || ids.has(q.id) || builtins.some((b) => b.builtin === q.builtin)) continue;
    const id = text(q.id, 40);
    const label = text(q.label, 200);
    if (!/^[\w-]{1,40}$/.test(id) || !QUESTION_TYPES.includes(q.type)) throw new MembershipError("One of the questions is not valid.");
    if (!label) throw new MembershipError("Every question needs a title.");
    const options = q.type === "short" || q.type === "long"
      ? undefined
      : [...new Set((q.options || []).map((o) => text(o, 100)).filter(Boolean))].slice(0, 50);
    if (options && !options.length) throw new MembershipError(`Add at least one option to “${label}”.`);
    ids.add(id);
    questions.push({ id, label, type: q.type, required: !!q.required, ...(options ? { options } : {}) });
  }
  if (questions.length > 30) throw new MembershipError("The form can have at most 30 questions.");
  let calendarUrl = text(form.calendarUrl, 500);
  if (calendarUrl && !/^[a-z]+:\/\//i.test(calendarUrl)) calendarUrl = `https://${calendarUrl}`;
  if (calendarUrl && !/^https:\/\/[^\s]+$/.test(calendarUrl)) throw new MembershipError("The calendar link must start with https://.");
  const instagram = text(form.instagram, 40).replace(/^@/, "");
  if (instagram && !/^[A-Za-z0-9._]{1,30}$/.test(instagram)) throw new MembershipError("Enter the Instagram username, like @mitcsc.");
  return {
    intro: text(form.intro, 500),
    benefits: (Array.isArray(form.benefits) ? form.benefits : []).map((b) => text(b, 60)).filter(Boolean).slice(0, 20),
    questions,
    calendarUrl,
    instagram,
  };
}
