"use client";

import { useState } from "react";
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
  return <section className={`voting-admin-card voting-setup-editor ${preview ? "is-preview" : ""}`}>
    <div className="voting-admin-heading"><div><h2>Build your ballot</h2></div><button type="button" onClick={() => setPreview(!preview)}>{preview ? "Edit setup" : "Preview ballot"}</button></div>
    {preview ? <div className="voting-admin-preview"><h3>{candidates[0]?.name || "Candidate name"}</h3>{criteria.map(c => <fieldset key={c.id}><legend>{c.label || "Untitled criterion"}{c.required ? " *" : ""}</legend><p>{c.description}</p><div className="voting-admin-ratings">{Array.from({length: Math.max(0, Math.min(11, c.max - c.min + 1))}, (_, i) => c.min + i).map(n => <label key={n}><input type="radio" name={`preview-${c.id}`} value={n}/><span>{n}</span></label>)}</div>{!c.required && <label><input type="radio" name={`preview-${c.id}`} value=""/> Not enough information</label>}</fieldset>)}</div> : <>
      <fieldset disabled={busy} className="voting-admin-editor"><legend>Candidates <span>{candidates.length}</span></legend>
        {candidates.map((c, i) => <div className="voting-admin-edit-row" key={c.id}><div className="voting-admin-number">{i + 1}</div><div className="voting-admin-fields"><label>Name<input placeholder="Candidate name" value={c.name} maxLength={120} onChange={e => updateCandidates(candidates.map(x => x.id === c.id ? {...x, name: e.target.value} : x))}/></label></div><div className="voting-admin-row-actions"><button aria-label={`Move ${c.name || "candidate"} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button><button aria-label={`Move ${c.name || "candidate"} down`} disabled={i === candidates.length - 1} onClick={() => move(i, 1)}>↓</button><button aria-label={`Remove ${c.name || "candidate"}`} onClick={() => updateCandidates(candidates.filter(x => x.id !== c.id))}>Remove</button></div></div>)}
        <button onClick={() => addNames([""])}>+ Add candidate</button><label className="voting-admin-paste">Or paste names, one per line<textarea value={paste} onChange={e => setPaste(e.target.value)} rows={3} placeholder={"Alex Chen\nJordan Lee"}/></label><button disabled={!paste.trim()} onClick={() => {addNames(paste.split(/\r?\n/).map(n => n.trim()).filter(Boolean)); setPaste("");}}>Add pasted names</button>
      </fieldset>
      <fieldset disabled={busy} className="voting-admin-editor"><legend>Rating criteria</legend>{criteria.map(c => <div className="voting-admin-criterion" key={c.id}><label>Criterion<input placeholder="Criterion name, e.g. Reliability" value={c.label} maxLength={150} onChange={e => updateCriteria(criteria.map(x => x.id === c.id ? {...x, label: e.target.value} : x))}/></label><label>Description<textarea placeholder="Short description (optional)" value={c.description} rows={2} maxLength={1000} onChange={e => updateCriteria(criteria.map(x => x.id === c.id ? {...x, description: e.target.value} : x))}/></label><div className="voting-admin-scale"><label>Minimum<input type="number" min={0} max={9} step={1} value={c.min} onChange={e => updateCriteria(criteria.map(x => x.id === c.id ? {...x, min: Number(e.target.value)} : x))}/></label><label>Maximum<input type="number" min={1} max={10} step={1} value={c.max} onChange={e => updateCriteria(criteria.map(x => x.id === c.id ? {...x, max: Number(e.target.value)} : x))}/></label><label className="voting-admin-check"><input type="checkbox" checked={c.required} onChange={e => updateCriteria(criteria.map(x => x.id === c.id ? {...x, required: e.target.checked} : x))}/> Required</label><button onClick={() => updateCriteria(criteria.filter(x => x.id !== c.id))}>Remove</button></div></div>)}<button onClick={() => updateCriteria([...criteria, {id: crypto.randomUUID(), label: "", description: "", min: 1, max: 5, required: true}])}>+ Add criterion</button></fieldset>
    </>}
    <div className="voting-admin-save"><button className="voting-admin-primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save setup"}</button><span className="voting-admin-muted">{dirty ? "Unsaved changes" : ""}</span></div>{message && <p role="status">{message}</p>}
  </section>;
}
