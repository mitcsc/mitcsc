"use client";
import { useRef, useState } from "react";
import { useScrollEdges } from "./useScrollEdges";
import { Icon } from "@/components/membership/icons";
import { DragHandle, useReorder } from "@/components/dashboard/useReorder";
import { isNotes, type Candidate, type Criterion } from "@/lib/voting/types";

interface Props {
  candidates: Candidate[];
  criteria: Criterion[];
  busy: boolean;
  onBack: () => void;
  setupStep: "candidates" | "criteria";
  actionLabel: string;
  onDraftChange?: (candidates: Candidate[], criteria: Criterion[]) => void;
  onContinue: () => void;
  onSave: (candidates: Candidate[], criteria: Criterion[]) => Promise<boolean>;
}

// One step of the new delib form: the criteria, or the candidates.
export default function AdminSetup({ candidates: initialCandidates, criteria: initialCriteria, busy, onBack, setupStep, actionLabel, onDraftChange, onSave, onContinue }: Props) {
  const candidateScroll = useScrollEdges<HTMLFieldSetElement>();
  const criteriaScroll = useScrollEdges<HTMLFieldSetElement>();
  const [candidates, setCandidates] = useState(initialCandidates);
  const [criteria, setCriteria] = useState(initialCriteria);
  const [scaleDrafts, setScaleDrafts] = useState<Record<string, string>>({});
  const [paste, setPaste] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const pasteTrigger = useRef<HTMLButtonElement>(null);
  const pastedNames = paste.split(/\r?\n/).map(name => name.trim()).filter(Boolean);
  const [message, setMessage] = useState("");
  const updateCandidates = (next: Candidate[]) => { const ordered = next.map((c, order) => ({ ...c, order })); setCandidates(ordered); onDraftChange?.(ordered, criteria); setMessage(""); };
  const updateCriteria = (next: Criterion[]) => { setCriteria(next); onDraftChange?.(candidates, next); setMessage(""); };
  const addNames = (names: string[]) => updateCandidates([...candidates, ...names.map(name => ({ id: crypto.randomUUID(), name, context: "", order: 0, completed: false }))]);
  const reorder = useReorder<HTMLUListElement>({count: candidates.length, disabled: busy, onMove: (from, to) => {
    const next = [...candidates];
    next.splice(to, 0, next.splice(from, 1)[0]);
    updateCandidates(next);
  }});
  const shuffled = <T,>(items: T[]) => {
    const next = [...items];
    for (let i = next.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [next[i], next[j]] = [next[j], next[i]];
    }
    return next;
  };
  const shuffle = () => updateCandidates(shuffled(candidates));
  const editScale = (id: string, field: "min" | "max", value: string) => {
    setScaleDrafts(drafts => ({...drafts, [`${id}:${field}`]: value}));
    if (value.trim() !== "" && Number.isFinite(Number(value))) updateCriteria(criteria.map(c => c.id === id ? {...c, [field]: Number(value)} : c));
  };
  const normalizeScale = (id: string, field: "min" | "max") => {
    const key = `${id}:${field}`;
    const value = scaleDrafts[key];
    if (value !== undefined && value.trim() !== "" && Number.isFinite(Number(value))) setScaleDrafts(drafts => ({...drafts, [key]: String(Number(value))}));
  };
  const save = async () => {
    // Short answers have no scale.
    const badScale = (c: Criterion) => !isNotes(c) && (!Number.isInteger(c.min) || !Number.isInteger(c.max) || c.min < 0 || c.max > 10 || c.min >= c.max);
    if (criteria.some(c => !isNotes(c) && (["min", "max"] as const).some(field => {
      const value = scaleDrafts[`${c.id}:${field}`];
      return value !== undefined && (value.trim() === "" || !Number.isFinite(Number(value)));
    }))) { setMessage("Enter a minimum and maximum for each criterion."); return; }

    if (setupStep === "criteria") {
      if (!criteria.length || criteria.some(c => !c.label.trim() || badScale(c))) {
        setMessage("Add at least one named criterion with a valid rating scale from 0 to 10.");
        return;
      }
      setMessage(""); onContinue(); return;
    }
    if (!candidates.length || candidates.some(c => !c.name.trim()) || !criteria.length || criteria.some(c => !c.label.trim() || badScale(c))) {
      setMessage("Add at least one named candidate and criterion. Rating scales must use whole numbers from 0 to 10, with minimum below maximum.");
      return;
    }
    if (await onSave(candidates, criteria)) setMessage("");
  };
  return <section aria-label="Ballot setup" className="voting-admin-card voting-setup-editor" data-setup-step={setupStep}>
      <fieldset ref={candidateScroll} hidden={setupStep === "criteria"} disabled={busy} className="voting-admin-editor"><legend className="voting-sr-only">Candidates</legend><div className="voting-pane-heading"><div className="voting-pane-title"><h3>Candidates <span>{candidates.length}</span></h3></div><div className="voting-candidate-add"><button onClick={() => addNames([""])}>+ Add candidate</button><button ref={pasteTrigger} aria-expanded={pasteOpen} aria-controls="paste-candidates" onClick={() => setPasteOpen(!pasteOpen)}>Paste names</button><button aria-label="Shuffle order" disabled={candidates.length < 2} onClick={shuffle}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h3c5 0 7 12 12 12h3M18 15l3 3-3 3M3 18h3c2 0 4-2 5-4M13 10c2-3 3-4 5-4h3M18 3l3 3-3 3"/></svg>Shuffle</button></div>
      </div>
        {pasteOpen && <div id="paste-candidates" className="voting-paste-panel">
          <label className="voting-admin-paste" htmlFor="paste-candidate-names">One name per line</label>
          <textarea id="paste-candidate-names" autoFocus value={paste} onChange={e => setPaste(e.target.value)} rows={4} placeholder={"Alex Chen\nJordan Lee\nMorgan Wu"}/>
          <div className="voting-paste-actions">
            <button onClick={() => {setPasteOpen(false); pasteTrigger.current?.focus();}}>Cancel</button>
            <button className="voting-paste-confirm" disabled={!pastedNames.length} onClick={() => {addNames(pastedNames); setPaste(""); setPasteOpen(false); pasteTrigger.current?.focus();}}>{pastedNames.length ? `Add ${pastedNames.length} ${pastedNames.length === 1 ? "candidate" : "candidates"}` : "Add candidates"}</button>
          </div>
        </div>}
        <ul ref={reorder.listRef} className={`voting-candidate-editor-list${reorder.sorting ? " is-sorting" : ""}`} aria-label="Candidate order">
          {candidates.map((c, i) => <CandidateRow key={c.id} reorder={reorder} candidate={c} index={i} onPlatform={context => updateCandidates(candidates.map(x => x.id === c.id ? {...x, context} : x))} onRename={name => updateCandidates(candidates.map(x => x.id === c.id ? {...x, name} : x))} onRemove={() => updateCandidates(candidates.filter(x => x.id !== c.id))}/>)}
        </ul>
      </fieldset>
      <fieldset ref={criteriaScroll} hidden={setupStep === "candidates"} disabled={busy} className="voting-admin-editor"><legend className="voting-sr-only">Criteria</legend><div className="voting-pane-heading voting-criteria-heading"><div className="voting-pane-title"><h3>Criteria <span>{criteria.length}</span></h3></div><div className="voting-criteria-actions"><button onClick={() => updateCriteria([...criteria, {id: crypto.randomUUID(), label: "", description: "", min: 1, max: 5, required: true}])}>+ Add criteria</button><button className="voting-shuffle-criteria" aria-label="Shuffle criteria order" disabled={criteria.length < 2} onClick={() => updateCriteria(shuffled(criteria))}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h3c5 0 7 12 12 12h3M18 15l3 3-3 3M3 18h3c2 0 4-2 5-4M13 10c2-3 3-4 5-4h3M18 3l3 3-3 3"/></svg>Shuffle</button></div></div>{criteria.map(c => <div className="voting-admin-criterion" key={c.id}><div className="voting-criterion-heading"><label>Criterion<input placeholder="Criterion name" value={c.label} maxLength={150} onChange={e => updateCriteria(criteria.map(x => x.id === c.id ? {...x, label: e.target.value} : x))}/></label><button className="voting-remove-criterion" aria-label={`Remove ${c.label || "criterion"}`} onClick={() => updateCriteria(criteria.filter(x => x.id !== c.id))}>×</button></div><label>Description<textarea placeholder="Short description (optional)" value={c.description} rows={2} maxLength={1000} onChange={e => updateCriteria(criteria.map(x => x.id === c.id ? {...x, description: e.target.value} : x))}/></label><label className="voting-admin-kind">Answer type<span className="m-select-wrap"><select className="m-select is-compact" value={isNotes(c) ? "notes" : "rating"} onChange={e => updateCriteria(criteria.map(x => x.id === c.id ? {...x, kind: e.target.value as "rating" | "notes"} : x))}><option value="rating">Rating scale</option><option value="notes">Short answer</option></select><Icon name="chevron"/></span></label><div className="voting-admin-scale">{!isNotes(c) && <><label>Minimum<input type="number" min={0} max={9} step={1} value={scaleDrafts[`${c.id}:min`] ?? c.min} onChange={e => editScale(c.id, "min", e.target.value)} onBlur={() => normalizeScale(c.id, "min")}/></label><label>Maximum<input type="number" min={1} max={10} step={1} value={scaleDrafts[`${c.id}:max`] ?? c.max} onChange={e => editScale(c.id, "max", e.target.value)} onBlur={() => normalizeScale(c.id, "max")}/></label></>}<label className="voting-admin-check"><input type="checkbox" checked={c.required} onChange={e => updateCriteria(criteria.map(x => x.id === c.id ? {...x, required: e.target.checked} : x))}/> Required</label></div></div>)}</fieldset>
    {message && <p role="status">{message}</p>}
    <div className="d-narrow-actions"><button className="m-btn is-outline is-medium" disabled={busy} onClick={onBack}>Back</button><button className="m-btn is-medium" disabled={busy} onClick={save}>{busy ? "Starting…" : actionLabel}</button></div>
  </section>;
}

function CandidateRow({reorder, candidate, index, onPlatform, onRename, onRemove}: {
  reorder: ReturnType<typeof useReorder<HTMLUListElement>>;
  candidate: Candidate; index: number;
  onPlatform: (context: string) => void;
  onRename: (name: string) => void; onRemove: () => void;
}) {
  const {className, ...row} = reorder.rowProps(index);
  return <li {...row} className={`voting-admin-edit-row ${className}`.trim()}>
    <DragHandle label={candidate.name || "candidate"} {...reorder.handleProps(index)}/>
    <span className="voting-admin-number">{index + 1}</span>
    <label className="voting-candidate-name"><span className="voting-sr-only">Name</span><input placeholder="Candidate name" value={candidate.name} maxLength={120} onChange={e => onRename(e.target.value)}/></label>
    <div className="voting-admin-row-actions"><button className="voting-remove-candidate" aria-label={`Remove ${candidate.name || "candidate"}`} onClick={onRemove}>×</button></div>
    <label className="voting-candidate-platform"><span className="voting-sr-only">Platform for {candidate.name || "candidate"}</span><textarea placeholder="Platform (optional)" value={candidate.context} maxLength={5000} rows={2} onChange={event => onPlatform(event.target.value)}/></label>
  </li>;
}
