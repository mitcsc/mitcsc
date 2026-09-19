"use client";
import CandidatePlatform from "./CandidatePlatform";
import VotingNotice from "./VotingNotice";

import WaitingPanda from "./WaitingPanda";

import { useRouter } from "next/navigation";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { FinalBallot, RecoveredBallot, Ratings, VotingPhase, VotingState } from "@/lib/voting/types";

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
  final: { label: "Voting open", description: "Review your ratings and submit your final vote." },
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
  const ballot = ["initial", "submit"].includes(path);
  // Freeze the payload across retries, including retries after an ambiguous timeout.
  const payload = body === undefined ? undefined : JSON.stringify(body);
  for (let attempt = 0; ; attempt++) {
    let retryAfter = 0;
    try {
      const response = await fetch(`/api/voting/${path}`, {
        signal: AbortSignal.timeout(ballot ? 65000 : 20000),
        method: body === undefined ? "GET" : "POST", cache: "no-store",
        headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: payload,
      });
      retryAfter = Number(response.headers.get("Retry-After")) || 0;
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(new Error(data.error || "Could not connect. Please try again."), {status: response.status});
      return data as T;
    } catch (error) {
      const status = (error as Error & {status?: number}).status;
      if (!ballot || attempt >= 4 || (status !== undefined && ![429, 502, 503, 504].includes(status))) throw error;
      const delay = Math.max(Math.min(30_000, 1000 * 2 ** attempt), Math.min(60_000, retryAfter * 1000));
      await new Promise(resolve => setTimeout(resolve, delay + Math.random() * 500));
    }
  }
}

export default function VoterRoom() {
  const router = useRouter();
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
  const pollAfter = useRef(0);
  const pollFailures = useRef(0);
  const joinRequired = useRef(false);
  const pendingPresenceRefresh = useRef(false);
  const presenceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastPresence = useRef(0);
  const lastHidden = useRef<boolean | null>(null);
  const joinToken = useRef<string | null>(null);
  const refresh = useCallback(async (): Promise<void> => {
    if (inFlight.current) {
      pendingPresenceRefresh.current = true;
      return;
    }
    inFlight.current = true;
    try {
      const hidden = document.hidden || !document.hasFocus();
      const elapsed = Date.now() - lastPresence.current;
      const heartbeat = elapsed >= 20000 || (lastHidden.current !== hidden && elapsed >= 1000);
      const next = await api<VotingState>(heartbeat ? `state?presence=${hidden ? "hidden" : "visible"}` : "state");
      if (heartbeat) { lastPresence.current=Date.now(); lastHidden.current=hidden; }
      pollFailures.current = 0; pollAfter.current = 0; joinRequired.current = false;
      if (!next.active && !next.isAdmin) {
        joinRequired.current = true;
        setState(null);
        setNeedsJoin(true);
        setPendingCount(0);
        setPassword("");
        setConnected(true);
        setError("");
        return;
      }
      setState(next);
      setNeedsJoin(false);
      setConnected(true);
      setError("");
    } catch (e) {
      const failure = e as Error & { status?: number };
      setConnected(false);
      pollAfter.current = Date.now() + Math.min(60_000, 4000 * 2 ** ++pollFailures.current) + Math.random() * 2000;
      if (failure.status === 401) {
        joinRequired.current = true;
        setNeedsJoin(true);
        setState(null);
        setError((failure.message.includes("kicked from this session") || failure.message.includes("banned from this session")) ? failure.message : "");
      } else setError(failure.message);
    } finally {
      setChecking(false);
      inFlight.current = false;
      if (pendingPresenceRefresh.current) {
        pendingPresenceRefresh.current = false;
        const changed = lastHidden.current !== (document.hidden || !document.hasFocus());
        if (!joinRequired.current && Date.now() >= pollAfter.current && (changed || Date.now()-lastPresence.current >= 20000)) {
          clearTimeout(presenceTimer.current);
          presenceTimer.current = setTimeout(() => void refresh(), Math.max(150, 1000-(Date.now()-lastPresence.current)));
        }
      }
    }
  }, []);
  useEffect(() => {
    if (state?.isAdmin) return;
    void refresh();
    const timer = window.setInterval(() => { if (!joinRequired.current && Date.now() >= pollAfter.current && (!document.hidden || Date.now() - lastPresence.current >= 20000)) void refresh(); }, state?.pollIntervalMs || 4000);
    // Visibility can fire before focus settles when returning to a tab.
    // Coalesce that event burst rather than publishing a temporary Away state.
    const resume = () => {
      clearTimeout(presenceTimer.current);
      presenceTimer.current = setTimeout(() => {
        const changed = lastHidden.current !== (document.hidden || !document.hasFocus());
        const elapsed = Date.now() - lastPresence.current;
        if (changed && elapsed < 1000) { resume(); return; }
        if (!joinRequired.current && (changed || elapsed >= 20000)) void refresh();
      }, Math.max(150, 1000 - (Date.now() - lastPresence.current)));
    };
    const reconnect = () => { if (!joinRequired.current) void refresh(); };
    const offline = () => { setConnected(false); setError("You are offline. Local drafts stay on this browser; reconnect before submitting."); };
    window.addEventListener("focus", resume);
    window.addEventListener("blur", resume);
    window.addEventListener("online", reconnect);
    window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", resume);
    return () => {
      window.clearInterval(timer);
      clearTimeout(presenceTimer.current);
      window.removeEventListener("focus", resume);
      window.removeEventListener("blur", resume);
      window.removeEventListener("online", reconnect);
      window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [refresh, state?.isAdmin, state?.pollIntervalMs]);
  const countPending = useCallback(() => {
    if (!state?.voter) return;
    try {
      const sessionPrefix = `${prefix}${encodeURIComponent(state.sessionId)}:${encodeURIComponent(state.voter.id)}:`;
      let count = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(sessionPrefix) && key !== draftKey(state)) {
          try { const draft = parseDraft(localStorage.getItem(key)); if (draft.initialConfirmed && !draft.submitted) count++; } catch { /* Ignore an unrelated corrupt draft. */ }
        }
      }
      setPendingCount(count);
    } catch { setPendingCount(0); }
  }, [state]);
  useEffect(() => { countPending(); }, [countPending]);
  useEffect(() => {
    if (state?.isAdmin) router.replace("/vote/admin");
  }, [state?.isAdmin, router]);
  async function join(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setJoining(true); setError("");
    try {
      const joinBrowser = async () => {
        let joinId: string | null = null;
        try { joinId = localStorage.getItem("csc-voting-join-id"); } catch { /* Storage can be disabled. */ }
        joinId ||= joinToken.current || crypto.randomUUID(); joinToken.current = joinId;
        try { localStorage.setItem("csc-voting-join-id", joinId); } catch { /* Keep the retry identity in memory. */ }
        await api("join", { name: name.trim(), password, joinId });
      };
      if (navigator.locks) await navigator.locks.request("csc-voting-join", joinBrowser);
      else await joinBrowser();
      setPassword("");
      lastPresence.current = 0;
      lastHidden.current = null;
      pollAfter.current = 0;
      pollFailures.current = 0;
      joinRequired.current = false;
      await refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setJoining(false); }
  }
  if (state?.isAdmin) return <div className="voter-room"><p role="status">Opening admin controls…</p></div>;
  return <div className="voter-room">

    {checking && <div className="voter-panel voter-wait" role="status">Connecting to the voting room…</div>}
    <VotingNotice message={error} actionLabel={!error.includes("kicked from this session") && !error.includes("banned from this session") && !joining && !checking ? "Reconnect" : undefined} onAction={() => void refresh()}/>

    {!checking && needsJoin && <section className="voter-panel voter-join">
      <Image className="voter-join-logo" src="/img/logo/logo.png" alt="MIT CSC" width={144} height={144} priority/>

      <form onSubmit={join}>
        <label htmlFor="voter-name"><span className="voting-sr-only">Name</span><input placeholder="Name" id="voter-name" name="name" autoComplete="name" maxLength={100} required value={name} onChange={e => setName(e.target.value)} /></label>
        <label htmlFor="voter-password"><span className="voting-sr-only">Code</span><input placeholder="Code" id="voter-password" name="password" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
        <button className="voter-primary" disabled={joining || !name.trim() || !password}>{joining ? "Joining…" : "Join"}</button>
      </form>
    </section>}
    {!checking && state && <>
      <div className="voter-session-bar"><span>{state.voter?.name}</span>{!connected && <span>Connection interrupted</span>}</div>
        <VotingNotice tone="info" message={pendingCount > 0 ? `${pendingCount} earlier ${pendingCount === 1 ? "vote is" : "votes are"} unfinished. Ask the admin to reopen submissions.` : ""}/>

        {state.admissionPending ? <div className="voter-panel voter-wait" role="status"><WaitingPanda/><h2 className="voter-discussion-shimmer">Waiting for admission</h2></div> : state.votingComplete ? <section className="voter-panel voter-wait voter-complete" role="status"><WaitingPanda jumpOnly/><h2>Voting is complete.</h2><p>All candidates are finished. Thank you for participating.</p></section> : !state.currentCandidate || state.phase === "waiting" ? <div className={`voter-panel voter-wait ${state.votingStarted ? "" : "voter-lobby"}`} role="status"><WaitingPanda/>{state.votingStarted ? <><h2 className="voter-discussion-shimmer">Waiting for the next candidate</h2></> : <><h2>You’re in.</h2><p>Voting will appear here when it begins.</p><div className="voter-lobby-joined"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg><span>Joined as {state.voter?.name}</span></div></>}</div> : <VoterBallot key={draftKey(state)} state={state} connected={connected} onSubmitted={() => { countPending(); void refresh(); }} />}
    </>}
    {!checking && !needsJoin && !state && !error && <div className="voter-panel">The voting room is not available yet.</div>}
  </div>;
}

function VoterBallot({ state, connected, onSubmitted }: { state: VotingState; connected: boolean; onSubmitted: () => void }) {
  const key = draftKey(state);
  const [draft, setDraft] = useState<Draft>(() => { try { const stored = parseDraft(localStorage.getItem(key)); return {...stored, initial: state.ownBallot?.initialSubmitted ? stored.initial : null, initialConfirmed: false, submitted: false, submissionId: stored.submitted ? undefined : stored.submissionId}; } catch { return emptyDraft(); } });
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
  // Only server responses in this mounted ballot establish confirmation. Stored flags
  // are drafts, not receipts; restore the authoritative values after a reload.
  const [initialVerified, setInitialVerified] = useState(false);
  const [submissionVerified, setSubmissionVerified] = useState(false);
  const [recovering, setRecovering] = useState(!!state.ownBallot?.initialSubmitted);
  useEffect(() => {
    if (!connected || !state.ownBallot?.initialSubmitted || (initialVerified && (!state.ownBallot.submitted || submissionVerified))) return;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    setRecovering(true);
    async function restore() {
      try {
        const saved = await api<RecoveredBallot>(`ballot?candidateId=${encodeURIComponent(state.currentCandidate!.id)}&version=${encodeURIComponent(state.ballotVersion)}`);
        if (cancelled) return;
        const current = draftRef.current;
        if (saved.initialRatings) persist({...current, initial: saved.initialRatings, initialConfirmed: true,
          final: saved.finalRatings || (current.submissionId ? current.final : saved.initialRatings),
          submitted: !!saved.submissionId, submissionId: saved.submissionId || current.submissionId});
        if (saved.initialRatings) { setInitialVerified(true); setSubmissionVerified(!!saved.submissionId); setError(""); }
        setRecovering(false);
      } catch {
        if (!cancelled) retry = setTimeout(() => void restore(), 2000);
      }
    }
    void restore();
    return () => { cancelled = true; clearTimeout(retry); };
    // The ballot component remounts when candidate or version changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, state.ownBallot?.initialSubmitted, state.ownBallot?.submitted, initialVerified, submissionVerified]);
  const initialAccepted = initialVerified || !!state.ownBallot?.initialSubmitted;
  const restoringInitial = !!state.ownBallot?.initialSubmitted && !initialVerified;
  const initialOpen = state.phase === "initial" && !initialAccepted;
  const revisionsOpen = ["revision", "final"].includes(state.phase) && !!draft.initial && initialAccepted;
  const editable = connected && !recovering && !busy && !draft.submitted && !draft.submissionId && (initialOpen || revisionsOpen);
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
      setInitialVerified(true);
      onSubmitted();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function submit() {
    if (busy || !draft.initial || !initialAccepted || draft.submitted || !["revision", "final"].includes(state.phase) || !connected) return;
    if (!validate(draft.final)) { setError("Your ballot does not match the current criteria. Ask the admin for help."); return; }
    setBusy(true); setError("");
    const next = { ...draft, submissionId: draft.submissionId || crypto.randomUUID() };
    persist(next);
    const ballot: FinalBallot = { submissionId: next.submissionId!, sessionId: state.sessionId, candidateId: state.currentCandidate!.id, ballotVersion: state.ballotVersion, initialRatings: next.initial!, finalRatings: complete(next.final) };
    try {
      await api("submit", ballot);
      persist({ ...next, submitted: true });
      setSubmissionVerified(true);
      onSubmitted();
    } catch (e) { setError(`${(e as Error).message} Your ballot is still pending. Retry when voting is open; the same submission ID will be used.`); }
    finally { setBusy(false); }
  }
  const phase = phases[state.phase];
  if (state.eligible === false) return <section className="voter-submitted" role="status"><WaitingPanda/><h2>{state.currentCandidate!.name}</h2><p className="voter-discussion-shimmer">{state.phase === "initial" ? "Waiting for admission" : "Waiting for the next candidate"}</p><p>{state.phase === "initial" ? "You joined after ratings opened. Ask the admin to admit you for this candidate." : "Initial ratings have closed. You can participate when the next candidate starts."}</p></section>;
  if (state.phase === "deliberation") return <section className="voter-discussion" aria-label="Discussion"><WaitingPanda/><h2>{state.currentCandidate!.name}</h2><p className="voter-discussion-shimmer" role="status">Discussion in progress</p><CandidatePlatform candidate={state.currentCandidate!}/></section>;
  if (submissionVerified || state.ownBallot?.submitted) return <section className="voter-submitted" role="status"><WaitingPanda/><h2>Vote submitted for {state.currentCandidate!.name}</h2><p className="voter-discussion-shimmer">Waiting for the next candidate</p><CandidatePlatform candidate={state.currentCandidate!}/></section>;

  if (recovering || restoringInitial) return <section className="voter-submitted" role="status"><p>Restoring your ratings…</p></section>;
  if (state.phase !== "initial" && !initialAccepted) return <section className="voter-submitted" role="status"><WaitingPanda/><h2>{state.currentCandidate!.name}</h2><p>Initial ratings were not received for this candidate.</p><p>Initial ratings have closed. You can participate when the next candidate starts.</p><CandidatePlatform candidate={state.currentCandidate!}/></section>;
  return <section className="voter-panel voter-ballot">
    <div className="voter-ballot-heading"><span className="voter-phase">{phase.label}</span><h2>{state.currentCandidate!.name}</h2><CandidatePlatform candidate={state.currentCandidate!}/></div>

    <VotingNotice message={storageError ? "Browser storage is unavailable. Keep this page open until you submit." : ""}/>
    {draft.submitted ? <div className="voter-success" role="status"><h3>Ballot received.</h3><p>Your ratings have been submitted.</p></div> : <>
      <VotingNotice tone="info" message={!initialAccepted && state.phase !== "initial" ? "Initial ratings were not received for this candidate." : ""}/>
      <VotingNotice tone="info" message={draft.submissionId ? "Submission not confirmed. Retry when submissions are open; your ratings are kept." : ""}/>

    </>}
    <div className="voter-criteria">{state.criteria.map((criterion) => <fieldset className="voter-criterion" key={criterion.id} disabled={!editable}>
      <legend>{criterion.label}{!criterion.required && <span className="voter-required">Optional</span>}</legend>
      {criterion.description && <p>{criterion.description}</p>}
      <div className="voter-scale" style={{"--rating-count": criterion.max - criterion.min + 1, "--rating-mobile-columns": Math.ceil((criterion.max - criterion.min + 1) / Math.ceil((criterion.max - criterion.min + 1) / 5))} as CSSProperties} role="radiogroup" aria-label={criterion.label}>{Array.from({ length: Math.max(0, Math.min(21, criterion.max - criterion.min + 1)) }, (_, i) => criterion.min + i).map(value => <label key={value} className={`voter-rating ${values[criterion.id] === value ? "voter-rating-selected" : draft.initial?.[criterion.id] === value ? "voter-rating-initial" : ""}`}><input type="radio" name={`${key}-${criterion.id}`} value={value} title={draft.initial?.[criterion.id] === value ? "Initial rating" : undefined} checked={values[criterion.id] === value} onChange={() => setRating(criterion.id, value)} /><span>{value}</span></label>)}{!criterion.required && <label className={`voter-rating voter-rating-na ${values[criterion.id] === null ? "voter-rating-selected" : draft.initial?.[criterion.id] === null ? "voter-rating-initial" : ""}`}><input type="radio" name={`${key}-${criterion.id}`} checked={values[criterion.id] === null} onChange={() => setRating(criterion.id, null)} /><span>Not enough information</span></label>}</div>
    </fieldset>)}</div>
    <VotingNotice message={error}/>
    {!draft.submitted && <div className="voter-ballot-actions">
      {state.phase === "initial" && !draft.initialConfirmed && <><button className="voter-primary" disabled={busy || !connected || !state.criteria.length} onClick={() => void saveInitial()}>{busy ? "Saving…" : error ? "Retry" : "Save ratings"}</button></>}
      {state.phase === "initial" && draft.initialConfirmed && <p className="voter-action-status">Ratings saved</p>}
      {["revision", "final"].includes(state.phase) && draft.initial && initialAccepted && <><button className="voter-primary" disabled={busy || !connected} onClick={() => void submit()}>{busy ? "Sending ballot…" : error ? "Retry" : "Submit vote"}</button></>}
      {state.phase === "locked" && draft.initial && <p className="voter-action-status">Submissions are closed. Ask the admin to reopen them if you still need to submit.</p>}
    </div>}
  </section>;
}
