import { createElement, type ReactElement } from "react";
import type { DocumentProps } from "@react-pdf/renderer";
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

function makeRow(left: string, right: string) {
  return createElement(
    View,
    { style: styles.row },
    createElement(Text, null, left),
    createElement(Text, null, right),
  );
}

function InvoiceDocument({ data }: { data: InvoiceData }) {
  return createElement(
    Document,
    null,
    createElement(
      Page,
      { size: "A4", style: styles.page },
      createElement(Text, { style: styles.title }, "請 求 書"),

      createElement(
        View,
        { style: styles.section },
        createElement(Text, null, `発行日: ${data.issueDate}`),
        createElement(Text, null, `請求書番号: ${data.invoiceNumber}`),
      ),

      createElement(
        View,
        { style: styles.section },
        createElement(Text, null, "請求先:"),
        createElement(Text, null, `${data.companyName} 御中`),
      ),

      createElement(
        View,
        { style: styles.section },
        createElement(Text, null, "請求者:"),
        createElement(Text, null, String(data.internName)),
        createElement(Text, null, String(data.internAddress)),
        createElement(Text, null, String(data.internPhone)),
      ),

      createElement(View, { style: styles.divider }),

      createElement(
        View,
        { style: styles.section },
        createElement(Text, null, `件名: ${data.month}分 業務委託費`),
      ),

      createElement(
        View,
        { style: styles.section },
        makeRow("稼働時間", `${data.workingHours}時間`),
        makeRow("単価", `${yen(data.unitPrice)} / 時`),
        makeRow("給与小計", yen(data.totalSalary)),
      ),

      createElement(
        View,
        { style: styles.section },
        createElement(Text, null, "経費内訳:"),
        makeRow("移動費", yen(data.expenseTransport)),
        makeRow("交通費", yen(data.expenseTravel)),
        makeRow("AI利用費", yen(data.expenseAi)),
        makeRow("経費合計", yen(data.totalExpense)),
      ),

      createElement(View, { style: styles.divider }),

      createElement(
        View,
        { style: styles.section },
        makeRow("税抜合計", yen(data.subtotal)),
        makeRow("消費税（10%）", yen(data.taxAmount)),
        createElement(
          View,
          { style: styles.row },
          createElement(Text, { style: styles.bold }, "税込請求合計"),
          createElement(Text, { style: styles.bold }, yen(data.totalAmount)),
        ),
      ),

      createElement(View, { style: styles.divider }),

      createElement(
        View,
        { style: styles.section },
        createElement(Text, null, "お振込先:"),
        createElement(Text, null, String(data.bankInfo)),
        createElement(Text, null, `振込期限: ${data.paymentDue}`),
      ),
    ),
  );
}

export async function generateInvoicePdf(data: InvoiceData): Promise<Buffer> {
  return renderToBuffer(InvoiceDocument({ data }) as ReactElement<DocumentProps>);
}
