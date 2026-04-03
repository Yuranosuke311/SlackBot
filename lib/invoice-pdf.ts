import React from "react";
import {
  Document,
  Font,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";

Font.register({
  family: "NotoSansJP",
  src: "https://fonts.gstatic.com/ea/notosansjapanese/v6/NotoSansJP-Regular.otf",
});

export type InvoiceData = {
  invoiceNumber: string;
  issueDate: string;
  companyName: string;
  internName: string;
  internAddress: string;
  internPhone: string;
  month: string;
  workingHours: number;
  unitPrice: number;
  totalSalary: number;
  expenseTransport: number;
  expenseTravel: number;
  expenseAi: number;
  totalExpense: number;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  bankInfo: string;
  paymentDue: string;
};

const styles = StyleSheet.create({
  page: { fontFamily: "NotoSansJP", fontSize: 10, padding: 36, lineHeight: 1.5 },
  title: { fontSize: 20, textAlign: "center", marginBottom: 12 },
  section: { marginBottom: 10 },
  divider: { borderBottomWidth: 1, borderBottomColor: "#222", marginVertical: 8 },
  row: { flexDirection: "row", justifyContent: "space-between" },
  bold: { fontWeight: 700 },
});

function yen(amount: number): string {
  return `¥${amount.toLocaleString("ja-JP")}`;
}

function createText(value: string, style?: any) {
  const props = style ? ({ style } as any) : null;
  return React.createElement(Text as any, props, value);
}

function createRow(left: string, right: string, bold = false) {
  return React.createElement(
    View,
    { style: styles.row },
    createText(left, bold ? styles.bold : undefined),
    createText(right, bold ? styles.bold : undefined)
  );
}

function createInvoiceDocument(data: InvoiceData): React.ReactElement {
  return React.createElement(
    Document,
    null,
    React.createElement(
      Page,
      { size: "A4", style: styles.page },
      createText("請 求 書", styles.title),

      React.createElement(
        View,
        { style: styles.section },
        createText(`発行日: ${data.issueDate}`),
        createText(`請求書番号: ${data.invoiceNumber}`)
      ),

      React.createElement(
        View,
        { style: styles.section },
        createText("請求先:"),
        createText(`${data.companyName} 御中`)
      ),

      React.createElement(
        View,
        { style: styles.section },
        createText("請求者:"),
        createText(data.internName),
        createText(data.internAddress),
        createText(data.internPhone)
      ),

      React.createElement(View, { style: styles.divider }),

      React.createElement(View, { style: styles.section }, createText(`件名: ${data.month}分 業務委託費`)),

      React.createElement(
        View,
        { style: styles.section },
        createRow("稼働時間", `${data.workingHours}時間`),
        createRow("単価", `${yen(data.unitPrice)} / 時`),
        createRow("給与小計", yen(data.totalSalary))
      ),

      React.createElement(
        View,
        { style: styles.section },
        createText("経費内訳:"),
        createRow("移動費", yen(data.expenseTransport)),
        createRow("交通費", yen(data.expenseTravel)),
        createRow("AI利用費", yen(data.expenseAi)),
        createRow("経費合計", yen(data.totalExpense))
      ),

      React.createElement(View, { style: styles.divider }),

      React.createElement(
        View,
        { style: styles.section },
        createRow("税抜合計", yen(data.subtotal)),
        createRow("消費税（10%）", yen(data.taxAmount)),
        createRow("税込請求合計", yen(data.totalAmount), true)
      ),

      React.createElement(View, { style: styles.divider }),

      React.createElement(
        View,
        { style: styles.section },
        createText("お振込先:"),
        createText(data.bankInfo),
        createText(`振込期限: ${data.paymentDue}`)
      )
    )
  );
}

export async function generateInvoicePdf(data: InvoiceData): Promise<Buffer> {
  return renderToBuffer(createInvoiceDocument(data));
}
