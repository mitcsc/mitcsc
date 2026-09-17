"use client";

import LoadingLabel from "./LoadingLabel";

import AdminRoom from "./AdminRoom";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FinalBallot, Ratings, VotingPhase, VotingState } from "@/lib/voting/types";

type Draft = {
  ratings: Ratings;
  initial: Ratings | null;
  initialConfirmed?: boolean;
  final: Ratings;
  submissionId?: string;
  submitted: boolean;
};
const phases: Record<VotingPhase, { label: string; description: string }> = {
  waiting: { label: "Waiting to begin", description: "Your admin will open the next ballot. This page updates automatically." },
  initial: { label: "Initial ratings", description: "Record your own first impression before the discussion begins." },
  deliberation: { label: "Discussion", description: "Discuss the candidate. Ratings are paused." },
  revision: { label: "Voting open", description: "You may revise your ratings after the discussion, or keep your original choices." },
  final: { label: "Voting open", description: "Review your ratings and send your initial and final responses together." },
  locked: { label: "Voting closed", description: "The admin has closed this ballot. Wait here for the next candidate." },
};
const prefix = "csc-voting-v1:";
function draftKey(state: VotingState) {
  return `${prefix}${encodeURIComponent(state.sessionId)}:${encodeURIComponent(state.voter?.id || "")}:${encodeURIComponent(state.currentCandidate?.id || "")}:${encodeURIComponent(state.ballotVersion)}`;
}
function emptyDraft(): Draft { return { ratings: {}, initial: null, final: {}, submitted: false }; }
function parseDraft(raw: string | null): Draft {
  if (!raw) return emptyDraft();
  const value = JSON.parse(raw) as Draft;
  const validRatings = (ratings: unknown) => ratings !== null && typeof ratings === "object" && !Array.isArray(ratings) && Object.values(ratings).every(v => v === null || (typeof v === "number" && Number.isFinite(v)));
  if (!validRatings(value.ratings) || !validRatings(value.final) || (value.initial !== null && !validRatings(value.initial)) || typeof value.submitted !== "boolean") throw new Error("Invalid local ballot");
  return value;
}
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/voting/${path}`, {
    signal: AbortSignal.timeout(20000),
    method: body === undefined ? "GET" : "POST",
    cache: "no-store",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || "Could not connect. Please try again."), { status: response.status });
  return data as T;
}

export default function VoterRoom() {
  const [state, setState] = useState<VotingState | null>(null);
  const [checking, setChecking] = useState(true);
  const [needsJoin, setNeedsJoin] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [joining, setJoining] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const inFlight = useRef(false);
  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const next = await api<VotingState>("state");
      setState(next);
      setNeedsJoin(false);
      setConnected(true);
      setError("");
    } catch (e) {
      const failure = e as Error & { status?: number };
      setConnected(false);
      if (failure.status === 401) {
        setNeedsJoin(true);
        setState(null);
        setError("");
      } else setError(failure.message);
    } finally {
      setChecking(false);
      inFlight.current = false;
    }
  }, []);
  useEffect(() => {
    if (state?.isAdmin) return;
    void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 4000);
    const resume = () => { if (!document.hidden) void refresh(); };
    const offline = () => { setConnected(false); setError("You are offline. Local drafts stay on this browser; reconnect before submitting."); };
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", resume);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
      window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [refresh, state?.isAdmin]);
  const countPending = useCallback(() => {
    if (!state?.voter) return;
    try {
      const sessionPrefix = `${prefix}${encodeURIComponent(state.sessionId)}:${encodeURIComponent(state.voter.id)}:`;
      let count = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(sessionPrefix) && key !== draftKey(state)) {
          try { const draft = parseDraft(localStorage.getItem(key)); if (draft.initial && !draft.submitted) count++; } catch { /* Ignore an unrelated corrupt draft. */ }
        }
      }
      setPendingCount(count);
    } catch { setPendingCount(0); }
  }, [state]);
  useEffect(() => { countPending(); }, [countPending]);
  const exitAdmin = useCallback((next?: VotingState) => {
    setState(next || null);
    setNeedsJoin(!next);
  }, []);
  async function join(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setJoining(true); setError("");
    try {
      await api("join", { name: name.trim(), password, role: "voter" });
      setPassword("");
      await refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setJoining(false); }
  }
  if (state?.isAdmin) return <AdminRoom initialState={state} onExit={exitAdmin}/>;
  return <div className="voter-room">

    {checking && <div className="voter-panel voter-wait" role="status"><LoadingLabel>Connecting to the voting room…</LoadingLabel></div>}
    {error && <div className="voter-alert" role="alert">{error} {!joining && !checking && <button className="voter-text-button" onClick={() => void refresh()}>Reconnect</button>}</div>}
    {!checking && needsJoin && <section className="voter-panel voter-join">
      <Image className="voter-join-logo" src="/img/logo/logo.png" alt="MIT CSC" width={144} height={144} priority/>

      <form onSubmit={join}>
        <label htmlFor="voter-name"><span className="voting-sr-only">Your name</span><input placeholder="Your name" id="voter-name" name="name" autoComplete="name" maxLength={100} required value={name} onChange={e => setName(e.target.value)} /></label>
        <label htmlFor="voter-password"><span className="voting-sr-only">Session password</span><input placeholder="Session password" id="voter-password" name="password" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
        <button className="voter-primary" disabled={joining || !name.trim() || !password}>{joining ? <LoadingLabel>Joining…</LoadingLabel> : "Join"}</button>
      </form>
    </section>}
    {!checking && state && <>
      <div className="voter-session-bar"><span>{state.voter?.name}</span>{!connected && <span>Connection interrupted</span>}</div>
        {pendingCount > 0 && <div className="voter-alert" role="status">{pendingCount} earlier {pendingCount === 1 ? "ballot remains" : "ballots remain"} unsubmitted on this browser. Tell your admin before leaving; advancing did not submit those ratings.</div>}
        {!state.active ? <div className="voter-panel voter-wait"><h2>Voting is paused.</h2><p>Your saved drafts remain on this browser. This page will update when the admin reopens the session.</p></div> : !state.currentCandidate || state.phase === "waiting" ? <div className={`voter-panel voter-wait ${state.votingStarted ? "" : "voter-lobby"}`} role="status">{state.votingStarted ? <><h2 className="voter-discussion-shimmer">Waiting for the next candidate</h2></> : <><div className="voter-lobby-status"><span aria-hidden="true"/>Waiting to start</div><h2>You’re in.</h2><p>Voting will appear here when it begins.</p><div className="voter-lobby-joined"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg><span>Joined as {state.voter?.name}</span></div></>}</div> : <VoterBallot key={draftKey(state)} state={state} connected={connected} onSubmitted={() => { countPending(); void refresh(); }} />}
    </>}
    {!checking && !needsJoin && !state && !error && <div className="voter-panel">The voting room is not available yet.</div>}
  </div>;
}

function VoterBallot({ state, connected, onSubmitted }: { state: VotingState; connected: boolean; onSubmitted: () => void }) {
  const key = draftKey(state);
  const [draft, setDraft] = useState<Draft>(() => { try { return parseDraft(localStorage.getItem(key)); } catch { return emptyDraft(); } });
  const [storageError, setStorageError] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const draftRef = useRef(draft);
  useEffect(() => {
    try {
      const existing = localStorage.getItem(key);
      if (existing) parseDraft(existing);
      localStorage.setItem(`${key}:probe`, "1"); localStorage.removeItem(`${key}:probe`);
    } catch { setStorageError(true); }
  }, [key]);
  function persist(next: Draft) {
    draftRef.current = next;
    setDraft(next);
    try { localStorage.setItem(key, JSON.stringify(next)); setStorageError(false); }
    catch { setStorageError(true); }
  }
  const initialOpen = state.phase === "initial" && !draft.initial;
  const revisionsOpen = ["revision", "final"].includes(state.phase) && !!draft.initial;
  const editable = connected && !busy && !draft.submitted && !draft.submissionId && (initialOpen || revisionsOpen);
  const values = draft.initial ? draft.final : draft.ratings;
  function validate(ratings: Ratings) {
    return state.criteria.every(c => {
      const value = ratings[c.id];
      if (value === undefined) return !c.required;
      return value === null ? !c.required : Number.isInteger(value) && value >= c.min && value <= c.max;
    });
  }
  function complete(ratings: Ratings): Ratings { return Object.fromEntries(state.criteria.map(c => [c.id, ratings[c.id] ?? null])); }
  function setRating(id: string, value: number | null) {
    setError("");
    const current = draftRef.current;
    if (current.initial) persist({ ...current, final: { ...current.final, [id]: value } });
    else persist({ ...current, ratings: { ...current.ratings, [id]: value } });
  }
  async function saveInitial() {
    if (busy || !connected) return;
    const ratings = draft.initial || complete(draft.ratings);
    if (!validate(ratings)) { setError("Choose a numeric rating for each required criterion."); return; }
    const next = {...draft, initial: {...ratings}, final: draft.initial ? draft.final : {...ratings}};
    persist(next);
    setBusy(true); setError("");
    try {
      await api("initial", {sessionId: state.sessionId, candidateId: state.currentCandidate!.id, ballotVersion: state.ballotVersion, ratings});
      persist({...next, initialConfirmed: true});
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function submit() {
    if (busy || !draft.initial || draft.submitted || !["revision", "final"].includes(state.phase) || !connected) return;
    if (!validate(draft.final)) { setError("Your ballot does not match the current criteria. Ask the admin for help."); return; }
    setBusy(true); setError("");
    const next = { ...draft, submissionId: draft.submissionId || crypto.randomUUID() };
    persist(next);
    const ballot: FinalBallot = { submissionId: next.submissionId!, sessionId: state.sessionId, candidateId: state.currentCandidate!.id, ballotVersion: state.ballotVersion, initialRatings: next.initial!, finalRatings: complete(next.final) };
    try {
      await api("submit", ballot);
      persist({ ...next, submitted: true });
      onSubmitted();
    } catch (e) { setError(`${(e as Error).message} Your ballot is still pending. Retry when voting is open; the same submission ID will be used.`); }
    finally { setBusy(false); }
  }
  const phase = phases[state.phase];
  if (state.phase === "deliberation") return <section className="voter-discussion" aria-label="Discussion"><h2>{state.currentCandidate!.name}</h2><p className="voter-discussion-shimmer" role="status">Discussion in progress</p></section>;
  if (draft.submitted) return <section className="voter-submitted" role="status"><h2>Vote submitted for {state.currentCandidate!.name}</h2><p>Waiting for the next candidate.</p></section>;
  return <section className="voter-panel voter-ballot">
    <div className="voter-ballot-heading"><span className="voter-phase">{phase.label}</span><h2>{state.currentCandidate!.name}</h2></div>

    {storageError && <div className="voter-alert" role="alert">Browser storage is unavailable or unreadable. Ratings currently exist only in this open page; do not refresh or close it before submitting.</div>}
    {draft.submitted ? <div className="voter-success" role="status"><h3>Ballot received.</h3><p>Your ratings have been submitted.</p></div> : <>
      {!draft.initial && state.phase !== "initial" && <div className="voter-alert" role="status">No saved initial ratings were found for this ballot on this browser. You cannot submit a final ballot yet. Tell your admin; if you voted in another browser, return to that browser.</div>}
      {draft.submissionId && <div className="voter-alert" role="status">A final submission was attempted but has not been confirmed on this browser. These ratings are preserved for retry when final submission is open.</div>}

    </>}
    <div className="voter-criteria">{state.criteria.map((criterion) => <fieldset className="voter-criterion" key={criterion.id} disabled={!editable}>
      <legend>{criterion.label}{!criterion.required && <span className="voter-required">Optional</span>}</legend>
      {criterion.description && <p>{criterion.description}</p>}
      <div className="voter-scale" role="radiogroup" aria-label={criterion.label}>{Array.from({ length: Math.max(0, Math.min(21, criterion.max - criterion.min + 1)) }, (_, i) => criterion.min + i).map(value => <label key={value} className={`voter-rating ${values[criterion.id] === value ? "voter-rating-selected" : draft.initial?.[criterion.id] === value ? "voter-rating-initial" : ""}`}><input type="radio" name={`${key}-${criterion.id}`} value={value} title={draft.initial?.[criterion.id] === value ? "Initial rating" : undefined} checked={values[criterion.id] === value} onChange={() => setRating(criterion.id, value)} /><span>{value}</span></label>)}{!criterion.required && <label className={`voter-rating voter-rating-na ${values[criterion.id] === null ? "voter-rating-selected" : draft.initial?.[criterion.id] === null ? "voter-rating-initial" : ""}`}><input type="radio" name={`${key}-${criterion.id}`} checked={values[criterion.id] === null} onChange={() => setRating(criterion.id, null)} /><span>Not enough information</span></label>}</div>
    </fieldset>)}</div>
    {error && <div className="voter-alert" role="alert">{error}</div>}
    {!draft.submitted && <div className="voter-ballot-actions">
      {state.phase === "initial" && !draft.initialConfirmed && <><button className="voter-primary" disabled={busy || !connected || !state.criteria.length} onClick={() => void saveInitial()}>{busy ? <LoadingLabel>Saving…</LoadingLabel> : error ? "Retry" : "Save ratings"}</button></>}
      {state.phase === "initial" && draft.initialConfirmed && <p className="voter-action-status">Ratings saved</p>}
      {["revision", "final"].includes(state.phase) && draft.initial && <><button className="voter-primary" disabled={busy || !connected} onClick={() => void submit()}>{busy ? <LoadingLabel>Sending ballot…</LoadingLabel> : error ? "Retry" : "Submit vote"}</button></>}
      {state.phase === "locked" && draft.initial && <p className="voter-action-status">This ballot was not submitted. Your draft remains here; tell your admin.</p>}
    </div>}
  </section>;
}
