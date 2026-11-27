import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    console.log("[Perm Alert]", body?.text ?? "no text");
    console.log("[Perm Alert Report]", JSON.stringify(body?.report ?? null, null, 2));

    // TODO: forward ke Slack/Discord/email, atau simpan ke database jika diperlukan

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    console.error("[Perm Alert] invalid payload:", error);
    return NextResponse.json({ ok: false, error: "invalid payload" }, { status: 400 });
  }
}
