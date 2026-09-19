"use client";
import ElectionResults from "./ElectionResults";
import type { ElectionResults as Results } from "@/lib/voting/results";
import VotingNotice from "./VotingNotice";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTooltip } from "@/components/ui/useTooltip";
import Image from "next/image";
import AdminRoom from "./AdminRoom";
import AdminSetup from "./AdminSetup";
import type { Candidate, Criterion, VotingState } from "@/lib/voting/types";

type Overview = {enabled: boolean; election?: {sessionId: string; name: string; open: boolean; joinCode?: string} | null; serviceAccount?: string};
async function call<T>(path: string, data?: object): Promise<T> {
  const response = await fetch(`/api/voting/${path}`, {method: data ? "POST" : "GET", cache: "no-store", signal: AbortSignal.timeout(60000), headers: data ? {"Content-Type":"application/json"} : undefined, body: data ? JSON.stringify(data) : undefined});
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error || "Please try again."), {status: response.status});
  return result;
}
export default function PresidentRoom() {
  const [results, setResults] = useState<Results | null>(null);
  const [newSession, setNewSession] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const codeTip = useTooltip(codeCopied ? "Copied" : "Copy session code");
  const codeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (codeTimer.current) clearTimeout(codeTimer.current); }, []);
  const votersTip = useTooltip("Manage voters");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [state, setState] = useState<VotingState | null>(null);
  const [login, setLogin] = useState(false);
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<"session" | "candidates" | "criteria">("session");
  const [draft, setDraft] = useState<{candidates: Candidate[]; criteria: Criterion[]}>({candidates: [], criteria: []});
  const [voterPassword, setVoterPassword] = useState("");
  const [sheetUrl, setSheetUrl] = useState("");
  const [error, setError] = useState("");
  const [showVoters, setShowVoters] = useState(false);
  const votersButton = useRef<HTMLButtonElement>(null);
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
  const [busy, setBusy] = useState(false);
  const requestId = useRef("");
  const requestPayload = useRef("");
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const serviceAccount = "mitcsc@ultra-heading-489105-v4.iam.gserviceaccount.com";
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);
  async function copyServiceAccount() {
    try {
      await navigator.clipboard.writeText(serviceAccount);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch { setError("Could not copy. Select the service account address and copy it manually."); }
  }
  const refresh = useCallback(async () => {
    try {
      const next = await call<Overview>("president");
      setOverview(next); setLogin(false);
      if (!next.election?.open) { setResults(null); setNewSession(true); setShowVoters(false); }
      setState(next.election?.open ? await call<VotingState>("state") : null);
    } catch (e) {
      if ((e as {status?: number}).status === 401) {setLogin(true); setState(null);}
      else setError((e as Error).message);
    }
  }, []);
  useEffect(() => {void refresh();}, [refresh]);
  const exit = useCallback(() => {setState(null); setLogin(true);}, []);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!login) { setError(""); setStep("criteria"); return; }
    setBusy(true); setError("");
    try { await call("president", {action:"login", password}); setPassword(""); await refresh(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function create(candidates: Candidate[], criteria: Criterion[]) {
    setBusy(true); setError("");
    try {
      const payload = {password:voterPassword, sheetUrl, candidates, criteria};
      const fingerprint = JSON.stringify(payload);
      if (!requestId.current || requestPayload.current !== fingerprint) {
        requestId.current = crypto.randomUUID(); requestPayload.current = fingerprint;
      }
      await call("president", {action:"create", requestId:requestId.current, ...payload});
      const next = await call<Overview>("president");
      const nextState = await call<VotingState>("state");
      setOverview(next); setState(nextState); setResults(null); setNewSession(false);
      setVoterPassword(""); setSheetUrl(""); setDraft({candidates: [], criteria: []}); setStep("session"); requestId.current = ""; requestPayload.current = "";
      return true;
    } catch (e) { setError((e as Error).message); return false; }
    finally { setBusy(false); }
  }
  async function end() {
    if (!overview?.election || busy) return;
    setBusy(true); setError("");
    try {await call("president", {action:"end", sessionId:overview.election.sessionId}); await refresh();}
    catch (e) {setError((e as Error).message);}
    finally {setBusy(false);}
  }
  async function showResults() { try { setResults(await call<Results>("president?view=results")); } catch (e) { setError((e as Error).message); } }
  if (results && !newSession) return <div className="president-room"><VotingNotice message={error}/><ElectionResults onEnd={overview?.election?.open ? ()=>void end() : undefined} busy={busy} results={results} onBack={()=>{setResults(null); if (!overview?.election?.open) setNewSession(true);}}/></div>;
  if (state) return <div className="president-room">{votersTip.tooltip}
    <header className="president-live-header">
      <div className="president-live-title"><span className="president-round-label">Round {state.currentCandidate ? Math.max(1, (state.candidates?.filter(c=>c.completed).length || 0) + (state.currentCandidate.completed ? 0 : 1)) : 0}/{state.candidates?.length || 0}</span></div>
      <div className="president-live-actions">{overview?.election?.joinCode && <button className="president-join-code" aria-label="Copy session code" {...codeTip.triggerProps} onClick={async () => {
        try { await navigator.clipboard.writeText(overview.election!.joinCode!); setCodeCopied(true); if (codeTimer.current) clearTimeout(codeTimer.current); codeTimer.current = setTimeout(() => setCodeCopied(false), 2000); }
        catch { setError("Could not copy. Select the session code and copy it manually."); }
      }}><span className="president-code-value">{overview.election.joinCode}</span><span aria-live="polite">{codeCopied ? "✓" : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/></svg>}</span></button>}{codeTip.tooltip}<button ref={votersButton} className="president-voters-toggle" aria-label="Manage voters" {...votersTip.triggerProps} aria-expanded={showVoters} aria-controls="admin-voter-roster" onClick={() => setShowVoters(!showVoters)}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M21 20v-2a6 6 0 0 0-3-5"/></svg><span>{(state.voters || state.participants || []).filter(v => !("removed" in v && v.removed)).length}</span></button><button className="voting-end-session" disabled={busy || !!state.exportPending || !["waiting","locked"].includes(state.phase)} onClick={() => void end()}>End session</button></div>
    </header>
    <VotingNotice message={error}/>
    <AdminRoom onResults={()=>void showResults()} showVoters={showVoters} key={state.sessionId} initialState={state} onExit={exit} onStateChange={setState} setupComplete={!!state.candidates?.length && !!state.criteria.length}/>
  </div>;
  return <div className="president-room">
    {!login && overview && step !== "session" ? <div className="voting-admin voting-console president-ballot-setup">
      <header className="president-ballot-heading">
        <Image className="president-ballot-logo" src="/img/logo/logo.png" alt="MIT CSC" width={88} height={88} priority/>
        <SetupProgress step={step === "criteria" ? 2 : 3}/>

      </header>
      <VotingNotice message={error}/>
      <AdminSetup key={step} onboarding onBack={() => {setError(""); setStep(step === "candidates" ? "criteria" : "session");}} setupStep={step} candidates={draft.candidates} criteria={draft.criteria} busy={busy} joinedCount={0} showJoinedCount={false} actionLabel={step === "criteria" ? "Continue to candidates" : "Open session"} onDraftChange={(candidates, criteria) => setDraft({candidates, criteria})} onSave={create} onContinue={() => setStep("candidates")}/>
    </div> : <div className="voter-room">
    <section className={`voter-panel voter-join ${!login && overview ? "president-create" : ""}`}>
      {!login && overview ? <header className="president-ballot-heading">
        <Image className="president-ballot-logo" src="/img/logo/logo.png" alt="MIT CSC" width={88} height={88} priority/>
        <SetupProgress step={1}/><div><h1>Session details</h1></div>
      </header> : <Image className="voter-join-logo" src="/img/logo/logo.png" alt="MIT CSC" width={144} height={144} priority/>}
      <VotingNotice message={error}/>
      {login || overview ? <form onSubmit={submit}>
        {login ? <input aria-label="Password" placeholder="Password" type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/> : <>
          <div className="president-session-fields">
          <label className="president-field">
            <span>Session code</span>
            <input aria-label="Session code" placeholder="Choose a code" type="text" autoComplete="off" autoCapitalize="none" spellCheck={false} required maxLength={500} aria-describedby="session-code-help" value={voterPassword} onChange={e=>setVoterPassword(e.target.value)}/>
            <span id="session-code-help" className="president-help">Share this code with voters.</span>
          </label>
          <label className="president-field">
            <span>Link to spreadsheet</span>
            <input placeholder="https://docs.google.com/spreadsheets/…" type="url" required aria-describedby="session-sheet-help" value={sheetUrl} onChange={e=>setSheetUrl(e.target.value)}/>
          </label>
          <div className="president-sheet-help">
            <p id="session-sheet-help" className="president-help">Results will be saved here. Share a new spreadsheet as Editor with this service account:</p>
            <div className="president-service-account">
              <span title={serviceAccount}>{serviceAccount}</span>
              <button type="button" onClick={() => void copyServiceAccount()} aria-label={copied ? "Service account copied" : "Copy service account"}><span aria-live="polite">{copied ? "Copied" : "Copy"}</span></button>
            </div>
          </div>
          </div>
        </>}
        <button className="voter-primary" disabled={busy || (login ? !password : !voterPassword || !sheetUrl.trim())}>{busy ? "Connecting…" : login ? "Continue" : "Continue to criteria"}</button>
      </form> : <p role="status">Connecting…</p>}
    </section>
    </div>}
  </div>;
}

function SetupProgress({step}: {step: 1 | 2 | 3}) {
  const labels = ["Session details", "Criteria", "Candidates"];
  return <div className="president-setup-progress" role="progressbar" aria-label="Session setup" aria-valuemin={1} aria-valuemax={3} aria-valuenow={step} aria-valuetext={`Step ${step} of 3: ${labels[step - 1]}`}>
    {labels.map((label, index) => <span key={label} className={index + 1 === step ? "is-current" : index + 1 < step ? "is-complete" : ""}/>)}
  </div>;
}
