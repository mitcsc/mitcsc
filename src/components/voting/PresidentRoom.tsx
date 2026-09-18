"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import AdminRoom from "./AdminRoom";
import type { VotingState } from "@/lib/voting/types";

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
  const [name, setName] = useState("");
  const [voterPassword, setVoterPassword] = useState("");
  const [sheetUrl, setSheetUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const requestId = useRef("");
  const refresh = useCallback(async () => {
    try {
      const next = await call<Overview>("president");
      if (!next.enabled) {window.location.replace("/vote"); return;}
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
    event.preventDefault(); setBusy(true); setError("");
    try {
      if (login) {await call("president", {action:"login", password}); setPassword("");}
      else {
        requestId.current ||= crypto.randomUUID();
        await call("president", {action:"create", requestId:requestId.current, name, password:voterPassword, sheetUrl});
        setVoterPassword(""); requestId.current = "";
      }
      await refresh();
    } catch (e) {setError((e as Error).message);}
    finally {setBusy(false);}
  }
  async function end() {
    if (!overview?.election || busy) return;
    setBusy(true); setError("");
    try {await call("president", {action:"end", sessionId:overview.election.sessionId}); await refresh();}
    catch (e) {setError((e as Error).message);}
    finally {setBusy(false);}
  }
  if (state) return <div className="president-room"><div className="president-bar"><span>{overview?.election?.name}</span><button className="voter-text-button" disabled={busy || !!state.exportPending || !["waiting","locked"].includes(state.phase)} onClick={() => void end()}>End session</button></div>{error && <div role="alert" className="voter-alert">{error}</div>}<AdminRoom initialState={state} onExit={exit} onStateChange={setState}/></div>;
  return <div className="voter-room"><section className="voter-panel voter-join"><Image className="voter-join-logo" src="/img/logo/logo.png" alt="MIT CSC" width={144} height={144} priority/>{error && <div className="voter-alert" role="alert">{error}</div>}{login || overview ? <form onSubmit={submit}>{login ? <input aria-label="President password" placeholder="President password" type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/> : <><input aria-label="Election name" placeholder="Election name" required maxLength={100} value={name} onChange={e=>setName(e.target.value)}/><input aria-label="Voter password" placeholder="Voter password" type="password" autoComplete="new-password" required maxLength={500} value={voterPassword} onChange={e=>setVoterPassword(e.target.value)}/><input aria-label="Results spreadsheet link" placeholder="Results spreadsheet link" type="url" required value={sheetUrl} onChange={e=>setSheetUrl(e.target.value)}/><p className="president-help">Use a new spreadsheet shared as Editor with {overview?.serviceAccount || "the service account"}.</p></>}<button className="voter-primary" disabled={busy}>{busy ? "Connecting…" : login ? "Continue" : "Create election"}</button></form> : <p role="status">Connecting…</p>}</section></div>;
}
