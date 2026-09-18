"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import AdminRoom from "./AdminRoom";
import AdminSetup from "./AdminSetup";
import type { Candidate, Criterion, VotingState } from "@/lib/voting/types";

type Overview = {enabled: boolean; election?: {sessionId: string; name: string; open: boolean} | null; serviceAccount?: string};
async function call<T>(path: string, data?: object): Promise<T> {
  const response = await fetch(`/api/voting/${path}`, {method: data ? "POST" : "GET", cache: "no-store", signal: AbortSignal.timeout(60000), headers: data ? {"Content-Type":"application/json"} : undefined, body: data ? JSON.stringify(data) : undefined});
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error || "Please try again."), {status: response.status});
  return result;
}
export default function PresidentRoom() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [state, setState] = useState<VotingState | null>(null);
  const [login, setLogin] = useState(false);
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<"session" | "ballot">("session");
  const [draft, setDraft] = useState<{candidates: Candidate[]; criteria: Criterion[]}>({candidates: [], criteria: []});
  const [voterPassword, setVoterPassword] = useState("");
  const [sheetUrl, setSheetUrl] = useState("");
  const [error, setError] = useState("");
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
    if (!login) { setError(""); setStep("ballot"); return; }
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
      setOverview(next); setState(nextState);
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
  if (state) return <div className="president-room">
    <header className="president-live-header">
      <div className="president-live-title"><span className="president-live-dot" aria-hidden="true"/><h1>Live session</h1><span className="president-live-progress">{state.candidates?.filter(candidate => candidate.completed).length || 0} / {state.candidates?.length || 0} complete</span></div>
      <div className="president-live-actions"><span className="president-live-voters">{state.participants?.length || 0} {state.participants?.length === 1 ? "voter" : "voters"}</span><button disabled={busy || !!state.exportPending || !["waiting","locked"].includes(state.phase)} onClick={() => void end()}>End session</button></div>
    </header>
    {error && <div role="alert" className="voter-alert">{error}</div>}
    <AdminRoom key={state.sessionId} initialState={state} onExit={exit} onStateChange={setState} setupComplete={!!state.candidates?.length && !!state.criteria.length}/>
  </div>;
  return <div className="president-room">
    {!login && overview && <header className="president-setup-header">
      <ol aria-label="Session setup progress"><li className={step === "ballot" ? "is-complete" : ""} aria-current={step === "session" ? "step" : undefined}><span>{step === "ballot" ? "✓" : "1"}</span>Session details</li><li aria-current={step === "ballot" ? "step" : undefined}><span>2</span>Ballot</li></ol>
      {step === "ballot" && <button type="button" className="voter-text-button" disabled={busy} onClick={() => {setError(""); setStep("session");}}>Back</button>}
    </header>}
    {!login && overview && step === "ballot" ? <div className="voting-admin voting-console president-ballot-setup">
      {error && <div className="voting-admin-alert" role="alert">{error}</div>}
      <AdminSetup candidates={draft.candidates} criteria={draft.criteria} busy={busy} joinedCount={0} showJoinedCount={false} actionLabel="Open session" onDraftChange={(candidates, criteria) => setDraft({candidates, criteria})} onSave={create} onContinue={() => {}}/>
    </div> : <div className="voter-room">
    <section className={`voter-panel voter-join ${!login && overview ? "president-create" : ""}`}>
      <Image className="voter-join-logo" src="/img/logo/logo.png" alt="MIT CSC" width={144} height={144} priority/>
      {error && <div className="voter-alert" role="alert">{error}</div>}
      {login || overview ? <form onSubmit={submit}>
        {login ? <input aria-label="Password" placeholder="Password" type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/> : <>
          <h1>Session details</h1>
          <label className="president-field">
            <span>Session code</span>
            <input aria-label="Session code" placeholder="Choose a code" type="password" autoComplete="new-password" required maxLength={500} aria-describedby="session-code-help" value={voterPassword} onChange={e=>setVoterPassword(e.target.value)}/>
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
        </>}
        <button className="voter-primary" disabled={busy || (login ? !password : !voterPassword || !sheetUrl.trim())}>{busy ? "Connecting…" : login ? "Continue" : "Continue to ballot"}</button>
      </form> : <p role="status">Connecting…</p>}
    </section>
    </div>}
  </div>;
}
