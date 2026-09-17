"use client";

import { useState } from "react";
import { Reorder, useDragControls } from "framer-motion";
import type { Candidate, Criterion } from "@/lib/voting/types";

interface Props {
  candidates: Candidate[];
  criteria: Criterion[];
  busy: boolean;
  onSave: (candidates: Candidate[], criteria: Criterion[]) => Promise<boolean>;
}

export default function AdminSetup({ candidates: initialCandidates, criteria: initialCriteria, busy, onSave }: Props) {
  const [candidates, setCandidates] = useState(initialCandidates);
  const [criteria, setCriteria] = useState(initialCriteria);
  const [paste, setPaste] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [preview, setPreview] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const updateCandidates = (next: Candidate[]) => { setCandidates(next.map((c, order) => ({ ...c, order }))); setDirty(true); setMessage(""); };
  const updateCriteria = (next: Criterion[]) => { setCriteria(next); setDirty(true); setMessage(""); };
  const addNames = (names: string[]) => updateCandidates([...candidates, ...names.map(name => ({ id: crypto.randomUUID(), name, context: "", order: 0, completed: false }))]);
  const move = (index: number, direction: number) => {
    const next = [...candidates];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    updateCandidates(next);
  };
  const save = async () => {
    if (!candidates.length || candidates.some(c => !c.name.trim()) || !criteria.length || criteria.some(c => !c.label.trim() || !Number.isInteger(c.min) || !Number.isInteger(c.max) || c.min < 0 || c.max > 10 || c.min >= c.max)) {
      setMessage("Add at least one named candidate and criterion. Rating scales must use whole numbers from 0 to 10, with minimum below maximum.");
      return;
    }
    if (await onSave(candidates, criteria)) { setDirty(false); setMessage("Setup saved."); }
  };
  return <section aria-label="Ballot setup" className={`voting-admin-card voting-setup-editor ${preview ? "is-preview" : ""}`}>

    {preview ? <div className="voting-admin-preview"><h3>{candidates[0]?.name || "Candidate name"}</h3>{criteria.map(c => <fieldset key={c.id}><legend>{c.label || "Untitled criterion"}{c.required ? " *" : ""}</legend><p>{c.description}</p><div className="voting-admin-ratings">{Array.from({length: Math.max(0, Math.min(11, c.max - c.min + 1))}, (_, i) => c.min + i).map(n => <label key={n}><input type="radio" name={`preview-${c.id}`} value={n}/><span>{n}</span></label>)}</div>{!c.required && <label><input type="radio" name={`preview-${c.id}`} value=""/> Not enough information</label>}</fieldset>)}</div> : <>
      <fieldset disabled={busy} className="voting-admin-editor"><legend>Candidates <span>{candidates.length}</span></legend>
        <Reorder.Group axis="y" values={candidates} onReorder={next => { if (!busy) updateCandidates(next); }} className="voting-candidate-editor-list" aria-label="Candidate order">
          {candidates.map((c, i) => <CandidateRow key={c.id} candidate={c} index={i} count={candidates.length} busy={busy} onRename={name => updateCandidates(candidates.map(x => x.id === c.id ? {...x, name} : x))} onMove={direction => move(i, direction)} onRemove={() => updateCandidates(candidates.filter(x => x.id !== c.id))}/>)}
        </Reorder.Group>
        <div className="voting-candidate-add"><button onClick={() => addNames([""])}>+ Add candidate</button><button aria-expanded={pasteOpen} aria-controls="paste-candidates" onClick={() => setPasteOpen(!pasteOpen)}>Paste names</button></div>
        {pasteOpen && <div id="paste-candidates" className="voting-paste-panel"><label className="voting-admin-paste">Names, one per line<textarea autoFocus value={paste} onChange={e => setPaste(e.target.value)} rows={4} placeholder={"Name 1\nName 2\nName 3"}/></label><button disabled={!paste.trim()} onClick={() => {addNames(paste.split(/\r?\n/).map(n => n.trim()).filter(Boolean)); setPaste(""); setPasteOpen(false);}}>Add names</button></div>}

      </fieldset>
      <fieldset disabled={busy} className="voting-admin-editor"><legend>Rating criteria</legend>{criteria.map(c => <div className="voting-admin-criterion" key={c.id}><label>Criterion<input placeholder="Criterion name" value={c.label} maxLength={150} onChange={e => updateCriteria(criteria.map(x => x.id === c.id ? {...x, label: e.target.value} : x))}/></label><label>Description<textarea placeholder="Short description (optional)" value={c.description} rows={2} maxLength={1000} onChange={e => updateCriteria(criteria.map(x => x.id === c.id ? {...x, description: e.target.value} : x))}/></label><div className="voting-admin-scale"><label>Minimum<input type="number" min={0} max={9} step={1} value={c.min} onChange={e => updateCriteria(criteria.map(x => x.id === c.id ? {...x, min: Number(e.target.value)} : x))}/></label><label>Maximum<input type="number" min={1} max={10} step={1} value={c.max} onChange={e => updateCriteria(criteria.map(x => x.id === c.id ? {...x, max: Number(e.target.value)} : x))}/></label><label className="voting-admin-check"><input type="checkbox" checked={c.required} onChange={e => updateCriteria(criteria.map(x => x.id === c.id ? {...x, required: e.target.checked} : x))}/> Required</label><button onClick={() => updateCriteria(criteria.filter(x => x.id !== c.id))}>Remove</button></div></div>)}<button onClick={() => updateCriteria([...criteria, {id: crypto.randomUUID(), label: "", description: "", min: 1, max: 5, required: true}])}>+ Add criterion</button></fieldset>
    </>}
    <div className="voting-admin-save"><button className="voting-admin-primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save setup"}</button><button type="button" onClick={() => setPreview(!preview)}>{preview ? "Edit setup" : "Preview ballot"}</button><span className="voting-admin-muted">{dirty ? "Unsaved changes" : ""}</span></div>{message && <p role="status">{message}</p>}
  </section>;
}

function CandidateRow({candidate, index, count, busy, onRename, onMove, onRemove}: {
  candidate: Candidate; index: number; count: number; busy: boolean;
  onRename: (name: string) => void; onMove: (direction: number) => void; onRemove: () => void;
}) {
  const controls = useDragControls();
  return <Reorder.Item value={candidate} dragListener={false} dragControls={controls} className="voting-admin-edit-row" whileDrag={{backgroundColor: "#1b1b1d", boxShadow: "0 8px 24px #0006", zIndex: 2}} onPointerDown={(event: React.PointerEvent<HTMLLIElement>) => {
    if (!busy && !(event.target as HTMLElement).closest("input,button,textarea")) controls.start(event);
  }}>
    <button type="button" className="voting-drag-handle" aria-label={`Reorder ${candidate.name || "candidate"}`} title="Drag to reorder. Use arrow keys to move." disabled={busy} onPointerDown={event => { if (!busy) controls.start(event); }} onKeyDown={event => {
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        const direction = event.key === "ArrowUp" ? -1 : 1;
        if (!busy && index + direction >= 0 && index + direction < count) onMove(direction);
      }
    }}><svg width="12" height="18" viewBox="0 0 12 18" fill="currentColor" aria-hidden="true">{[4,9,14].map(y => <g key={y}><circle cx="3" cy={y} r="1.2"/><circle cx="9" cy={y} r="1.2"/></g>)}</svg></button>
    <span className="voting-admin-number">{index + 1}</span>
    <label className="voting-candidate-name"><span className="voting-sr-only">Name</span><input placeholder="Candidate name" value={candidate.name} maxLength={120} onChange={e => onRename(e.target.value)}/></label>
    <div className="voting-admin-row-actions"><button aria-label={`Move ${candidate.name || "candidate"} up`} disabled={busy || index === 0} onClick={() => onMove(-1)}>↑</button><button aria-label={`Move ${candidate.name || "candidate"} down`} disabled={busy || index === count - 1} onClick={() => onMove(1)}>↓</button><button className="voting-remove-candidate" aria-label={`Remove ${candidate.name || "candidate"}`} onClick={onRemove}>×</button></div>
  </Reorder.Item>;
}
