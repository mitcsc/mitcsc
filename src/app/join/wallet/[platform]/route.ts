import { NextResponse } from "next/server";
import { redeemCardLink } from "@/lib/membership/card-link";
import { MembershipError } from "@/lib/membership/errors";
import { ownMember, setMemberCookie } from "@/lib/membership/members";
import { clientIp, limit } from "@/lib/membership/rate-limit";
import { currentYear, getMember } from "@/lib/membership/store";
import { memberPass, type WalletProblem } from "@/lib/membership/wallet";

export const dynamic = "force-dynamic";

// Problems go back to /join as a fixed code, so a link can never put its own text on the page.
function back(request: Request, problem: WalletProblem) {
  return NextResponse.redirect(new URL(`/join?wallet=${problem}`, request.url), 303);
}

// The "Add to Apple Wallet" and "Add to Google Wallet" buttons are plain links to here,
// because iPhones add a pass only when the browser opens the .pkpass file itself.
// On the page a card email opens, the buttons carry the email's one-time link. The first tap
// uses it up and remembers this browser, so the other button and later visits still work.
export async function GET(request: Request, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  if (platform !== "apple" && platform !== "google") return new NextResponse(null, { status: 404 });
  const link = new URL(request.url).searchParams.get("link");
  try {
    const config = await currentYear();
    let member = await ownMember(config);
    if (link && config) {
      await limit("card-open", await clientIp(), 20, 600);
      const claimed = await redeemCardLink(link);
      const linked = claimed?.year === config.year ? await getMember(config.year, claimed.kerb) : null;
      if (linked) {
        await setMemberCookie(config.year, linked.kerb);
        member = linked;
      }
    }
    if (!config || !member) {
      return link ? NextResponse.redirect(new URL("/join/card?link=used", request.url), 303) : back(request, "missing");
    }
    const pass = await memberPass(config, member, new URL(request.url).origin);
    if (platform === "google") return NextResponse.redirect(pass.google, 303);
    return new NextResponse(new Uint8Array(pass.apple), {
      headers: {
        "Content-Type": "application/vnd.apple.pkpass",
        "Content-Disposition": `attachment; filename="csc-membership-${config.year}.pkpass"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (!(error instanceof MembershipError)) console.error(error);
    return back(request, error instanceof MembershipError && error.status === 429 ? "limit" : "off");
  }
}
