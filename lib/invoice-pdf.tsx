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

function InvoiceDocument({ data }: { data: InvoiceData }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>請 求 書</Text>

        <View style={styles.section}>
          <Text>{`発行日: ${data.issueDate}`}</Text>
          <Text>{`請求書番号: ${data.invoiceNumber}`}</Text>
        </View>

        <View style={styles.section}>
          <Text>請求先:</Text>
          <Text>{`${data.companyName} 御中`}</Text>
        </View>

        <View style={styles.section}>
          <Text>請求者:</Text>
          <Text>{data.internName}</Text>
          <Text>{data.internAddress}</Text>
          <Text>{data.internPhone}</Text>
        </View>

        <View style={styles.divider} />

        <View style={styles.section}>
          <Text>{`件名: ${data.month}分 業務委託費`}</Text>
        </View>

        <View style={styles.section}>
          <View style={styles.row}>
            <Text>稼働時間</Text>
            <Text>{`${data.workingHours}時間`}</Text>
          </View>
          <View style={styles.row}>
            <Text>単価</Text>
            <Text>{`${yen(data.unitPrice)} / 時`}</Text>
          </View>
          <View style={styles.row}>
            <Text>給与小計</Text>
            <Text>{yen(data.totalSalary)}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text>経費内訳:</Text>
          <View style={styles.row}>
            <Text>移動費</Text>
            <Text>{yen(data.expenseTransport)}</Text>
          </View>
          <View style={styles.row}>
            <Text>交通費</Text>
            <Text>{yen(data.expenseTravel)}</Text>
          </View>
          <View style={styles.row}>
            <Text>AI利用費</Text>
            <Text>{yen(data.expenseAi)}</Text>
          </View>
          <View style={styles.row}>
            <Text>経費合計</Text>
            <Text>{yen(data.totalExpense)}</Text>
          </View>
        </View>

        <View style={styles.divider} />

        <View style={styles.section}>
          <View style={styles.row}>
            <Text>税抜合計</Text>
            <Text>{yen(data.subtotal)}</Text>
          </View>
          <View style={styles.row}>
            <Text>消費税（10%）</Text>
            <Text>{yen(data.taxAmount)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.bold}>税込請求合計</Text>
            <Text style={styles.bold}>{yen(data.totalAmount)}</Text>
          </View>
        </View>

        <View style={styles.divider} />

        <View style={styles.section}>
          <Text>お振込先:</Text>
          <Text>{data.bankInfo}</Text>
          <Text>{`振込期限: ${data.paymentDue}`}</Text>
        </View>
      </Page>
    </Document>
  );
}

export async function generateInvoicePdf(data: InvoiceData): Promise<Buffer> {
  return renderToBuffer(<InvoiceDocument data={data} />);
}
