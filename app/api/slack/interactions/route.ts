import { NextRequest, NextResponse, after } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { slack, verifySlackSignature } from "@/lib/slack";
import { saveReminder, getReminder, completeReminder } from "@/lib/reminders";
import { getInternProfile, saveInternProfile } from "@/lib/intern-profiles";
import { saveSubmission, getSubmission, markAsPaid } from "@/lib/intern-salaries";
import { generateInvoicePdf, type InvoiceData } from "@/lib/invoice-pdf";
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

function getLastDayOfMonthAfter(month: string): string {
  const [yearStr, monthStr] = month.split("-");
  // day 0 of month+2 = last day of month+1
  const lastDay = new Date(Number(yearStr), Number(monthStr) + 1, 0);
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

function getMonthOptions() {
  const now = new Date();
  const jst = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
  const options = [];
  for (let i = 0; i < 3; i++) {
    const d = new Date(jst.getFullYear(), jst.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const value = `${y}-${m}`;
    options.push({
      text: { type: "plain_text" as const, text: formatMonthJP(value) },
      value,
    });
  }
  return options;
}

function buildInternSalaryModal(
  month: string,
  salaryType: "hourly" | "fixed",
  initialValues: {
    name: string;
    address: string;
    phone: string;
    salaryTaxType: "exclusive" | "inclusive";
    unitPrice: string;
    workingHours: string;
    fixedAmount: string;
    expense1Name: string;
    expense1Amount: string;
    expense2Name: string;
    expense2Amount: string;
    expense3Name: string;
    expense3Amount: string;
    bankInfo: string;
  }
) {
  const salaryOption = (value: "hourly" | "fixed", label: string) => ({
    text: { type: "plain_text" as const, text: label },
    value,
  });

  const salaryBlocks =
    salaryType === "fixed"
      ? [
          {
            type: "input" as const,
            block_id: "fixed_amount_block",
            label: { type: "plain_text" as const, text: "月額固定報酬（円）" },
            element: {
              type: "plain_text_input" as const,
              action_id: "fixed_amount_input",
              initial_value: initialValues.fixedAmount,
              placeholder: { type: "plain_text" as const, text: "例: 100000" },
            },
          },
        ]
      : [
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
        ];

  return {
    type: "modal" as const,
    callback_id: "intern_salary_modal",
    private_metadata: JSON.stringify({
      savedUnitPrice: initialValues.unitPrice,
      savedWorkingHours: initialValues.workingHours,
      savedFixedAmount: initialValues.fixedAmount,
    }),
    title: { type: "plain_text" as const, text: "インターン給与提出" },
    submit: { type: "plain_text" as const, text: "内容を確認する" },
    close: { type: "plain_text" as const, text: "キャンセル" },
    blocks: [
      {
        type: "input" as const,
        block_id: "month_block",
        label: { type: "plain_text" as const, text: "対象月" },
        element: {
          type: "static_select" as const,
          action_id: "month_select",
          initial_option: {
            text: { type: "plain_text" as const, text: formatMonthJP(month) },
            value: month,
          },
          options: getMonthOptions(),
        },
      },
      {
        type: "input" as const,
        block_id: "salary_type_block",
        dispatch_action: true,
        label: { type: "plain_text" as const, text: "報酬タイプ" },
        element: {
          type: "radio_buttons" as const,
          action_id: "salary_type_select",
          initial_option: salaryOption(salaryType, salaryType === "fixed" ? "固定給" : "時給制"),
          options: [
            salaryOption("hourly", "時給制"),
            salaryOption("fixed", "固定給"),
          ],
        },
      },
      {
        type: "input" as const,
        block_id: "salary_tax_type_block",
        label: { type: "plain_text" as const, text: "報酬の税区分" },
        element: {
          type: "radio_buttons" as const,
          action_id: "salary_tax_type_select",
          initial_option: {
            text: {
              type: "plain_text" as const,
              text: initialValues.salaryTaxType === "inclusive"
                ? "税込み（消費税を含む金額）"
                : "税抜き（消費税10%を別途加算）",
            },
            value: initialValues.salaryTaxType,
          },
          options: [
            { text: { type: "plain_text" as const, text: "税抜き（消費税10%を別途加算）" }, value: "exclusive" },
            { text: { type: "plain_text" as const, text: "税込み（消費税を含む金額）" }, value: "inclusive" },
          ],
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
      ...salaryBlocks,
      {
        type: "section" as const,
        text: {
          type: "mrkdwn" as const,
          text: "*経費内訳*（該当するもののみ入力・金額は税込みで記入）",
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
            ...(draft.salary_tax_type === "inclusive"
              ? draft.salary_type === "fixed"
                ? [`*月額固定報酬（税込）*: ${formatCurrency(draft.total_salary)}`]
                : [
                    `*単価（税込）*: ${formatCurrency(draft.unit_price)}/時`,
                    `*稼働時間*: ${draft.working_hours}時間`,
                    `*給与小計（税込）*: ${formatCurrency(draft.total_salary)}`,
                  ]
              : draft.salary_type === "fixed"
                ? [`*月額固定報酬（税抜）*: ${formatCurrency(draft.total_salary)}`]
                : [
                    `*単価（税抜）*: ${formatCurrency(draft.unit_price)}/時`,
                    `*稼働時間*: ${draft.working_hours}時間`,
                    `*給与小計（税抜）*: ${formatCurrency(draft.total_salary)}`,
                  ]
            ),
            "",
            "*経費内訳*: ",
            expenseLines,
            `*経費合計（税込）*: ${formatCurrency(draft.total_expense)}`,
            "──────────────",
            ...(draft.salary_tax_type === "exclusive"
              ? [
                  `*消費税（10%）*: ${formatCurrency(draft.tax_amount)}`,
                  `*税込請求合計*: ${formatCurrency(draft.total_amount)}`,
                ]
              : [`*請求合計*: ${formatCurrency(draft.total_amount)}`]
            ),
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
  const companyName = process.env.COMPANY_NAME;
  if (!companyName) throw new Error("COMPANY_NAME is not set");

  return {
    invoiceNumber: submission.invoice_number,
    issueDate: formatTodayJP(),
    companyName,
    internName: submission.intern_name,
    internAddress: submission.intern_address,
    internPhone: phone,
    month: formatMonthJP(submission.month),
    salaryType: submission.salary_type ?? "hourly",
    salaryTaxType: submission.salary_tax_type ?? "exclusive",
    workingHours: submission.working_hours,
    unitPrice: submission.unit_price,
    totalSalary: submission.total_salary,
    expenses: submission.expenses,
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
  console.log("[invoice] saveSubmission OK");

  const profile: InternProfile = {
    slack_user_id: userId,
    name: draft.intern_name,
    address: draft.intern_address,
    phone: draft.phone,
    bank_info: draft.bank_info,
    salary_type: draft.salary_type,
    salary_tax_type: draft.salary_tax_type,
    unit_price: draft.unit_price,
    fixed_amount: draft.salary_type === "fixed" ? draft.total_salary : undefined,
    expense_names: buildEmptyExpenseNames(draft.expenses),
    updated_at: submittedAt,
  };
  await saveInternProfile(profile);
  console.log("[invoice] saveInternProfile OK");

  const invoiceData = buildInvoiceData(submission, draft.phone);
  console.log("[invoice] buildInvoiceData OK");
  const pdfBuffer = await generateInvoicePdf(invoiceData);
  console.log("[invoice] generateInvoicePdf OK, size:", pdfBuffer.length);
  const fileName = getInvoiceFileName(submission.month, submission.intern_name);

  const sharedChannelId = process.env.MANAGER_CHANNEL_ID;
  const internDm = await slack.conversations.open({ users: userId });
  const internDmChannelId = internDm.channel?.id;

  const tasks: Promise<unknown>[] = [];

  if (internDmChannelId) {
    tasks.push(
      slack.filesUploadV2({
        channel_id: internDmChannelId,
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

  if (sharedChannelId) {
    tasks.push(
      slack.filesUploadV2({
        channel_id: sharedChannelId,
        filename: fileName,
        file: pdfBuffer,
        initial_comment: [
          `📩 ${submission.intern_name}さんが${formatMonthJP(submission.month)}分の給与情報を提出しました`,
          "",
          `提出日時: ${formatDateTimeJST(new Date())}`,
          `請求書番号: ${submission.invoice_number}`,
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

  console.log("[invoice] tasks count:", tasks.length);
  const results = await Promise.allSettled(tasks);
  results.forEach((result, i) => {
    if (result.status === "rejected") {
      console.error(`task[${i}] failed:`, result.reason);
    } else {
      console.log(`task[${i}] succeeded`);
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

    if (action.action_id === "salary_type_select") {
      const newSalaryType: "hourly" | "fixed" =
        action.selected_option?.value === "fixed" ? "fixed" : "hourly";
      const currentValues = payload.view.state.values;
      const metadata = JSON.parse(payload.view.private_metadata || "{}") as {
        month?: string;
        savedUnitPrice?: string;
        savedWorkingHours?: string;
        savedFixedAmount?: string;
      };
      const month =
        currentValues.month_block?.month_select?.selected_option?.value ??
        metadata.month ??
        getCurrentMonthJST();

      const currentTaxType: "exclusive" | "inclusive" =
        currentValues.salary_tax_type_block?.salary_tax_type_select?.selected_option?.value === "inclusive"
          ? "inclusive"
          : "exclusive";

      await slack.views.update({
        view_id: payload.view.id,
        hash: payload.view.hash,
        view: buildInternSalaryModal(month, newSalaryType, {
          salaryTaxType: currentTaxType,
          name: currentValues.name_block?.name_input?.value ?? "",
          address: currentValues.address_block?.address_input?.value ?? "",
          phone: currentValues.phone_block?.phone_input?.value ?? "",
          unitPrice:
            currentValues.unit_price_block?.unit_price_input?.value ??
            metadata.savedUnitPrice ??
            "",
          workingHours:
            currentValues.working_hours_block?.working_hours_input?.value ??
            metadata.savedWorkingHours ??
            "",
          fixedAmount:
            currentValues.fixed_amount_block?.fixed_amount_input?.value ??
            metadata.savedFixedAmount ??
            "",
          expense1Name:
            currentValues.expense_1_name_block?.expense_1_name_input?.value ?? "",
          expense1Amount:
            currentValues.expense_1_amount_block?.expense_1_amount_input?.value ?? "",
          expense2Name:
            currentValues.expense_2_name_block?.expense_2_name_input?.value ?? "",
          expense2Amount:
            currentValues.expense_2_amount_block?.expense_2_amount_input?.value ?? "",
          expense3Name:
            currentValues.expense_3_name_block?.expense_3_name_input?.value ?? "",
          expense3Amount:
            currentValues.expense_3_amount_block?.expense_3_amount_input?.value ?? "",
          bankInfo: currentValues.bank_info_block?.bank_info_input?.value ?? "",
        }),
      });
      return new NextResponse(null, { status: 200 });
    }

    if (action.action_id === "open_intern_salary_modal") {
      const userId: string = payload.user.id;
      const profile = await getInternProfile(userId);
      const currentMonth = getCurrentMonthJST();

      const salaryType: "hourly" | "fixed" = profile?.salary_type ?? "hourly";
      const salaryTaxType: "exclusive" | "inclusive" = profile?.salary_tax_type ?? "exclusive";
      await slack.views.open({
        trigger_id: payload.trigger_id,
        view: buildInternSalaryModal(currentMonth, salaryType, {
          salaryTaxType,
          name: profile?.name ?? "",
          address: profile?.address ?? "",
          phone: profile?.phone ?? "",
          unitPrice: salaryType === "hourly" ? (profile?.unit_price?.toString() ?? "") : "",
          workingHours: "",
          fixedAmount: salaryType === "fixed" ? (profile?.fixed_amount?.toString() ?? "") : "",
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

    const salaryType: "hourly" | "fixed" =
      values.salary_type_block?.salary_type_select?.selected_option?.value === "fixed"
        ? "fixed"
        : "hourly";

    const name: string = values.name_block.name_input.value.trim();
    const address: string = values.address_block.address_input.value.trim();
    const phone: string = values.phone_block.phone_input.value.trim();
    const unitPriceRaw: string =
      values.unit_price_block?.unit_price_input?.value?.trim() ?? "";
    const workingHoursRaw: string =
      values.working_hours_block?.working_hours_input?.value?.trim() ?? "";
    const fixedAmountRaw: string =
      values.fixed_amount_block?.fixed_amount_input?.value?.trim() ?? "";
    const bankInfo: string = values.bank_info_block.bank_info_input.value.trim();

    const errors: Record<string, string> = {};

    if (!name) errors.name_block = "氏名を入力してください。";
    if (!address) errors.address_block = "住所を入力してください。";
    if (!phone) errors.phone_block = "電話番号を入力してください。";
    if (!bankInfo) errors.bank_info_block = "振込口座を入力してください。";

    if (salaryType === "fixed") {
      if (!/^\d+$/.test(fixedAmountRaw) || Number(fixedAmountRaw) <= 0) {
        errors.fixed_amount_block = "月額固定報酬は正の整数で入力してください。";
      }
    } else {
      if (!/^\d+$/.test(unitPriceRaw) || Number(unitPriceRaw) <= 0) {
        errors.unit_price_block = "単価は正の整数で入力してください。";
      }
      if (!/^\d+(\.\d+)?$/.test(workingHoursRaw) || Number(workingHoursRaw) <= 0) {
        errors.working_hours_block = "稼働時間は正の数値で入力してください。";
      }
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

    const month: string =
      values.month_block?.month_select?.selected_option?.value ?? getCurrentMonthJST();

    let unitPrice = 0;
    let workingHours = 0;
    let totalSalary = 0;
    if (salaryType === "fixed") {
      totalSalary = Number(fixedAmountRaw);
    } else {
      unitPrice = Number(unitPriceRaw);
      workingHours = Number(workingHoursRaw);
      totalSalary = Math.floor(unitPrice * workingHours);
    }
    const salaryTaxType: "exclusive" | "inclusive" =
      values.salary_tax_type_block?.salary_tax_type_select?.selected_option?.value === "inclusive"
        ? "inclusive"
        : "exclusive";

    const totalExpense = expenses.reduce((sum, e) => sum + e.amount, 0);
    const subtotal = totalSalary;
    const taxAmount = salaryTaxType === "exclusive" ? Math.round(totalSalary * 0.1) : 0;
    const totalAmount = totalSalary + taxAmount + totalExpense;

    const draft: InternSalaryDraft = {
      intern_id: userId,
      intern_name: name,
      intern_address: address,
      phone,
      month,
      salary_type: salaryType,
      salary_tax_type: salaryTaxType,
      unit_price: unitPrice,
      working_hours: workingHours,
      expenses,
      total_salary: totalSalary,
      total_expense: totalExpense,
      subtotal,
      tax_amount: taxAmount,
      total_amount: totalAmount,
      bank_info: bankInfo,
      payment_due: getLastDayOfMonthAfter(month),
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

    after(
      processConfirmedSubmission(draft, userId).catch((error) => {
        console.error("failed to process confirmed intern salary:", error);
      })
    );

    return NextResponse.json({ response_action: "clear" }, { status: 200 });
  }

  return new NextResponse(null, { status: 200 });
}
