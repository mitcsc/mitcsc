"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import AdminSetup from "@/components/voting/AdminSetup";
import type { AdminAction, VotingPhase, VotingState } from "@/lib/voting/types";
import "./admin.css";

const phases: { phase: VotingPhase; label: string; description: string }[] = [
  {phase: "initial", label: "Initial ratings", description: "Voters save their first impressions in their browser."},
  {phase: "deliberation", label: "Deliberate", description: "Pause for discussion. Reveal candidate context when ready."},
  {phase: "revision", label: "Allow revisions", description: "Voters can revise their ratings locally before final submissions open."},
  {phase: "final", label: "Final submission", description: "Voters submit initial and final ratings together to Sheets."},
  {phase: "locked", label: "Close candidate", description: "Stop submissions and mark this candidate complete."},
];

async function responseData(response: Response) {
  const data = await response.json().catch(() => ({error: "The server returned an unexpected response. Please try again."}));
  if (!response.ok) throw new Error(data.error || "Unable to complete this request.");
  return data;
}

export default function DeliberationsAdminPage() {
  const [state, setState] = useState<VotingState | null>(null);
  const [loading, setLoading] = useState(true);
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [setupRevision, setSetupRevision] = useState(0);
  const [lastUpdated, setLastUpdated] = useState("");
  const pollInFlight = useRef(false);
  const mutating = useRef(false);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const applyState = useCallback((next: VotingState) => {
    setState(next);
    setLastUpdated(new Date().toLocaleTimeString([], {hour: "2-digit", minute: "2-digit", second: "2-digit"}));
  }, []);
  const refresh = useCallback(async () => {
    if (pollInFlight.current || mutating.current || document.hidden) return;
    pollInFlight.current = true;
    const revision = generation.current;
    const abort = new AbortController(); controller.current = abort;
    try {
      const response = await fetch("/api/voting/state", {cache: "no-store", signal: abort.signal});
      if (revision !== generation.current) return;
      if (response.status === 401) { setState(null); return; }
      const next: VotingState = await responseData(response);
      if (revision === generation.current) {applyState(next); setConnectionError("");}
    } catch (e) {
      if (!abort.signal.aborted && revision === generation.current) setConnectionError(e instanceof Error ? e.message : "Connection lost. Retrying automatically.");
    } finally {pollInFlight.current = false; setLoading(false);}
  }, [applyState]);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {void refresh();}, 4000);
    const visible = () => {if (!document.hidden) void refresh();};
    document.addEventListener("visibilitychange", visible);
    return () => {window.clearInterval(timer); document.removeEventListener("visibilitychange", visible); controller.current?.abort();};
  }, [refresh]);
  const act = async (action: AdminAction) => {
    if (mutating.current) return false;
    mutating.current = true; generation.current++; setBusy(true); setError(""); setNotice("");
    try {
      const next: VotingState = await responseData(await fetch("/api/voting/admin", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(action)}));
      applyState(next);
      if (action.action === "initialize" || action.action === "shuffle") setSetupRevision(x => x + 1);
      if (action.action === "shuffle") setNotice("Remaining candidate order shuffled and saved to Sheets.");
      if (action.action === "setPhase") setNotice(action.phase === "locked" ? "Candidate closed. Select the next candidate when ready." : "Session updated. Voters will receive this change in a few seconds.");
      return true;
    } catch (e) {setError(e instanceof Error ? e.message : "The change could not be saved."); return false;}
    finally {mutating.current = false; setBusy(false);}
  };
  const join = async (event: FormEvent) => {
    event.preventDefault(); if (mutating.current) return;
    mutating.current = true; generation.current++; setBusy(true); setError("");
    try {
      await responseData(await fetch("/api/voting/join", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({role: "voter", password, name: name.trim()})}));
      setPassword(""); applyState(await responseData(await fetch("/api/voting/state", {cache: "no-store"})));
    } catch (e) {setError(e instanceof Error ? e.message : "Unable to sign in.");}
    finally {mutating.current = false; setBusy(false);}
  };
  const logout = async () => {
    if (mutating.current) return;
    mutating.current = true; generation.current++; setBusy(true);
    try {await responseData(await fetch("/api/voting/logout", {method: "POST", headers: {"Content-Type": "application/json"}, body: "{}"})); setState(null); setNotice("");}
    catch (e) {setError(e instanceof Error ? e.message : "Unable to sign out.");}
    finally {mutating.current = false; setBusy(false);}
  };
  const candidates = [...(state?.candidates || [])].sort((a, b) => a.order - b.order);
  const started = !!state?.ballotVersion || candidates.some(c => c.completed) || (!!state && state.phase !== "waiting");
  const editable = state?.initialized && !started && state.phase === "waiting";
  const changePhase = (phase: VotingPhase) => {
    if (phase === "locked" && !window.confirm(`Close ${state?.currentCandidate?.name}? ${state?.submittedCount ?? 0} final ballots are saved. Initial drafts remain only in voters’ browsers, so confirm everyone has submitted. You can reopen final submissions later to collect missing ballots.`)) return;
    void act({action: "setPhase", phase});
  };
  const selectCandidate = (id: string) => {
    if (state?.phase !== "waiting" && state?.phase !== "locked") return;
    void act({action: "setPhase", phase: "waiting", candidateId: id});
  };
  const reopenCandidate = (id: string) => {
    if (state?.phase !== "waiting" && state?.phase !== "locked") return;
    if (!window.confirm("Reopen final submissions for this candidate? Existing ballots and the original ballot version stay unchanged. Voters with a pending local ballot can submit it.")) return;
    void act({action: "setPhase", phase: "final", candidateId: id});
  };
  const phaseDisabled = (phase: VotingPhase) => {
    if (busy || !state?.currentCandidate || state.phase === phase || !state.active) return true;
    if (phase === "initial") return state.currentCandidate.completed || (state.phase !== "waiting" && state.phase !== "locked");
    if (phase === "locked") return state.phase === "waiting" || state.phase === "locked";
    if (state.currentCandidate.completed || state.phase === "waiting" || state.phase === "locked") return true;
    const permitted: Partial<Record<VotingPhase, VotingPhase[]>> = {
      initial: ["deliberation", "revision", "final", "locked"],
      deliberation: ["revision", "final", "locked"],
      revision: ["deliberation", "final", "locked"],
      final: ["locked"],
    };
    return !state.ballotVersion || !permitted[state.phase]?.includes(phase);
  };
  return <div className="voting-admin">
    <header className="voting-admin-header"><div><p className="voting-admin-kicker">MIT Chinese Students’ Club · Deliberations</p><h1>Admin desk</h1><p>Set the ballot. Guide the discussion. Let everyone be heard.</p></div><div className="voting-admin-header-links"><Link href="/deliberations">Vote ↗</Link>{state?.isAdmin && <button disabled={busy} onClick={logout}>Sign out</button>}</div></header>
    {error && <div className="voting-admin-alert" role="alert">{error}</div>}
    {connectionError && <div className="voting-admin-alert" role="alert">{connectionError} Retrying automatically.</div>}
    {notice && <div className="voting-admin-notice" role="status">{notice}</div>}
    {loading ? <section className="voting-admin-card"><p role="status">Connecting to your election…</p></section> : !state?.isAdmin ? <section className="voting-admin-card voting-admin-login"><p className="voting-admin-kicker">Shared session access</p><h2>{state ? "Admin already assigned" : "Open the desk"}</h2>{state ? <><p>Someone else has already joined as admin. You’re signed in and can participate on the voting page.</p><Link href="/deliberations">Go to voting →</Link><p className="voting-admin-muted">If the admin loses browser access, a president can change “Reset admin access (optional)” (admin_reset) in Settings, then join again. Leave it blank for normal use.</p><button disabled={busy} onClick={logout}>Sign out</button></> : <><p>Enter your name and the shared session password. The first person to join becomes admin and can also vote.</p><form onSubmit={join}><label>Your name<input value={name} onChange={e => setName(e.target.value)} maxLength={120} autoComplete="name" required/></label><label>Session password<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required/></label><button className="voting-admin-primary" disabled={busy || !password || !name.trim()}>{busy ? "Checking…" : "Join session"}</button></form><p className="voting-admin-muted">The president should join before sharing the password with voters. Leave “Reset admin access (optional)” (admin_reset) blank normally; change it only to recover lost admin browser access, then join again.</p></>}</section> : <>
      <div className="voting-admin-session"><span className={`voting-admin-status ${state.active ? "is-active" : ""}`}>{state.active ? "Session active" : "Voting closed"}</span><span>{state.sessionId}</span><span className="voting-admin-muted">Updated {lastUpdated} · refreshes every 4s</span>{state.spreadsheetUrl && <a href={state.spreadsheetUrl} target="_blank" rel="noopener noreferrer">Open election sheet ↗</a>}</div>
      {!state.active && <div className="voting-admin-notice">Voting is closed. Set a session password in the permanent Settings sheet to let voters join and submit. You can still prepare the election here.</div>}
      {!state.initialized ? <section className="voting-admin-card"><p className="voting-admin-kicker">A clean start</p><h2>Set up this election</h2><p>We’ll add Candidates, Criteria, Responses, and Summary tabs to the connected spreadsheet. Existing votes will not be erased.</p><button className="voting-admin-primary" disabled={busy} onClick={() => void act({action: "initialize"})}>{busy ? "Setting up…" : "Set up election"}</button></section> : <>
        <div className="voting-admin-grid"><section className="voting-admin-card voting-admin-live"><div className="voting-admin-heading"><p className="voting-admin-kicker">On voters’ screens</p><span className="voting-admin-pill">{state.phase}</span></div><h2>{state.currentCandidate?.name || "Choose a candidate"}</h2><p>{state.phase === "waiting" ? "Voters are waiting. Select a candidate, then open initial ratings." : phases.find(p => p.phase === state.phase)?.description}</p><div className="voting-admin-count"><strong>{state.submittedCount}</strong><span>final ballots saved{state.currentCandidate ? ` for ${state.currentCandidate.name}` : ""}</span></div><p className="voting-admin-muted">Initial ratings and edits stay in each voter’s browser. This count includes final submissions only, not everyone who has joined or finished a draft.</p><div className="voting-admin-phase-list">{phases.map((p, i) => <button key={p.phase} disabled={phaseDisabled(p.phase)} className={state.phase === p.phase ? "is-current" : ""} onClick={() => changePhase(p.phase)}><span>{i + 1}</span>{p.label}{state.phase === p.phase && <small>Current</small>}</button>)}</div><label className="voting-admin-check voting-admin-context"><input type="checkbox" checked={state.contextVisible} disabled={busy || !state.currentCandidate} onChange={e => void act({action: "setContext", visible: e.target.checked})}/> Reveal candidate context to voters</label>{state.currentCandidate?.context && <blockquote>{state.currentCandidate.context}</blockquote>}</section>
        <section className="voting-admin-card"><div className="voting-admin-heading"><div><p className="voting-admin-kicker">Candidate queue</p><h2>{candidates.filter(c => c.completed).length} / {candidates.length} complete</h2></div></div><p className="voting-admin-muted">Keep this order or shuffle once. The saved order is shared by everyone.</p><button disabled={busy || candidates.filter(c => !c.completed && c.id !== state.currentCandidate?.id).length < 2} onClick={() => {if (window.confirm("Shuffle the saved remaining candidates? Save any setup edits first. The current and completed candidates will stay in place.")) void act({action: "shuffle"});}}>Shuffle remaining candidates</button><ol className="voting-admin-queue">{candidates.map((c, i) => <li className={c.id === state.currentCandidate?.id ? "is-current" : ""} key={c.id}><span className="voting-admin-number">{String(i + 1).padStart(2, "0")}</span><div><strong>{c.name}</strong><small>{c.completed ? "Completed" : c.id === state.currentCandidate?.id ? "Current candidate" : "Upcoming"}</small></div><button disabled={busy || (state.phase !== "waiting" && state.phase !== "locked") || (!c.completed && c.id === state.currentCandidate?.id)} onClick={() => c.completed ? reopenCandidate(c.id) : selectCandidate(c.id)}>{c.completed ? "Reopen submissions" : c.id === state.currentCandidate?.id ? "Selected" : "Select"}</button></li>)}</ol>{!candidates.length && <p>Add candidates in setup below to build your queue.</p>}<p className="voting-admin-muted">Nothing advances automatically. Close the current candidate before selecting another. Reopen submissions to collect missing ballots; already saved ballots stay unchanged.</p></section></div>
        {editable ? <AdminSetup key={`${state.sessionId}-${setupRevision}`} candidates={candidates} criteria={state.criteria} busy={busy} onSave={(nextCandidates, criteria) => act({action: "saveSetup", candidates: nextCandidates, criteria})}/> : <section className="voting-admin-card"><p className="voting-admin-kicker">Ballot fixed for this session</p><h2>Rating criteria</h2><p className="voting-admin-muted">Setup editing is locked after voting begins so saved drafts and ratings retain their meaning. Start a new session to change the ballot.</p><div className="voting-admin-read-criteria">{state.criteria.map(c => <div key={c.id}><strong>{c.label}</strong><span>{c.min}–{c.max} · {c.required ? "Required" : "Optional"}</span><p>{c.description}</p></div>)}</div></section>}
      </>}
    </>}
  </div>;
}
