"use client";
import ElectionResults from "./ElectionResults";
import type { ElectionResults as Results } from "@/lib/voting/results";
import VotingNotice from "./VotingNotice";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTooltip } from "@/components/ui/useTooltip";
import AdminRoom from "./AdminRoom";
import AdminSetup from "./AdminSetup";
import VoterRoom from "./VoterRoom";
import type { Candidate, Criterion, VotingState } from "@/lib/voting/types";

type Overview = {
  me: {name: string};
  election: {sessionId: string; name: string; hostName: string; isHost: boolean} | null;
  hosted: {sessionId: string; name: string; open: boolean; createdAt: number}[];
};
type Step = "session" | "criteria" | "candidates";

async function call<T>(path: string, data?: object): Promise<T> {
  const response = await fetch(`/api/voting/${path}`, {method: data ? "POST" : "GET", cache: "no-store", signal: AbortSignal.timeout(60000), headers: data ? {"Content-Type":"application/json"} : undefined, body: data ? JSON.stringify(data) : undefined});
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(result.error || "Please try again."), {status: response.status});
  return result;
}
const defaultName = () => `Delibs ${new Date().toLocaleDateString("en-CA")}`;
const shortDate = (time: number) => new Date(time).toLocaleDateString(undefined, {month: "short", day: "numeric", year: "numeric"});

// The Delibs tab. Whoever starts a delib hosts it; every other exec joins it as a voter.
export default function DelibsRoom() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [state, setState] = useState<VotingState | null>(null);
  const [results, setResults] = useState<Results | null>(null);
  const [step, setStep] = useState<Step | null>(null);
  const [name, setName] = useState("");
  const [draft, setDraft] = useState<{candidates: Candidate[]; criteria: Criterion[]}>({candidates: [], criteria: []});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showVoters, setShowVoters] = useState(false);
  const votersTip = useTooltip("Manage voters");
  const votersButton = useRef<HTMLButtonElement>(null);
  const requestId = useRef("");
  const requestPayload = useRef("");
  useEffect(() => {
    if (!showVoters) return;
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!votersButton.current?.contains(target) && !document.getElementById("admin-voter-roster")?.contains(target)) setShowVoters(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setShowVoters(false); votersButton.current?.focus(); }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); };
  }, [showVoters]);
  const refresh = useCallback(async () => {
    try {
      const next = await call<Overview>("delibs");
      setState(next.election?.isHost ? await call<VotingState>("state") : null);
      setOverview(next);
      if (!next.election?.isHost) setShowVoters(false);
      setError("");
    } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  // While no delib is open, check for one, so a delib another exec starts shows up here.
  const idle = !!overview && !overview.election && !step && !results;
  useEffect(() => {
    if (!idle) return;
    const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 5000);
    return () => clearInterval(timer);
  }, [idle, refresh]);

  function startSetup() {
    setError(""); setName(defaultName()); setDraft({candidates: [], criteria: []}); setStep("session");
  }
  async function create(candidates: Candidate[], criteria: Criterion[]) {
    setBusy(true); setError("");
    try {
      const payload = {name: name.trim(), candidates, criteria};
      const fingerprint = JSON.stringify(payload);
      // A retry after a timeout reuses the request ID, so it cannot open a second delib.
      if (!requestId.current || requestPayload.current !== fingerprint) {
        requestId.current = crypto.randomUUID(); requestPayload.current = fingerprint;
      }
      await call("delibs", {action: "create", requestId: requestId.current, ...payload});
      requestId.current = ""; requestPayload.current = "";
      setStep(null); setDraft({candidates: [], criteria: []});
      await refresh();
      return true;
    } catch (e) { setError((e as Error).message); return false; }
    finally { setBusy(false); }
  }
  async function showResults(sessionId: string) {
    setError("");
    try { setResults(await call<Results>(`delibs?results=${encodeURIComponent(sessionId)}`)); }
    catch (e) { setError((e as Error).message); }
  }
  async function end() {
    const election = overview?.election;
    if (!election || busy) return;
    setBusy(true); setError("");
    try {
      await call("delibs", {action: "end", sessionId: election.sessionId});
      // The host most likely wants the final results next.
      await showResults(election.sessionId);
      await refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  if (!overview) return <div className="delibs-status" role="status">{error ? <VotingNotice message={error} actionLabel="Retry" onAction={() => void refresh()}/> : "Loading…"}</div>;

  if (results) return <div className="president-room"><VotingNotice message={error}/><ElectionResults results={results} busy={busy}
    onBack={() => setResults(null)}
    onEnd={overview.election?.isHost && overview.election.sessionId === results.sessionId ? () => void end() : undefined}/></div>;

  const election = overview.election;
  if (election && !election.isHost) return <div className="delibs-voter">
    <p className="delibs-voter-head"><span>{election.name}</span><span>Hosted by {election.hostName}</span></p>
    <VoterRoom key={election.sessionId} onEnded={() => void refresh()}/>
  </div>;

  if (election && state) return <div className="president-room">{votersTip.tooltip}
    <header className="president-live-header">
      <div className="president-live-title"><h1>{election.name}</h1><span className="president-round-label">Round {state.currentCandidate ? Math.max(1, (state.candidates?.filter(c => c.completed).length || 0) + (state.currentCandidate.completed ? 0 : 1)) : 0}/{state.candidates?.length || 0}</span></div>
      <div className="president-live-actions"><button ref={votersButton} className="president-voters-toggle" aria-label="Manage voters" {...votersTip.triggerProps} aria-expanded={showVoters} aria-controls="admin-voter-roster" onClick={() => setShowVoters(!showVoters)}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M21 20v-2a6 6 0 0 0-3-5"/></svg><span>{(state.voters || state.participants || []).filter(v => !("removed" in v && v.removed)).length}</span></button><button className="voting-end-session" disabled={busy || !["waiting", "locked"].includes(state.phase)} onClick={() => void end()}>{busy ? "Ending…" : "End voting"}</button></div>
    </header>
    <VotingNotice message={error}/>
    <AdminRoom onResults={() => void showResults(election.sessionId)} showVoters={showVoters} key={state.sessionId} initialState={state} onExit={() => void refresh()} onStateChange={setState}/>
  </div>;

  if (step === "criteria" || step === "candidates") return <main className="d-narrow"><div className="d-narrow-body">
    <SetupProgress step={step === "criteria" ? 2 : 3}/>
    <VotingNotice message={error}/>
    <div className="voting-admin president-ballot-setup">
      <AdminSetup key={step} onBack={() => { setError(""); setStep(step === "candidates" ? "criteria" : "session"); }} setupStep={step} candidates={draft.candidates} criteria={draft.criteria} busy={busy} actionLabel={step === "criteria" ? "Continue" : "Start delib"} onDraftChange={(candidates, criteria) => setDraft({candidates, criteria})} onSave={create} onContinue={() => setStep("candidates")}/>
    </div>
  </div></main>;

  if (step === "session") return <main className="d-narrow">
    <form className="d-narrow-body" onSubmit={event => { event.preventDefault(); setError(""); setStep("criteria"); }}>
      <SetupProgress step={1}/>
      <h1 className="d-narrow-title">New delib</h1>
      <p className="d-muted">You host it and see the full results. Other execs join from this tab with their Google account.</p>
      <div className="d-narrow-fields">
        <label className="d-field">
          <span className="m-label">Name</span>
          <input className="m-input is-compact" required maxLength={100} value={name} onChange={e => setName(e.target.value)}/>
        </label>
        <VotingNotice message={error}/>
      </div>
      <div className="d-narrow-actions">
        <button type="button" className="m-btn is-outline is-medium" onClick={() => { setError(""); setStep(null); }}>Cancel</button>
        <button className="m-btn is-medium" disabled={!name.trim()}>Continue</button>
      </div>
    </form>
  </main>;

  const past = overview.hosted.filter(h => !h.open);
  return <main className="d-narrow"><div className="d-narrow-body">
    <h1 className="d-narrow-title">No delib is running</h1>
    <p className="d-muted">Start one to rate candidates with the other execs. It shows up here for everyone, and only you see the full results.</p>
    <VotingNotice message={error}/>
    <button className="m-btn is-medium delibs-start" onClick={startSetup}>Start a delib</button>
    {past.length > 0 && <section className="delibs-past">
      <h2 className="m-label">Your past delibs</h2>
      <ul>{past.map(h => <li key={h.sessionId}>
        <span className="delibs-past-name">{h.name}</span>
        <span className="delibs-past-date">{shortDate(h.createdAt)}</span>
        <button className="d-chip-btn" onClick={() => void showResults(h.sessionId)}>Results</button>
      </li>)}</ul>
    </section>}
  </div></main>;
}

function SetupProgress({step}: {step: 1 | 2 | 3}) {
  const labels = ["Name", "Criteria", "Candidates"];
  return <div className="president-setup-progress" role="progressbar" aria-label="Delib setup" aria-valuemin={1} aria-valuemax={3} aria-valuenow={step} aria-valuetext={`Step ${step} of 3: ${labels[step - 1]}`}>
    {labels.map((label, index) => <span key={label} className={index + 1 === step ? "is-current" : index + 1 < step ? "is-complete" : ""}/>)}
  </div>;
}
