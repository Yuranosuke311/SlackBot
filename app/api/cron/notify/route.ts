import { NextRequest, NextResponse } from "next/server";
import { slack } from "@/lib/slack";
import { getActiveReminderIds, getReminder } from "@/lib/reminders";

function getTodayJST(): string {
  // sv-SE ロケールは YYYY-MM-DD 形式で返す
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

function getDaysDiff(dueDate: string, today: string): number {
  const due = new Date(dueDate).getTime();
  const tod = new Date(today).getTime();
  return Math.round((due - tod) / (1000 * 60 * 60 * 24));
}

function getDaysText(diff: number): string {
  if (diff === 3) return "残り3日";
  if (diff === 2) return "残り2日";
  if (diff === 1) return "明日が期日です";
  if (diff === 0) return "本日が期日です";
  return `期日を ${Math.abs(diff)} 日過ぎています`;
}

function formatDateJST(dateStr: string): string {
  return new Date(dateStr + "T00:00:00+09:00").toLocaleDateString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = getTodayJST();
  const ids = await getActiveReminderIds();

  for (const id of ids) {
    try {
      const reminder = await getReminder(id);
      if (!reminder || reminder.status !== "active") continue;

      const diff = getDaysDiff(reminder.due_date, today);
      if (diff > 3) continue; // まだ通知不要

      const daysText = getDaysText(diff);
      const formattedDate = formatDateJST(reminder.due_date);

      const dmResult = await slack.conversations.open({
        users: reminder.user_id,
      });
      const dmChannelId = dmResult.channel?.id;
      if (!dmChannelId) continue;

      await slack.chat.postMessage({
        channel: dmChannelId,
        text: `📋 請求書リマインダー: ${reminder.recipient}（${daysText}）`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `📋 *請求書リマインダー*\n\n*送付先*: ${reminder.recipient}\n*期日*: ${formattedDate}（${daysText}）`,
            },
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                action_id: "complete_reminder",
                style: "primary",
                text: { type: "plain_text", text: "✅ 送付完了" },
                value: reminder.id,
              },
            ],
          },
        ],
      });
    } catch (err) {
      console.error(`Failed to notify reminder ${id}:`, err);
    }
  }

  return NextResponse.json({ ok: true });
}
