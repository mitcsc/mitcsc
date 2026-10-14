import { headers } from "next/headers";
import LiveData from "@/components/dashboard/LiveData";
import MembersView, { type MemberRow } from "@/components/dashboard/MembersView";
import NoYear from "@/components/dashboard/NoYear";
import { sheetUrl } from "@/lib/membership/google/drive";
import { qrSvg } from "@/lib/membership/qr";
import { currentYear, listMembers } from "@/lib/membership/store";
import { syncStatus } from "@/lib/membership/sync";
import { lastVenmoCheck } from "@/lib/membership/venmo";

export default async function MembersPage() {
  const config = await currentYear();
  if (!config) return <NoYear />;
  const [members, sync, venmoCheckedAt, list] = await Promise.all([
    listMembers(config.year), syncStatus(`members:${config.year}`), lastVenmoCheck(config.year), headers(),
  ]);
  const host = list.get("host") || "csc.mit.edu";
  const signupUrl = `${host.startsWith("localhost") ? "http" : "https"}://${host}/join`;
  const rows: MemberRow[] = members.map((m) => ({
    kerb: m.kerb, name: m.name, classYear: m.classYear, dorm: m.dorm, answers: m.answers, type: m.type, price: m.price,
    method: m.method, status: m.status, reportedAt: m.reportedAt, paidAt: m.paidAt, paidVia: m.paidVia, confirmedBy: m.confirmedBy, createdAt: m.createdAt,
  }));
  return (
    <>
      <LiveData renderedAt={Date.now()} />
      <MembersView
        year={{ year: config.year, signupsOpen: config.signupsOpen, closesOn: config.closesOn, questions: config.form.questions.filter((q) => !q.builtin) }}
        members={rows}
        sheet={config.sheetId ? { url: sheetUrl(config.sheetId), sync } : null}
        venmoCheckedAt={venmoCheckedAt}
        signup={{ url: signupUrl, label: `${host}/join`, qr: qrSvg(signupUrl, "QR code for the membership signup page") }}
      />
    </>
  );
}
