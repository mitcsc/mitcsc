"use client";

import { useRef, useState, type CSSProperties, type RefObject } from "react";
import { Reorder, useDragControls } from "framer-motion";
import type { Candidate, Criterion } from "@/lib/voting/types";

interface Props {
  candidates: Candidate[];
  criteria: Criterion[];
  busy: boolean;
  onContinue: () => void;
  onSave: (candidates: Candidate[], criteria: Criterion[]) => Promise<boolean>;
}

export default function AdminSetup({ candidates: initialCandidates, criteria: initialCriteria, busy, onSave, onContinue }: Props) {
  const listRef = useRef<HTMLUListElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const [split, setSplit] = useState(50);
  const [resizing, setResizing] = useState(false);
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
    if (await onSave(candidates, criteria)) { setDirty(false); setMessage("Setup saved."); onContinue(); }
  };
  return <section ref={panelRef} style={{"--candidate-width": `${split}%`} as CSSProperties} aria-label="Ballot setup" className={`voting-admin-card voting-setup-editor ${preview ? "is-preview" : ""}`}>

    {preview ? <div className="voting-admin-preview"><h3>{candidates[0]?.name || "Candidate name"}</h3>{criteria.map(c => <fieldset key={c.id}><legend>{c.label || "Untitled criterion"}{c.required ? " *" : ""}</legend><p>{c.description}</p><div className="voting-admin-ratings">{Array.from({length: Math.max(0, Math.min(11, c.max - c.min + 1))}, (_, i) => c.min + i).map(n => <label key={n}><input type="radio" name={`preview-${c.id}`} value={n}/><span>{n}</span></label>)}</div>{!c.required && <label><input type="radio" name={`preview-${c.id}`} value=""/> Not enough information</label>}</fieldset>)}</div> : <>
      <fieldset disabled={busy} className="voting-admin-editor"><legend>Candidates <span>{candidates.length}</span></legend>
        <Reorder.Group ref={listRef} axis="y" values={candidates} onReorder={next => { if (!busy) updateCandidates(next); }} className="voting-candidate-editor-list" aria-label="Candidate order">
          {candidates.map((c, i) => <CandidateRow listRef={listRef} key={c.id} candidate={c} index={i} count={candidates.length} busy={busy} onRename={name => updateCandidates(candidates.map(x => x.id === c.id ? {...x, name} : x))} onMove={direction => move(i, direction)} onRemove={() => updateCandidates(candidates.filter(x => x.id !== c.id))}/>)}
        </Reorder.Group>
        <div className="voting-candidate-add"><button onClick={() => addNames([""])}>+ Add candidate</button><button aria-expanded={pasteOpen} aria-controls="paste-candidates" onClick={() => setPasteOpen(!pasteOpen)}>Paste names</button></div>
        {pasteOpen && <div id="paste-candidates" className="voting-paste-panel"><label className="voting-admin-paste">Names, one per line<textarea autoFocus value={paste} onChange={e => setPaste(e.target.value)} rows={4} placeholder={"Name 1\nName 2\nName 3"}/></label><button disabled={!paste.trim()} onClick={() => {addNames(paste.split(/\r?\n/).map(n => n.trim()).filter(Boolean)); setPaste(""); setPasteOpen(false);}}>Add names</button></div>}

      </fieldset>
      <div role="separator" aria-label="Resize candidates and criteria" aria-orientation="vertical" aria-valuemin={30} aria-valuemax={70} aria-valuenow={Math.round(split)} tabIndex={0} className={`voting-column-resizer ${resizing ? "is-resizing" : ""}`} onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); setResizing(true); }} onPointerMove={event => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const rect = panelRef.current?.getBoundingClientRect();
        if (rect) setSplit(Math.min(70, Math.max(30, (event.clientX - rect.left) / rect.width * 100)));
      }} onPointerUp={event => { event.currentTarget.releasePointerCapture(event.pointerId); setResizing(false); }} onPointerCancel={() => setResizing(false)} onLostPointerCapture={() => setResizing(false)} onKeyDown={event => {
        if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
          event.preventDefault(); setSplit(value => event.key === "Home" ? 30 : event.key === "End" ? 70 : Math.min(70, Math.max(30, value + (event.key === "ArrowLeft" ? -2 : 2))));
        }
      }}/>
      <fieldset disabled={busy} className="voting-admin-editor"><legend>Criteria</legend>{criteria.map(c => <div className="voting-admin-criterion" key={c.id}><label>Criterion<input placeholder="Criterion name" value={c.label} maxLength={150} onChange={e => updateCriteria(criteria.map(x => x.id === c.id ? {...x, label: e.target.value} : x))}/></label><label>Description<textarea placeholder="Short description (optional)" value={c.description} rows={2} maxLength={1000} onChange={e => updateCriteria(criteria.map(x => x.id === c.id ? {...x, description: e.target.value} : x))}/></label><div className="voting-admin-scale"><label>Minimum<input type="number" min={0} max={9} step={1} value={c.min} onChange={e => updateCriteria(criteria.map(x => x.id === c.id ? {...x, min: Number(e.target.value)} : x))}/></label><label>Maximum<input type="number" min={1} max={10} step={1} value={c.max} onChange={e => updateCriteria(criteria.map(x => x.id === c.id ? {...x, max: Number(e.target.value)} : x))}/></label><label className="voting-admin-check"><input type="checkbox" checked={c.required} onChange={e => updateCriteria(criteria.map(x => x.id === c.id ? {...x, required: e.target.checked} : x))}/> Required</label><button onClick={() => updateCriteria(criteria.filter(x => x.id !== c.id))}>Remove</button></div></div>)}<button onClick={() => updateCriteria([...criteria, {id: crypto.randomUUID(), label: "", description: "", min: 1, max: 5, required: true}])}>+ Add criterion</button></fieldset>
    </>}
    <div className="voting-admin-save"><button className="voting-admin-primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Continue to preview"}</button><button type="button" onClick={() => setPreview(!preview)}>{preview ? "Edit setup" : "Preview ballot"}</button><span className="voting-admin-muted">{dirty ? "Unsaved changes" : ""}</span></div>{message && <p role="status">{message}</p>}
  </section>;
}

function CandidateRow({listRef, candidate, index, count, busy, onRename, onMove, onRemove}: {
  listRef: RefObject<HTMLUListElement | null>;
  candidate: Candidate; index: number; count: number; busy: boolean;
  onRename: (name: string) => void; onMove: (direction: number) => void; onRemove: () => void;
}) {
  const controls = useDragControls();
  return <Reorder.Item layout="position" dragConstraints={listRef} dragElastic={0} dragMomentum={false} value={candidate} dragListener={false} dragControls={controls} className="voting-admin-edit-row" whileDrag={{backgroundColor: "#1b1b1d", boxShadow: "0 8px 24px #0006", zIndex: 2}} onPointerDown={(event: React.PointerEvent<HTMLLIElement>) => {
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
