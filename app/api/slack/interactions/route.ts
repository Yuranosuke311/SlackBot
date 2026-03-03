import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { slack, verifySlackSignature } from "@/lib/slack";
import { saveReminder, getReminder, completeReminder } from "@/lib/reminders";
import type { Reminder } from "@/types/reminder";

function formatDateJST(dateStr: string): string {
  return new Date(dateStr + "T00:00:00+09:00").toLocaleDateString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-slack-signature") ?? "";
  const timestamp = request.headers.get("x-slack-request-timestamp") ?? "";

  if (!verifySlackSignature(rawBody, signature, timestamp)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }

  const params = new URLSearchParams(rawBody);
  const payload = JSON.parse(params.get("payload") ?? "{}");

  // ケース A・C: ボタンクリック
  if (payload.type === "block_actions") {
    const action = payload.actions?.[0];
    if (!action) return new NextResponse(null, { status: 200 });

    // ケース A: 登録ボタン → モーダルを開く
    if (action.action_id === "open_registration_modal") {
      await slack.views.open({
        trigger_id: payload.trigger_id,
        view: {
          type: "modal",
          callback_id: "invoice_modal",
          title: { type: "plain_text", text: "請求書リマインダー登録" },
          submit: { type: "plain_text", text: "登録する" },
          close: { type: "plain_text", text: "キャンセル" },
          blocks: [
            {
              type: "input",
              block_id: "recipient_block",
              label: { type: "plain_text", text: "送付先" },
              element: {
                type: "plain_text_input",
                action_id: "recipient_input",
                placeholder: { type: "plain_text", text: "例: 株式会社〇〇" },
              },
            },
            {
              type: "input",
              block_id: "due_date_block",
              label: { type: "plain_text", text: "送付期日" },
              element: {
                type: "datepicker",
                action_id: "due_date_input",
              },
            },
          ],
        },
      });
      return new NextResponse(null, { status: 200 });
    }

    // ケース C: 完了ボタン → ステータス更新・メッセージ書き換え
    if (action.action_id === "complete_reminder") {
      const reminderId: string = action.value;
      const reminder = await getReminder(reminderId);

      if (!reminder || reminder.status !== "active") {
        return new NextResponse(null, { status: 200 });
      }

      await completeReminder(reminderId);

      const completedDate = new Date().toLocaleDateString("ja-JP", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "long",
        day: "numeric",
      });

      await slack.chat.update({
        channel: payload.container.channel_id,
        ts: payload.container.message_ts,
        text: "送付完了済み",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `☑️ *送付完了済み*\n\n*送付先*: ${reminder.recipient}\n*期日*: ${formatDateJST(reminder.due_date)}\n*完了日*: ${completedDate}`,
            },
          },
        ],
      });

      return new NextResponse(null, { status: 200 });
    }
  }

  // ケース B: モーダル送信 → リマインダー保存・登録完了 DM 送信
  if (
    payload.type === "view_submission" &&
    payload.view?.callback_id === "invoice_modal"
  ) {
    const values = payload.view.state.values;
    const recipient: string =
      values.recipient_block.recipient_input.value;
    const dueDate: string =
      values.due_date_block.due_date_input.selected_date;
    const userId: string = payload.user.id;

    const reminder: Reminder = {
      id: uuidv4(),
      recipient,
      due_date: dueDate,
      user_id: userId,
      status: "active",
      created_at: new Date().toISOString(),
      completed_at: null,
    };

    await saveReminder(reminder);

    const dmResult = await slack.conversations.open({ users: userId });
    const dmChannelId = dmResult.channel?.id;

    if (dmChannelId) {
      await slack.chat.postMessage({
        channel: dmChannelId,
        text: "リマインダーを登録しました",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `✅ *リマインダーを登録しました*\n\n*送付先*: ${recipient}\n*期日*: ${formatDateJST(dueDate)}\n\n期日の3日前からリマインドします。`,
            },
          },
        ],
      });
    }

    // body が空 = モーダルを閉じる
    return new NextResponse(null, { status: 200 });
  }

  return new NextResponse(null, { status: 200 });
}
