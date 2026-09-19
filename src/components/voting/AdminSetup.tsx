"use client";


import { useRef, useState, type CSSProperties, type RefObject } from "react";
import { useScrollEdges } from "./useScrollEdges";
import type { Candidate, Criterion } from "@/lib/voting/types";

interface Props {
  candidates: Candidate[];
  criteria: Criterion[];
  busy: boolean;
  joinedCount: number;
  onboarding?: boolean;
  onBack?: () => void;
  setupStep?: "candidates" | "criteria";
  showJoinedCount?: boolean;
  actionLabel?: string;
  onDraftChange?: (candidates: Candidate[], criteria: Criterion[]) => void;
  onContinue: () => void;
  onSave: (candidates: Candidate[], criteria: Criterion[]) => Promise<boolean>;
}

export default function AdminSetup({ candidates: initialCandidates, criteria: initialCriteria, busy, joinedCount, onboarding = false, onBack, setupStep, showJoinedCount = true, actionLabel = "Start", onDraftChange, onSave, onContinue }: Props) {
  const candidateScroll = useScrollEdges<HTMLFieldSetElement>();
  const criteriaScroll = useScrollEdges<HTMLFieldSetElement>();
  const listRef = useRef<HTMLUListElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const [split, setSplit] = useState(38);
  const [resizing, setResizing] = useState(false);
  const [candidates, setCandidates] = useState(initialCandidates);
  const [criteria, setCriteria] = useState(initialCriteria);
  const [scaleDrafts, setScaleDrafts] = useState<Record<string, string>>({});
  const [paste, setPaste] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const pasteTrigger = useRef<HTMLButtonElement>(null);
  const pastedNames = paste.split(/\r?\n/).map(name => name.trim()).filter(Boolean);
  const [drag, setDrag] = useState<{from: number; to: number; step: number} | null>(null);
  const [message, setMessage] = useState("");
  const updateCandidates = (next: Candidate[]) => { const ordered = next.map((c, order) => ({ ...c, order })); setCandidates(ordered); onDraftChange?.(ordered, criteria); setMessage(""); };
  const updateCriteria = (next: Criterion[]) => { setCriteria(next); onDraftChange?.(candidates, next); setMessage(""); };
  const addNames = (names: string[]) => updateCandidates([...candidates, ...names.map(name => ({ id: crypto.randomUUID(), name, context: "", order: 0, completed: false }))]);
  const move = (index: number, direction: number) => {
    const next = [...candidates];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    updateCandidates(next);
  };
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
    if (criteria.some(c => (["min", "max"] as const).some(field => {
      const value = scaleDrafts[`${c.id}:${field}`];
      return value !== undefined && (value.trim() === "" || !Number.isFinite(Number(value)));
    }))) { setMessage("Enter a minimum and maximum for each criterion."); return; }

    if (setupStep === "criteria") {
      if (!criteria.length || criteria.some(c => !c.label.trim() || !Number.isInteger(c.min) || !Number.isInteger(c.max) || c.min < 0 || c.max > 10 || c.min >= c.max)) {
        setMessage("Add at least one named criterion with a valid rating scale from 0 to 10.");
        return;
      }
      setMessage(""); onContinue(); return;
    }
    if (!candidates.length || candidates.some(c => !c.name.trim()) || !criteria.length || criteria.some(c => !c.label.trim() || !Number.isInteger(c.min) || !Number.isInteger(c.max) || c.min < 0 || c.max > 10 || c.min >= c.max)) {
      setMessage("Add at least one named candidate and criterion. Rating scales must use whole numbers from 0 to 10, with minimum below maximum.");
      return;
    }
    if (await onSave(candidates, criteria)) { setMessage(""); if (!onboarding) onContinue(); }
  };
  return <section ref={panelRef} style={{"--candidate-width": `${split}%`} as CSSProperties} aria-label="Ballot setup" className="voting-admin-card voting-setup-editor" data-setup-step={setupStep}>



      <fieldset ref={candidateScroll} hidden={setupStep === "criteria"} disabled={busy} className="voting-admin-editor"><legend className="voting-sr-only">Candidates</legend><div className="voting-pane-heading"><div className="voting-pane-title"><h3>Candidates <span>{candidates.length}</span></h3>{showJoinedCount && <span className="voting-joined-count" role="status">{joinedCount} {joinedCount === 1 ? "voter" : "voters"} joined</span>}</div>        <div className="voting-candidate-add"><button onClick={() => addNames([""])}>+ Add candidate</button><button ref={pasteTrigger} aria-expanded={pasteOpen} aria-controls="paste-candidates" onClick={() => setPasteOpen(!pasteOpen)}>Paste names</button><button aria-label="Shuffle order" disabled={candidates.length < 2} onClick={shuffle}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h3c5 0 7 12 12 12h3M18 15l3 3-3 3M3 18h3c2 0 4-2 5-4M13 10c2-3 3-4 5-4h3M18 3l3 3-3 3"/></svg>Shuffle</button></div>
      </div>
        {pasteOpen && <div id="paste-candidates" className="voting-paste-panel">
          <label className="voting-admin-paste" htmlFor="paste-candidate-names">One name per line</label>
          <textarea id="paste-candidate-names" autoFocus value={paste} onChange={e => setPaste(e.target.value)} rows={4} placeholder={"Alex Chen\nJordan Lee\nMorgan Wu"}/>
          <div className="voting-paste-actions">
            <button onClick={() => {setPasteOpen(false); pasteTrigger.current?.focus();}}>Cancel</button>
            <button className="voting-paste-confirm" disabled={!pastedNames.length} onClick={() => {addNames(pastedNames); setPaste(""); setPasteOpen(false); pasteTrigger.current?.focus();}}>{pastedNames.length ? `Add ${pastedNames.length} ${pastedNames.length === 1 ? "candidate" : "candidates"}` : "Add candidates"}</button>
          </div>
        </div>}

        <ul ref={listRef} className="voting-candidate-editor-list" aria-label="Candidate order">
          {candidates.map((c, i) => <CandidateRow listRef={listRef} dragging={drag !== null} shift={drag && i !== drag.from ? (drag.from < drag.to && i > drag.from && i <= drag.to ? -drag.step : drag.from > drag.to && i >= drag.to && i < drag.from ? drag.step : 0) : 0} onDragChange={setDrag} key={c.id} candidate={c} index={i} count={candidates.length} busy={busy} onPlatform={context => updateCandidates(candidates.map(x => x.id === c.id ? {...x, context} : x))} onRename={name => updateCandidates(candidates.map(x => x.id === c.id ? {...x, name} : x))} onMove={direction => move(i, direction)} onMoveTo={target => { const next = [...candidates]; next.splice(i, 1); next.splice(target, 0, c); updateCandidates(next); }} onRemove={() => updateCandidates(candidates.filter(x => x.id !== c.id))}/>)}
        </ul>


      </fieldset>
      {!onboarding && <div role="separator" aria-label="Resize candidates and criteria" aria-orientation="vertical" aria-valuemin={30} aria-valuemax={70} aria-valuenow={Math.round(split)} tabIndex={0} className={`voting-column-resizer ${resizing ? "is-resizing" : ""}`} onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); setResizing(true); }} onPointerMove={event => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const rect = panelRef.current?.getBoundingClientRect();
        if (rect) setSplit(Math.min(70, Math.max(30, (event.clientX - rect.left) / rect.width * 100)));
      }} onPointerUp={event => { event.currentTarget.releasePointerCapture(event.pointerId); setResizing(false); }} onPointerCancel={() => setResizing(false)} onLostPointerCapture={() => setResizing(false)} onKeyDown={event => {
        if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
          event.preventDefault(); setSplit(value => event.key === "Home" ? 30 : event.key === "End" ? 70 : Math.min(70, Math.max(30, value + (event.key === "ArrowLeft" ? -2 : 2))));
        }
      }}/>}
      <fieldset ref={criteriaScroll} hidden={setupStep === "candidates"} disabled={busy} className="voting-admin-editor"><legend className="voting-sr-only">Criteria</legend><div className="voting-pane-heading voting-criteria-heading"><div className="voting-pane-title"><h3>Criteria <span>{criteria.length}</span></h3></div><div className="voting-criteria-actions"><button onClick={() => updateCriteria([...criteria, {id: crypto.randomUUID(), label: "", description: "", min: 1, max: 5, required: true}])}>+ Add criteria</button><button className="voting-shuffle-criteria" aria-label="Shuffle criteria order" disabled={criteria.length < 2} onClick={() => updateCriteria(shuffled(criteria))}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h3c5 0 7 12 12 12h3M18 15l3 3-3 3M3 18h3c2 0 4-2 5-4M13 10c2-3 3-4 5-4h3M18 3l3 3-3 3"/></svg>Shuffle</button>{!onboarding && <button className="voting-admin-primary voting-start" disabled={busy} onClick={save}>{busy ? "Saving…" : actionLabel}<span aria-hidden="true">↗</span></button>}</div></div>{criteria.map(c => <div className="voting-admin-criterion" key={c.id}><div className="voting-criterion-heading"><label>Criterion<input placeholder="Criterion name" value={c.label} maxLength={150} onChange={e => updateCriteria(criteria.map(x => x.id === c.id ? {...x, label: e.target.value} : x))}/></label><button className="voting-remove-criterion" aria-label={`Remove ${c.label || "criterion"}`} onClick={() => updateCriteria(criteria.filter(x => x.id !== c.id))}>×</button></div><label>Description<textarea placeholder="Short description (optional)" value={c.description} rows={2} maxLength={1000} onChange={e => updateCriteria(criteria.map(x => x.id === c.id ? {...x, description: e.target.value} : x))}/></label><div className="voting-admin-scale"><label>Minimum<input type="number" min={0} max={9} step={1} value={scaleDrafts[`${c.id}:min`] ?? c.min} onChange={e => editScale(c.id, "min", e.target.value)} onBlur={() => normalizeScale(c.id, "min")}/></label><label>Maximum<input type="number" min={1} max={10} step={1} value={scaleDrafts[`${c.id}:max`] ?? c.max} onChange={e => editScale(c.id, "max", e.target.value)} onBlur={() => normalizeScale(c.id, "max")}/></label><label className="voting-admin-check"><input type="checkbox" checked={c.required} onChange={e => updateCriteria(criteria.map(x => x.id === c.id ? {...x, required: e.target.checked} : x))}/> Required</label></div></div>)}</fieldset>
    {message && <p role="status">{message}</p>}
    {onboarding && <div className="president-ballot-footer"><button className="president-setup-back" disabled={busy} onClick={onBack}>Back</button><button className="voting-admin-primary" disabled={busy} onClick={save}>{busy ? "Opening…" : actionLabel}</button></div>}
  </section>;
}

function CandidateRow({listRef, dragging, shift, onDragChange, candidate, index, count, busy, onPlatform, onRename, onMove, onMoveTo, onRemove}: {
  listRef: RefObject<HTMLUListElement | null>;
  dragging: boolean; shift: number; onDragChange: (drag: {from: number; to: number; step: number} | null) => void;
  candidate: Candidate; index: number; count: number; busy: boolean;
  onPlatform: (context: string) => void;
  onRename: (name: string) => void; onMove: (direction: number) => void; onMoveTo: (index: number) => void; onRemove: () => void;
}) {
  const rowRef = useRef<HTMLLIElement>(null);
  const gesture = useRef<{pointerId: number; startY: number; min: number; max: number; center: number; centers: number[]; target: number} | null>(null);
  const [offset, setOffset] = useState<number | null>(null);
  const startDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (busy || event.button !== 0 || !rowRef.current || !listRef.current) return;
    event.preventDefault();
    const row = rowRef.current.getBoundingClientRect();
    const list = listRef.current.getBoundingClientRect();
    gesture.current = {pointerId: event.pointerId, startY: event.clientY, min: list.top - row.top, max: list.bottom - row.bottom, center: row.top + row.height / 2, centers: [...listRef.current.children].map(el => { const box = el.getBoundingClientRect(); return box.top + box.height / 2; }), target: index};
    rowRef.current.setPointerCapture(event.pointerId);
    setOffset(0);
    onDragChange({from: index, to: index, step: gesture.current.centers.length > 1 ? gesture.current.centers[1] - gesture.current.centers[0] : row.height});
  };
  const endDrag = (event: React.PointerEvent<HTMLLIElement>, commit: boolean) => {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    gesture.current = null; setOffset(null); onDragChange(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (commit && !busy && active.target !== index) onMoveTo(active.target);
  };
  return <li ref={rowRef} className={`voting-admin-edit-row ${offset !== null ? "is-dragging" : ""}`} style={{transform: offset !== null || shift ? `translateY(${offset ?? shift}px)` : undefined, zIndex: offset !== null ? 2 : undefined, transition: dragging && offset === null ? "transform 160ms cubic-bezier(.2,.7,.2,1), background-color 150ms" : "background-color 150ms"}} onPointerDown={event => {
    if (!(event.target as HTMLElement).closest("input,button,textarea")) startDrag(event);
  }} onPointerMove={event => {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const delta = Math.min(active.max, Math.max(active.min, event.clientY - active.startY));
    const previousTarget = active.target;
    active.target = active.centers.reduce((best, center, i) => Math.abs(center - active.center - delta) < Math.abs(active.centers[best] - active.center - delta) ? i : best, index);
    if (active.target !== previousTarget) onDragChange({from: index, to: active.target, step: active.centers.length > 1 ? active.centers[1] - active.centers[0] : 0});
    setOffset(delta);
  }} onPointerUp={event => endDrag(event, true)} onPointerCancel={event => endDrag(event, false)} onLostPointerCapture={event => endDrag(event, false)}>
    <button type="button" className="voting-drag-handle" aria-label={`Reorder ${candidate.name || "candidate"}`} title="Drag to reorder. Use arrow keys to move." disabled={busy} onPointerDown={startDrag} onKeyDown={event => {
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        const direction = event.key === "ArrowUp" ? -1 : 1;
        if (!busy && index + direction >= 0 && index + direction < count) onMove(direction);
      }
    }}><svg width="12" height="18" viewBox="0 0 12 18" fill="currentColor" aria-hidden="true">{[4,9,14].map(y => <g key={y}><circle cx="3" cy={y} r="1.2"/><circle cx="9" cy={y} r="1.2"/></g>)}</svg></button>
    <span className="voting-admin-number">{index + 1}</span>
    <label className="voting-candidate-name"><span className="voting-sr-only">Name</span><input placeholder="Candidate name" value={candidate.name} maxLength={120} onChange={e => onRename(e.target.value)}/></label>
    <div className="voting-admin-row-actions"><button className="voting-remove-candidate" aria-label={`Remove ${candidate.name || "candidate"}`} onClick={onRemove}>×</button></div>
    <label className="voting-candidate-platform"><span className="voting-sr-only">Platform for {candidate.name || "candidate"}</span><textarea placeholder="Platform (optional)" value={candidate.context} maxLength={5000} rows={2} onChange={event => onPlatform(event.target.value)}/></label>
  </li>;
}
