import { NextRequest, NextResponse } from "next/server";
import type { KnownBlock } from "@slack/types";
import { slack } from "@/lib/slack";
import { getKnownInternIds } from "@/lib/intern-profiles";
import {
  getSubmissionsForMonth,
  getSubmittedUserIds,
} from "@/lib/intern-salaries";

function getTodayJST(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

function getCurrentMonthJST(): string {
  const formatter = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
  });
  const parts = formatter.formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  return `${year}-${month}`;
}

function getLastDayOfMonth(year: number, month: number): string {
  const date = new Date(Date.UTC(year, month, 0));
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getPreviousMonth(month: string): string {
  const [yearStr, monthStr] = month.split("-");
  const year = Number(yearStr);
  const m = Number(monthStr);
  if (m === 1) return `${year - 1}-12`;
  return `${year}-${String(m - 1).padStart(2, "0")}`;
}

function getPastMonths(currentMonth: string, count: number): string[] {
  const months: string[] = [];
  let month = currentMonth;
  for (let i = 0; i < count; i++) {
    month = getPreviousMonth(month);
    months.push(month);
  }
  return months;
}


function getDaysUntil(targetDate: string, today: string): number {
  const target = new Date(targetDate).getTime();
  const base = new Date(today).getTime();
  return Math.round((target - base) / (1000 * 60 * 60 * 24));
}

function formatDateJP(dateStr: string): string {
  const [year, month, day] = dateStr.split("-");
  return `${year}年${month}月${day}日`;
}

function formatMonthJP(month: string): string {
  const [year, monthNum] = month.split("-");
  return `${year}年${monthNum}月`;
}

// 口座番号の末尾数字列を後3桁残してマスク
// 例: "〇〇銀行 〇〇支店 普通 1234567" → "〇〇銀行 〇〇支店 普通 ****567"
function maskBankInfo(bankInfo: string): string {
  return bankInfo.replace(/\d{4,}/g, (m) => "*".repeat(m.length - 3) + m.slice(-3));
}

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = getTodayJST();
  const currentMonth = getCurrentMonthJST();
  const [currentYearStr, currentMonthStr] = currentMonth.split("-");
  const currentYear = Number(currentYearStr);
  const currentMonthNumber = Number(currentMonthStr);
  const lastDayOfMonth = getLastDayOfMonth(currentYear, currentMonthNumber);
  const daysUntilSubmission = getDaysUntil(lastDayOfMonth, today);

  // ケース A: 毎月1日に月次案内をチャンネル投稿
  if (today.endsWith("-01")) {
    await slack.chat.postMessage({
      channel: process.env.INTERN_SALARY_CHANNEL_ID!,
      text: "今月の給与情報を提出してください",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `💰 *今月の給与情報を提出してください*\n提出期限: ${formatDateJP(lastDayOfMonth)}`,
          },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              action_id: "open_intern_salary_modal",
              text: { type: "plain_text", text: "📝 給与情報を提出する" },
              value: "open",
            },
          ],
        },
      ],
    });
  }

  // ケース B: 月末3日前〜月末日まで未提出者へDMリマインド
  if (daysUntilSubmission >= 0 && daysUntilSubmission <= 3) {
    const knownIds = await getKnownInternIds();
    const submittedIds = await getSubmittedUserIds(currentMonth);
    const unsubmittedIds = knownIds.filter((id) => !submittedIds.includes(id));

    for (const userId of unsubmittedIds) {
      try {
        const dmResult = await slack.conversations.open({ users: userId });
        const dmChannelId = dmResult.channel?.id;
        if (!dmChannelId) continue;

        await slack.chat.postMessage({
          channel: dmChannelId,
          text: "給与情報の提出期限が近づいています",
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `⚠️ *給与情報の提出期限が近づいています*\n提出期限: ${formatDateJP(lastDayOfMonth)}（残り${daysUntilSubmission}日）\n\nまだ提出されていません。下記から提出してください。`,
              },
            },
            {
              type: "actions",
              elements: [
                {
                  type: "button",
                  action_id: "open_intern_salary_modal",
                  text: { type: "plain_text", text: "📝 給与情報を提出する" },
                  value: "open",
                },
              ],
            },
          ],
        });
      } catch (error) {
        console.error(`Failed to notify intern ${userId}:`, error);
      }
    }
  }

  // ケース C: 今月末3日前〜月末日に過去6ヶ月分の未払い振込サマリーを通知
  if (daysUntilSubmission >= 0 && daysUntilSubmission <= 3) {
    const pastMonths = getPastMonths(currentMonth, 6);
    const prevMonth = pastMonths[0];

    // 過去6ヶ月の未払い提出を月ごとに収集
    const unpaidByMonth: { month: string; submissions: Awaited<ReturnType<typeof getSubmissionsForMonth>> }[] = [];
    for (const month of pastMonths) {
      const monthSubmissions = await getSubmissionsForMonth(month);
      const unpaid = monthSubmissions.filter((s) => s.status !== "paid");
      if (unpaid.length > 0) {
        unpaidByMonth.push({ month, submissions: unpaid });
      }
    }

    // 未提出者（先月分のみ）
    const knownIds = await getKnownInternIds();
    const submittedIds = await getSubmittedUserIds(prevMonth);
    const unsubmittedIds = knownIds.filter((id) => !submittedIds.includes(id));

    const managerChannelId = process.env.MANAGER_CHANNEL_ID;

    if (managerChannelId && unpaidByMonth.length > 0) {
      const blocks: KnownBlock[] = [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `💰 *振込期限が近づいています（${formatDateJP(lastDayOfMonth)} 残り${daysUntilSubmission}日）*`,
          },
        },
        { type: "divider" },
      ];

      for (const { month, submissions } of unpaidByMonth) {
        blocks.push({
          type: "section",
          text: { type: "mrkdwn", text: `*未払い（${formatMonthJP(month)}分）*` },
        });
        for (const submission of submissions) {
          blocks.push(
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `*${submission.intern_name}*\n請求合計: ¥${submission.total_amount.toLocaleString("ja-JP")}\n内訳: 単価¥${submission.unit_price.toLocaleString("ja-JP")} × ${submission.working_hours}h + 経費¥${submission.total_expense.toLocaleString("ja-JP")}\n振込先: ${maskBankInfo(submission.bank_info)}`,
              },
            },
            {
              type: "actions",
              elements: [
                {
                  type: "button",
                  action_id: "mark_intern_paid",
                  style: "primary",
                  text: { type: "plain_text", text: "✅ 振込完了" },
                  value: submission.id,
                },
              ],
            }
          );
        }
      }

      blocks.push(
        { type: "divider" },
        { type: "section", text: { type: "mrkdwn", text: "*未提出者（先月分）*" } }
      );

      if (unsubmittedIds.length === 0) {
        blocks.push({
          type: "section",
          text: { type: "mrkdwn", text: "未提出者はいません。" },
        });
      } else {
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: unsubmittedIds.map((userId) => `<@${userId}>（未提出）`).join("\n"),
          },
        });
      }

      await slack.chat.postMessage({
        channel: managerChannelId,
        text: "振込期限が近づいています",
        blocks,
      });
    }
  }

  // ケース D: 月末当日にチャンネルへ締め切り案内ボタンを投稿
  if (daysUntilSubmission === 0) {
    await slack.chat.postMessage({
      channel: process.env.INTERN_SALARY_CHANNEL_ID!,
      text: "給与情報の提出は本日締め切りです",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `⏰ *給与情報の提出は本日（${formatDateJP(lastDayOfMonth)}）締め切りです*\nまだ提出されていない方は今すぐ提出してください。`,
          },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              action_id: "open_intern_salary_modal",
              style: "primary",
              text: { type: "plain_text", text: "📝 給与情報を提出する" },
              value: "open",
            },
          ],
        },
      ],
    });
  }

  return NextResponse.json({ ok: true });
}
