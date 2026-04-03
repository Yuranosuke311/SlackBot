import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { slack, verifySlackSignature } from "@/lib/slack";
import { saveReminder, getReminder, completeReminder } from "@/lib/reminders";
import { getInternProfile, saveInternProfile } from "@/lib/intern-profiles";
import { saveSubmission, getSubmission, markAsPaid } from "@/lib/intern-salaries";
import { generateInvoicePdf, type InvoiceData } from "@/lib/invoice-pdf-renderer";
import { uploadToDrive } from "@/lib/google-drive";
import type { Reminder } from "@/types/reminder";
import type {
  ExpenseItem,
  InternProfile,
  InternSalaryDraft,
  InternSalarySubmission,
} from "@/types/intern-salary";

function formatDateJST(dateStr: string): string {
  return new Date(dateStr + "T00:00:00+09:00").toLocaleDateString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
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

function getLastDayOfNextMonth(): string {
  const now = new Date();
  const jst = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
  const lastDay = new Date(jst.getFullYear(), jst.getMonth() + 2, 0);

  const y = lastDay.getFullYear();
  const m = String(lastDay.getMonth() + 1).padStart(2, "0");
  const d = String(lastDay.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatMonthJP(month: string): string {
  const [year, monthNum] = month.split("-");
  return `${year}年${monthNum}月`;
}

function formatCurrency(amount: number): string {
  return `¥${amount.toLocaleString("ja-JP")}`;
}

function formatDateJP(dateStr: string): string {
  const [year, month, day] = dateStr.split("-");
  return `${year}年${month}月${day}日`;
}

function formatDateTimeJST(date: Date): string {
  return date.toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatTodayJP(): string {
  const formatted = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [y, m, d] = formatted.split("/");
  return `${y}年${m}月${d}日`;
}

function getInvoiceFileName(month: string, internName: string): string {
  return `invoice_${month.replace("-", "")}_${internName}.pdf`;
}

function getInvoiceNumber(month: string, userId: string): string {
  const [year, monthNum] = month.split("-");
  return `INV-${year}-${monthNum}-${userId}`;
}

function buildEmptyExpenseNames(expenses: ExpenseItem[]): string[] {
  const names = expenses.slice(0, 3).map((e) => e.name);
  while (names.length < 3) names.push("");
  return names;
}

function buildInternSalaryModal(
  month: string,
  initialValues: {
    name: string;
    address: string;
    phone: string;
    unitPrice: string;
    workingHours: string;
    expense1Name: string;
    expense1Amount: string;
    expense2Name: string;
    expense2Amount: string;
    expense3Name: string;
    expense3Amount: string;
    bankInfo: string;
  }
) {
  return {
    type: "modal" as const,
    callback_id: "intern_salary_modal",
    private_metadata: JSON.stringify({ month }),
    title: { type: "plain_text" as const, text: "インターン給与提出" },
    submit: { type: "plain_text" as const, text: "内容を確認する" },
    close: { type: "plain_text" as const, text: "キャンセル" },
    blocks: [
      {
        type: "section" as const,
        text: {
          type: "mrkdwn" as const,
          text: `*対象月*: ${formatMonthJP(month)}`,
        },
      },
      {
        type: "input" as const,
        block_id: "name_block",
        label: { type: "plain_text" as const, text: "氏名" },
        element: {
          type: "plain_text_input" as const,
          action_id: "name_input",
          initial_value: initialValues.name,
        },
      },
      {
        type: "input" as const,
        block_id: "address_block",
        label: { type: "plain_text" as const, text: "住所" },
        element: {
          type: "plain_text_input" as const,
          action_id: "address_input",
          initial_value: initialValues.address,
          placeholder: {
            type: "plain_text" as const,
            text: "例: 東京都〇〇区〇〇 1-2-3",
          },
        },
      },
      {
        type: "input" as const,
        block_id: "phone_block",
        label: { type: "plain_text" as const, text: "電話番号" },
        element: {
          type: "plain_text_input" as const,
          action_id: "phone_input",
          initial_value: initialValues.phone,
        },
      },
      {
        type: "input" as const,
        block_id: "unit_price_block",
        label: { type: "plain_text" as const, text: "単価（円/時）" },
        element: {
          type: "plain_text_input" as const,
          action_id: "unit_price_input",
          initial_value: initialValues.unitPrice,
        },
      },
      {
        type: "input" as const,
        block_id: "working_hours_block",
        label: { type: "plain_text" as const, text: "稼働時間" },
        element: {
          type: "plain_text_input" as const,
          action_id: "working_hours_input",
          initial_value: initialValues.workingHours,
          placeholder: { type: "plain_text" as const, text: "例: 40.5" },
        },
      },
      {
        type: "section" as const,
        text: {
          type: "mrkdwn" as const,
          text: "*経費内訳*（該当するもののみ入力）",
        },
      },
      {
        type: "input" as const,
        block_id: "expense_1_name_block",
        optional: true,
        label: { type: "plain_text" as const, text: "経費1 費目名" },
        element: {
          type: "plain_text_input" as const,
          action_id: "expense_1_name_input",
          initial_value: initialValues.expense1Name,
          placeholder: { type: "plain_text" as const, text: "例: 移動費" },
        },
      },
      {
        type: "input" as const,
        block_id: "expense_1_amount_block",
        optional: true,
        label: { type: "plain_text" as const, text: "経費1 金額（円）" },
        element: {
          type: "plain_text_input" as const,
          action_id: "expense_1_amount_input",
          initial_value: initialValues.expense1Amount,
          placeholder: { type: "plain_text" as const, text: "例: 2000" },
        },
      },
      {
        type: "input" as const,
        block_id: "expense_2_name_block",
        optional: true,
        label: { type: "plain_text" as const, text: "経費2 費目名" },
        element: {
          type: "plain_text_input" as const,
          action_id: "expense_2_name_input",
          initial_value: initialValues.expense2Name,
          placeholder: { type: "plain_text" as const, text: "例: 交通費" },
        },
      },
      {
        type: "input" as const,
        block_id: "expense_2_amount_block",
        optional: true,
        label: { type: "plain_text" as const, text: "経費2 金額（円）" },
        element: {
          type: "plain_text_input" as const,
          action_id: "expense_2_amount_input",
          initial_value: initialValues.expense2Amount,
          placeholder: { type: "plain_text" as const, text: "例: 3000" },
        },
      },
      {
        type: "input" as const,
        block_id: "expense_3_name_block",
        optional: true,
        label: { type: "plain_text" as const, text: "経費3 費目名" },
        element: {
          type: "plain_text_input" as const,
          action_id: "expense_3_name_input",
          initial_value: initialValues.expense3Name,
          placeholder: { type: "plain_text" as const, text: "例: AI利用費" },
        },
      },
      {
        type: "input" as const,
        block_id: "expense_3_amount_block",
        optional: true,
        label: { type: "plain_text" as const, text: "経費3 金額（円）" },
        element: {
          type: "plain_text_input" as const,
          action_id: "expense_3_amount_input",
          initial_value: initialValues.expense3Amount,
          placeholder: { type: "plain_text" as const, text: "例: 500" },
        },
      },
      {
        type: "input" as const,
        block_id: "bank_info_block",
        label: { type: "plain_text" as const, text: "振込口座" },
        element: {
          type: "plain_text_input" as const,
          action_id: "bank_info_input",
          initial_value: initialValues.bankInfo,
          placeholder: {
            type: "plain_text" as const,
            text: "例: 〇〇銀行 〇〇支店 普通 1234567",
          },
        },
      },
    ],
  };
}

function buildConfirmModal(draft: InternSalaryDraft) {
  const expenseLines = draft.expenses.length
    ? draft.expenses
        .map((e) => `　${e.name}: ${formatCurrency(e.amount)}`)
        .join("\n")
    : "　なし";

  return {
    type: "modal" as const,
    callback_id: "intern_salary_confirm_modal",
    private_metadata: JSON.stringify(draft),
    title: { type: "plain_text" as const, text: "内容の確認" },
    submit: { type: "plain_text" as const, text: "✅ 確定して送信" },
    close: { type: "plain_text" as const, text: "← 修正する" },
    blocks: [
      {
        type: "section" as const,
        text: {
          type: "mrkdwn" as const,
          text: [
            `*氏名*: ${draft.intern_name}`,
            `*住所*: ${draft.intern_address}`,
            `*電話番号*: ${draft.phone}`,
            `*対象月*: ${formatMonthJP(draft.month)}`,
            "",
            `*単価*: ${formatCurrency(draft.unit_price)}/時`,
            `*稼働時間*: ${draft.working_hours}時間`,
            `*給与小計*: ${formatCurrency(draft.total_salary)}`,
            "",
            "*経費内訳*: ",
            expenseLines,
            `*経費合計*: ${formatCurrency(draft.total_expense)}`,
            "──────────────",
            `*税抜合計*: ${formatCurrency(draft.subtotal)}`,
            `*消費税（10%）*: ${formatCurrency(draft.tax_amount)}`,
            `*税込請求合計*: ${formatCurrency(draft.total_amount)}`,
            "",
            `*振込口座*: ${draft.bank_info}`,
            `*振込期限*: ${formatDateJP(draft.payment_due)}`,
          ].join("\n"),
        },
      },
    ],
  };
}

function parseExpense(
  name: string,
  amountRaw: string,
  nameBlockId: string,
  amountBlockId: string,
  errors: Record<string, string>
): ExpenseItem | null {
  const trimmedName = name.trim();
  const trimmedAmount = amountRaw.trim();

  if (!trimmedName && !trimmedAmount) return null;

  if (trimmedName && !trimmedAmount) {
    errors[amountBlockId] = "費目名を入力した場合は金額を入力してください。";
    return null;
  }

  if (!trimmedName && trimmedAmount) {
    errors[nameBlockId] = "金額を入力した場合は費目名を入力してください。";
    return null;
  }

  if (!/^\d+$/.test(trimmedAmount) || Number(trimmedAmount) < 0) {
    errors[amountBlockId] = "金額は0以上の整数で入力してください。";
    return null;
  }

  return {
    name: trimmedName,
    amount: Number(trimmedAmount),
  };
}

function buildInvoiceData(
  submission: InternSalarySubmission,
  phone: string
): InvoiceData {
  const expenseByName = new Map(submission.expenses.map((e) => [e.name, e.amount]));

  return {
    invoiceNumber: submission.invoice_number,
    issueDate: formatTodayJP(),
    companyName: process.env.COMPANY_NAME ?? "株式会社AilaB",
    internName: submission.intern_name,
    internAddress: submission.intern_address,
    internPhone: phone,
    month: formatMonthJP(submission.month),
    workingHours: submission.working_hours,
    unitPrice: submission.unit_price,
    totalSalary: submission.total_salary,
    expenseTransport: expenseByName.get("移動費") ?? 0,
    expenseTravel: expenseByName.get("交通費") ?? 0,
    expenseAi: expenseByName.get("AI利用費") ?? 0,
    totalExpense: submission.total_expense,
    subtotal: submission.subtotal,
    taxAmount: submission.tax_amount,
    totalAmount: submission.total_amount,
    bankInfo: submission.bank_info,
    paymentDue: formatDateJP(submission.payment_due),
  };
}

async function processConfirmedSubmission(draft: InternSalaryDraft, userId: string) {
  const submittedAt = new Date().toISOString();

  const submission: InternSalarySubmission = {
    ...draft,
    id: uuidv4(),
    status: "submitted",
    submitted_at: submittedAt,
    paid_at: null,
  };

  await saveSubmission(submission);

  const profile: InternProfile = {
    slack_user_id: userId,
    name: draft.intern_name,
    address: draft.intern_address,
    phone: draft.phone,
    bank_info: draft.bank_info,
    unit_price: draft.unit_price,
    expense_names: buildEmptyExpenseNames(draft.expenses),
    updated_at: submittedAt,
  };
  await saveInternProfile(profile);

  const invoiceData = buildInvoiceData(submission, draft.phone);
  const pdfBuffer = await generateInvoicePdf(invoiceData);
  const fileName = getInvoiceFileName(submission.month, submission.intern_name);

  const dmResult = await slack.conversations.open({ users: userId });
  const dmChannelId = dmResult.channel?.id;

  const tasks: Promise<unknown>[] = [];

  if (dmChannelId) {
    tasks.push(
      slack.filesUploadV2({
        channel_id: dmChannelId,
        filename: fileName,
        file: pdfBuffer,
        initial_comment: [
          `✅ 給与情報を提出しました（${formatMonthJP(submission.month)}分）`,
          "",
          `提出日時: ${formatDateTimeJST(new Date())}`,
          `請求書番号: ${submission.invoice_number}`,
        ].join("\n"),
      })
    );
  }

  if (process.env.INTERN_SALARY_CHANNEL_ID) {
    tasks.push(
      slack.filesUploadV2({
        channel_id: process.env.INTERN_SALARY_CHANNEL_ID,
        filename: fileName,
        file: pdfBuffer,
        initial_comment: [
          `📩 ${submission.intern_name}さんが給与情報を提出しました`,
          "",
          `対象月: ${formatMonthJP(submission.month)}`,
          `税込請求合計: ${formatCurrency(submission.total_amount)}`,
          `振込先: ${submission.bank_info}`,
          `振込期限: ${formatDateJP(submission.payment_due)}`,
        ].join("\n"),
      })
    );
  }

  if (process.env.GOOGLE_DRIVE_FOLDER_ID) {
    tasks.push(uploadToDrive(pdfBuffer, fileName, process.env.GOOGLE_DRIVE_FOLDER_ID));
  }

  const results = await Promise.allSettled(tasks);
  results.forEach((result, i) => {
    if (result.status === "rejected") {
      console.error(`task[${i}] failed:`, result.reason);
    }
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

  if (payload.type === "block_actions") {
    const action = payload.actions?.[0];
    if (!action) return new NextResponse(null, { status: 200 });

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

    if (action.action_id === "open_intern_salary_modal") {
      const userId: string = payload.user.id;
      const profile = await getInternProfile(userId);
      const currentMonth = getCurrentMonthJST();

      await slack.views.open({
        trigger_id: payload.trigger_id,
        view: buildInternSalaryModal(currentMonth, {
          name: profile?.name ?? "",
          address: profile?.address ?? "",
          phone: profile?.phone ?? "",
          unitPrice: profile?.unit_price?.toString() ?? "",
          workingHours: "",
          expense1Name: profile?.expense_names?.[0] ?? "",
          expense1Amount: "",
          expense2Name: profile?.expense_names?.[1] ?? "",
          expense2Amount: "",
          expense3Name: profile?.expense_names?.[2] ?? "",
          expense3Amount: "",
          bankInfo: profile?.bank_info ?? "",
        }),
      });

      return new NextResponse(null, { status: 200 });
    }

    if (action.action_id === "mark_intern_paid") {
      const submissionId: string = action.value;
      const submission = await getSubmission(submissionId);
      if (!submission || submission.status === "paid") {
        return new NextResponse(null, { status: 200 });
      }

      await markAsPaid(submissionId);

      await slack.chat.update({
        channel: payload.container.channel_id,
        ts: payload.container.message_ts,
        text: "☑️ 振込完了済み",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `☑️ 振込完了済み\n\n氏名: ${submission.intern_name} / ${formatMonthJP(submission.month)}分\n税込金額: ${formatCurrency(submission.total_amount)}\n完了日: ${new Date().toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" })}`,
            },
          },
        ],
      });

      return new NextResponse(null, { status: 200 });
    }
  }

  if (
    payload.type === "view_submission" &&
    payload.view?.callback_id === "invoice_modal"
  ) {
    const values = payload.view.state.values;
    const recipient: string = values.recipient_block.recipient_input.value;
    const dueDate: string = values.due_date_block.due_date_input.selected_date;
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

    return new NextResponse(null, { status: 200 });
  }

  if (
    payload.type === "view_submission" &&
    payload.view?.callback_id === "intern_salary_modal"
  ) {
    const values = payload.view.state.values;
    const userId: string = payload.user.id;

    const name: string = values.name_block.name_input.value.trim();
    const address: string = values.address_block.address_input.value.trim();
    const phone: string = values.phone_block.phone_input.value.trim();
    const unitPriceRaw: string = values.unit_price_block.unit_price_input.value.trim();
    const workingHoursRaw: string = values.working_hours_block.working_hours_input.value.trim();
    const bankInfo: string = values.bank_info_block.bank_info_input.value.trim();

    const errors: Record<string, string> = {};

    if (!name) errors.name_block = "氏名を入力してください。";
    if (!address) errors.address_block = "住所を入力してください。";
    if (!phone) errors.phone_block = "電話番号を入力してください。";
    if (!bankInfo) errors.bank_info_block = "振込口座を入力してください。";

    if (!/^\d+$/.test(unitPriceRaw) || Number(unitPriceRaw) <= 0) {
      errors.unit_price_block = "単価は正の整数で入力してください。";
    }

    if (!/^\d+(\.\d+)?$/.test(workingHoursRaw) || Number(workingHoursRaw) <= 0) {
      errors.working_hours_block = "稼働時間は正の数値で入力してください。";
    }

    const expenses = [
      parseExpense(
        values.expense_1_name_block?.expense_1_name_input?.value ?? "",
        values.expense_1_amount_block?.expense_1_amount_input?.value ?? "",
        "expense_1_name_block",
        "expense_1_amount_block",
        errors
      ),
      parseExpense(
        values.expense_2_name_block?.expense_2_name_input?.value ?? "",
        values.expense_2_amount_block?.expense_2_amount_input?.value ?? "",
        "expense_2_name_block",
        "expense_2_amount_block",
        errors
      ),
      parseExpense(
        values.expense_3_name_block?.expense_3_name_input?.value ?? "",
        values.expense_3_amount_block?.expense_3_amount_input?.value ?? "",
        "expense_3_name_block",
        "expense_3_amount_block",
        errors
      ),
    ].filter((x): x is ExpenseItem => x !== null);

    if (Object.keys(errors).length > 0) {
      return NextResponse.json({ response_action: "errors", errors }, { status: 200 });
    }

    let month = getCurrentMonthJST();
    if (payload.view.private_metadata) {
      try {
        const metadata = JSON.parse(payload.view.private_metadata) as { month?: string };
        if (metadata.month) month = metadata.month;
      } catch {
        month = getCurrentMonthJST();
      }
    }

    const unitPrice = Number(unitPriceRaw);
    const workingHours = Number(workingHoursRaw);
    const totalSalary = Math.floor(unitPrice * workingHours);
    const totalExpense = expenses.reduce((sum, e) => sum + e.amount, 0);
    const subtotal = totalSalary + totalExpense;
    const taxAmount = Math.round(subtotal * 0.1);
    const totalAmount = subtotal + taxAmount;

    const draft: InternSalaryDraft = {
      intern_id: userId,
      intern_name: name,
      intern_address: address,
      phone,
      month,
      unit_price: unitPrice,
      working_hours: workingHours,
      expenses,
      total_salary: totalSalary,
      total_expense: totalExpense,
      subtotal,
      tax_amount: taxAmount,
      total_amount: totalAmount,
      bank_info: bankInfo,
      payment_due: getLastDayOfNextMonth(),
      invoice_number: getInvoiceNumber(month, userId),
    };

    return NextResponse.json(
      {
        response_action: "push",
        view: buildConfirmModal(draft),
      },
      { status: 200 }
    );
  }

  if (
    payload.type === "view_submission" &&
    payload.view?.callback_id === "intern_salary_confirm_modal"
  ) {
    const userId: string = payload.user.id;
    let draft: InternSalaryDraft | null = null;

    try {
      draft = JSON.parse(payload.view.private_metadata) as InternSalaryDraft;
    } catch {
      return new NextResponse(null, { status: 200 });
    }
    if (!draft || draft.intern_id !== userId) {
      return new NextResponse(null, { status: 200 });
    }

    void processConfirmedSubmission(draft, userId).catch((error) => {
      console.error("failed to process confirmed intern salary:", error);
    });

    return new NextResponse(null, { status: 200 });
  }

  return new NextResponse(null, { status: 200 });
}
