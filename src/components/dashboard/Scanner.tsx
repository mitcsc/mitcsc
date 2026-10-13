"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { scanCard, type CheckInResult } from "@/app/dashboard/actions";
import { Icon } from "@/components/membership/icons";
import { money } from "@/lib/membership/config";
import { CheckedInPill, oweNote, type Admit } from "./checkin-parts";
import { shortEmail } from "./format";

// The browser's built-in QR reader where it exists (Chrome on Android, Safari 17+ on some devices).
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
declare global {
  interface Window {
    BarcodeDetector?: { new (options: { formats: string[] }): BarcodeDetectorLike; getSupportedFormats?: () => Promise<string[]> };
  }
}

type Reader = (video: HTMLVideoElement) => Promise<string | null>;

async function makeReader(): Promise<Reader> {
  const Native = window.BarcodeDetector;
  const formats: string[] = (await Native?.getSupportedFormats?.().catch(() => [])) || [];
  if (Native && formats.includes("qr_code")) {
    const detector = new Native({ formats: ["qr_code"] });
    return async (video) => (await detector.detect(video).catch(() => []))[0]?.rawValue || null;
  }
  // Fallback: decode frames with jsQR, loaded only when needed.
  const { default: jsQR } = await import("jsqr");
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  return async (video) => {
    const scale = Math.min(1, 640 / Math.max(video.videoWidth, 1));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    if (!canvas.width || !canvas.height) return null;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" })?.data || null;
  };
}

const SCAN_GAP_MS = 180;

export default function Scanner({ eventId, eventName, onClose, onResult, admit }: {
  eventId: string; eventName: string; onClose: () => void; onResult: (result: CheckInResult) => void; admit: Admit;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const paused = useRef(false);
  const [result, setResult] = useState<CheckInResult | null>(null);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);

  // The camera loop lives across renders, so it reads the latest callback from a ref.
  const report = useRef(onResult);
  useEffect(() => { report.current = onResult; }, [onResult]);
  const show = useCallback((value: CheckInResult) => {
    setResult(value);
    if (value.kind !== "unknown") report.current(value);
    if (value.kind === "checked-in") navigator.vibrate?.(60);
  }, []);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer: number | undefined;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      } catch {
        setProblem("Allow camera access to scan cards, or search by name instead.");
        return;
      }
      if (stopped || !video.current) return stream.getTracks().forEach((t) => t.stop());
      video.current.srcObject = stream;
      await video.current.play().catch(() => undefined);
      const read = await makeReader();
      const tick = async () => {
        if (stopped) return;
        if (!paused.current && video.current && video.current.readyState >= 2) {
          const value = await read(video.current);
          if (value && !paused.current) {
            paused.current = true;
            setBusy(true);
            const response = await scanCard(eventId, value).catch(() => ({ ok: false as const, error: "Something went wrong. Please try again." }));
            setBusy(false);
            if (stopped) return;
            show(response.ok ? response.value : { kind: "unknown", message: response.error });
          }
        }
        timer = window.setTimeout(tick, SCAN_GAP_MS);
      };
      tick();
    })();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [eventId, show]);

  function next() {
    setResult(null);
    paused.current = false;
  }

  async function act(mode: "confirm" | "anyway") {
    if (result?.kind !== "unpaid") return;
    setBusy(true);
    const value = await admit(result.person.kerb, mode);
    setBusy(false);
    if (value) show(value);
  }

  return (
    <div className="m-root d-scan" role="dialog" aria-modal="true" aria-label="Scan membership cards">
      <div className="d-scan-view">
        <video ref={video} className="d-scan-video" playsInline muted />
        <div className="d-scan-top">
          <button type="button" className="m-back is-light" onClick={onClose}><Icon name="back" />Check-in</button>
          <span className="d-scan-event">{eventName}</span>
        </div>
        <div className="d-scan-center">
          <div className="d-scan-frame" aria-hidden="true"><span /><span /><span /><span /></div>
          <span className="d-scan-hint">{problem || (busy ? "Checking…" : "Point at a CSC membership card")}</span>
        </div>
      </div>
      {result && (
        <div className="d-scan-sheet" role="status">
          {result.kind === "unknown" ? (
            <p className="d-scan-message">{result.message}</p>
          ) : (
            <div className="d-scan-who">
              {result.kind === "unpaid" ? <span className="m-pill is-yellow is-big">Not paid</span> : <CheckedInPill at={result.record.at} big />}
              <span className="d-scan-name">{result.person.name}</span>
              <span className="d-tags"><span className="m-tag">{result.person.kerb}</span><span className="m-tag">{result.person.classYear}</span></span>
            </div>
          )}
          {result.kind === "checked-in" && <p className="d-scan-note">{result.count === 1 ? "1 person is here now." : `${result.count} people are here now.`}</p>}
          {result.kind === "already" && <p className="d-scan-note">Already checked in by {shortEmail(result.record.by)}. Nothing was added to the sheet.</p>}
          {result.kind === "unpaid" && (
            <>
              <p className="d-scan-note">{oweNote(result.person)}</p>
              <button type="button" className="m-btn is-block" disabled={busy} onClick={() => act("confirm")}>Confirm {money(result.person.price)} received</button>
              <button type="button" className="m-btn is-outline is-block" disabled={busy} onClick={() => act("anyway")}>Check in anyway</button>
              <button type="button" className="d-text-btn is-center" onClick={next}>Scan next</button>
            </>
          )}
          {result.kind !== "unpaid" && <button type="button" className="m-btn is-block" onClick={next}>Scan next</button>}
        </div>
      )}
    </div>
  );
}
