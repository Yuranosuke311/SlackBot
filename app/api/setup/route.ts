import { NextRequest, NextResponse } from "next/server";
import { slack } from "@/lib/slack";

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const channelId = process.env.REMINDER_CHANNEL_ID!;

  const result = await slack.chat.postMessage({
    channel: channelId,
    text: "請求書リマインダー",
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "📋 *請求書リマインダー*\n送付期日が近い請求書を登録して、送り忘れを防ぎましょう。",
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            action_id: "open_registration_modal",
            style: "primary",
            text: { type: "plain_text", text: "+ 新しいリマインダーを登録" },
          },
        ],
      },
    ],
  });

  if (result.ts) {
    await slack.pins.add({
      channel: channelId,
      timestamp: result.ts,
    });
  }

  return NextResponse.json({ ok: true });
}
