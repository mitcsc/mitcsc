"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { saveForm } from "@/app/dashboard/actions";
import { Icon } from "@/components/membership/icons";
import { questionOptions } from "@/lib/membership/config";
import type { FormConfig, Question, QuestionType } from "@/lib/membership/types";
import { Setting } from "./YearSettings";
import { useSave } from "./Shell";

const TYPE_NAMES: Record<QuestionType, string> = {
  checkboxes: "Checkboxes", short: "Short answer", long: "Long answer", multiple: "Multiple choice", dropdown: "Dropdown",
};
const SAVE_DELAY_MS = 800;

function hasOptions(type: QuestionType) {
  return type === "checkboxes" || type === "multiple" || type === "dropdown";
}

function Grip() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" />
    </svg>
  );
}

function Lock() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

// Text fields save shortly after typing stops; question changes save when you press Done.
export default function FormEditor({ year, form: initial }: { year: string; form: FormConfig }) {
  const save = useSave();
  const [form, setForm] = useState(initial);
  const [benefits, setBenefits] = useState(initial.benefits.join("\n"));
  const [instagram, setInstagram] = useState(initial.instagram ? `@${initial.instagram}` : "");
  const [editing, setEditing] = useState<{ index: number | null; draft: Question } | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => save(() => saveForm(form)), SAVE_DELAY_MS);
    return () => window.clearTimeout(timer.current);
  }, [form, save]);

  const update = (patch: Partial<FormConfig>) => setForm((f) => ({ ...f, ...patch }));
  const builtins = form.questions.filter((q) => q.builtin);
  const custom = form.questions.filter((q) => !q.builtin);
  const setCustom = (list: Question[]) => update({ questions: [...builtins, ...list] });

  function move(from: number, to: number) {
    if (to < 0 || to >= custom.length || from === to) return;
    const list = [...custom];
    const [item] = list.splice(from, 1);
    list.splice(to, 0, item);
    setCustom(list);
  }

  function finishEdit() {
    if (!editing) return;
    const draft = { ...editing.draft, label: editing.draft.label.trim() };
    if (!draft.label) return;
    if (hasOptions(draft.type)) draft.options = (draft.options || []).map((o) => o.trim()).filter(Boolean);
    else delete draft.options;
    if (hasOptions(draft.type) && !draft.options?.length) return;
    const list = [...custom];
    if (editing.index === null) list.push(draft);
    else list[editing.index] = draft;
    setCustom(list);
    setEditing(null);
  }

  return (
    <div className="d-editor">
      <main className="d-editor-main">
        <Setting title="Top of the page" note="The first thing people see.">
          <label className="d-field">
            <span className="m-label">Intro</span>
            <textarea className="m-textarea is-compact" rows={2} value={form.intro} maxLength={500} onChange={(e) => update({ intro: e.target.value })} />
          </label>
          <label className="d-field">
            <span className="m-label">Benefits <span className="m-label-note">One per line</span></span>
            <textarea
              className="m-textarea is-compact" rows={7} value={benefits}
              onChange={(e) => { setBenefits(e.target.value); update({ benefits: e.target.value.split("\n").map((b) => b.trim()).filter(Boolean) }); }}
            />
          </label>
        </Setting>

        <Setting title="Questions" note="Drag to reorder. Answers show up as columns in the Google Sheet.">
          <div className="d-questions">
            {builtins.map((q) => (
              <div className="d-question is-locked" key={q.id}>
                <span className="d-grip"><Grip /></span>
                <span className="d-question-label">{q.label}</span>
                <span className="d-question-type">{TYPE_NAMES[q.type]}</span>
                <span className="d-question-end"><Lock />Always asked</span>
              </div>
            ))}
            {custom.map((q, i) => (editing?.index === i ? (
              <QuestionEditor key={q.id} draft={editing.draft} onChange={(draft) => setEditing({ index: i, draft })} onCancel={() => setEditing(null)} onDone={finishEdit} />
            ) : (
              <div
                className={`d-question${dragging === i ? " is-dragging" : ""}`} key={q.id} draggable
                onDragStart={(e) => { setDragging(i); e.dataTransfer.effectAllowed = "move"; }}
                onDragOver={(e) => { e.preventDefault(); if (dragging !== null && dragging !== i) { move(dragging, i); setDragging(i); } }}
                onDragEnd={() => setDragging(null)}
              >
                <button
                  type="button" className="d-grip is-movable" aria-label={`Move “${q.label}”. Use the arrow keys.`}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                      e.preventDefault();
                      move(i, i + (e.key === "ArrowUp" ? -1 : 1));
                    }
                  }}
                >
                  <Grip />
                </button>
                <span className="d-question-label">{q.label}</span>
                <span className="d-question-type">{TYPE_NAMES[q.type]}{q.required ? "" : ", optional"}</span>
                <span className="d-question-end">
                  <button type="button" onClick={() => setEditing({ index: i, draft: { ...q, options: q.options ? [...q.options] : undefined } })} disabled={!!editing}>Edit</button>
                  <button type="button" onClick={() => setCustom(custom.filter((_, j) => j !== i))} disabled={!!editing}>Remove</button>
                </span>
              </div>
            )))}
            {editing?.index === null && (
              <QuestionEditor draft={editing.draft} onChange={(draft) => setEditing({ index: null, draft })} onCancel={() => setEditing(null)} onDone={finishEdit} />
            )}
          </div>
          {!editing && (
            <button
              type="button" className="d-chip-btn is-start"
              onClick={() => setEditing({ index: null, draft: { id: `q${Date.now().toString(36)}`, label: "", type: "short", required: false } })}
            >
              Add question
            </button>
          )}
        </Setting>

        <Setting title="After signup" note="Shown on the confirmation screen.">
          <label className="d-field">
            <span className="m-label">Calendar link <span className="m-label-note">Optional</span></span>
            <input className="m-input is-compact" type="url" placeholder="https://calendar.google.com/…" value={form.calendarUrl} onChange={(e) => update({ calendarUrl: e.target.value.trim() })} />
          </label>
          <label className="d-field">
            <span className="m-label">Instagram <span className="m-label-note">Optional</span></span>
            <input className="m-input is-compact" placeholder="@mitcsc" value={instagram} onChange={(e) => { setInstagram(e.target.value); update({ instagram: e.target.value.trim().replace(/^@/, "") }); }} />
          </label>
        </Setting>
      </main>

      <aside className="d-preview-pane">
        <div className="d-preview-head">
          <span>Preview</span>
          <a href="/membership" target="_blank" rel="noreferrer">Open page</a>
        </div>
        <Preview year={year} form={form} />
      </aside>
    </div>
  );
}

function QuestionEditor({ draft, onChange, onCancel, onDone }: { draft: Question; onChange: (q: Question) => void; onCancel: () => void; onDone: () => void }) {
  const options = draft.options?.length ? draft.options : [""];
  const setOption = (i: number, value: string) => onChange({ ...draft, options: options.map((o, j) => (j === i ? value : o)) });
  const ready = draft.label.trim() && (!hasOptions(draft.type) || options.some((o) => o.trim()));
  return (
    <div className="d-question-editor">
      <div className="d-field-row is-tight">
        <label className="d-field is-wide">
          <span className="m-label">Question</span>
          <input className="m-input is-small" value={draft.label} autoFocus maxLength={200} onChange={(e) => onChange({ ...draft, label: e.target.value })} />
        </label>
        <label className="d-field">
          <span className="m-label">Answer type</span>
          <span className="m-select-wrap">
            <select className="m-select is-small" value={draft.type} onChange={(e) => onChange({ ...draft, type: e.target.value as QuestionType })}>
              {(Object.keys(TYPE_NAMES) as QuestionType[]).map((t) => <option key={t} value={t}>{TYPE_NAMES[t]}</option>)}
            </select>
            <Icon name="chevron" />
          </span>
        </label>
      </div>
      {hasOptions(draft.type) && (
        <div className="d-field">
          <span className="m-label">Options</span>
          {options.map((option, i) => (
            <div className="d-option" key={i}>
              <span className={`d-option-mark is-${draft.type}`} aria-hidden="true" />
              <input className="m-input is-small" aria-label={`Option ${i + 1}`} value={option} maxLength={100} onChange={(e) => setOption(i, e.target.value)} />
              <button type="button" className="m-copy" aria-label="Remove option" onClick={() => onChange({ ...draft, options: options.filter((_, j) => j !== i) })}><Icon name="close" size={14} /></button>
            </div>
          ))}
          <button type="button" className="d-text-btn" onClick={() => onChange({ ...draft, options: [...options, ""] })}>+ Add option</button>
        </div>
      )}
      <div className="d-question-editor-foot">
        <label className="d-check is-grow">
          <input type="checkbox" checked={draft.required} onChange={(e) => onChange({ ...draft, required: e.target.checked })} />
          Required
        </label>
        <button type="button" className="d-chip-btn" onClick={onCancel}>Cancel</button>
        <button type="button" className="m-btn is-light is-small" onClick={onDone} disabled={!ready}>Done</button>
      </div>
    </div>
  );
}

// A small, non-interactive copy of /membership.
function Preview({ year, form }: { year: string; form: FormConfig }) {
  return (
    <div className="d-preview" aria-hidden="true">
      <div className="d-preview-hero">
        <Image src="/img/logo/logo-with-panda.png" alt="" width={48} height={48} />
        <span className="d-preview-title">Join CSC</span>
        {form.intro && <span className="d-preview-intro">{form.intro}</span>}
        {form.benefits.length > 0 && (
          <div className="d-preview-benefits">{form.benefits.map((b, i) => <span key={i}>{b}</span>)}</div>
        )}
      </div>
      {form.questions.map((q) => {
        const optional = !q.required && !q.builtin;
        const options = hasOptions(q.type) ? questionOptions(q, year) : [];
        return (
          <div className="d-preview-field" key={q.id}>
            <span className="d-preview-label">{q.label}{optional && <span>Optional</span>}</span>
            {q.type === "checkboxes" || q.type === "multiple" ? (
              options.slice(0, 5).map((o) => <div className="d-preview-choice" key={o}><span className={q.type === "multiple" ? "is-round" : ""} />{o}</div>)
            ) : (
              <div className={`d-preview-box${q.type === "long" ? " is-long" : ""}`}>
                {q.builtin === "kerb" && <span className="d-preview-suffix">@mit.edu</span>}
                {q.type === "dropdown" && <Icon name="chevron" size={12} />}
              </div>
            )}
          </div>
        );
      })}
      <div className="d-preview-button">Continue</div>
    </div>
  );
}
