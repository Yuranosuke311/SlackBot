import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";

export type InvoiceData = {
  invoiceNumber: string;
  issueDate: string;
  companyName: string;
  internName: string;
  internAddress: string;
  internPhone: string;
  month: string;
  salaryType: "hourly" | "fixed";
  salaryTaxType: "exclusive" | "inclusive";
  workingHours: number;
  unitPrice: number;
  totalSalary: number;
  expenses: { name: string; amount: number }[];
  totalExpense: number;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  bankInfo: string;
  paymentDue: string;
};

function yen(amount: number): string {
  return `¥${amount.toLocaleString("ja-JP")}`;
}

export async function generateInvoicePdf(data: InvoiceData): Promise<Buffer> {
  const fontBuffer = fs.readFileSync(
    path.join(process.cwd(), "public/fonts/NotoSansJP-Regular.ttf")
  );

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.registerFont("JP", fontBuffer);
    doc.font("JP").fontSize(10);

    const L = 50;
    const W = 495;

    function divider() {
      doc.moveDown(0.5);
      doc.moveTo(L, doc.y).lineTo(L + W, doc.y).stroke();
      doc.moveDown(0.5);
    }

    function row(label: string, value: string) {
      const y = doc.y;
      doc.text(label, L, y, { width: W * 0.6 });
      doc.text(value, L + W * 0.55, y, { width: W * 0.45, align: "right" });
    }

    doc.fontSize(18).text("請 求 書", L, doc.y, { align: "center", width: W });
    doc.moveDown();
    doc.fontSize(10);

    doc.text(`発行日: ${data.issueDate}`);
    doc.text(`請求書番号: ${data.invoiceNumber}`);
    doc.moveDown();

    doc.text("請求先:");
    doc.text(`${data.companyName} 御中`);
    doc.moveDown();

    doc.text("請求者:");
    doc.text(data.internName);
    doc.text(data.internAddress);
    doc.text(data.internPhone);

    divider();

    doc.text(`件名: ${data.month}分 業務委託費`);
    doc.moveDown();

    if (data.salaryType === "fixed") {
      row("月額固定報酬", yen(data.totalSalary));
    } else {
      row("稼働時間", `${data.workingHours}時間`);
      doc.moveDown(0.3);
      row("単価", `${yen(data.unitPrice)} / 時`);
      doc.moveDown(0.3);
      row("給与小計", yen(data.totalSalary));
    }
    doc.moveDown();

    doc.text("経費内訳:");
    doc.moveDown(0.3);
    if (data.expenses.length === 0) {
      doc.text("　なし");
      doc.moveDown(0.3);
    } else {
      for (const expense of data.expenses) {
        row(`　${expense.name}`, yen(expense.amount));
        doc.moveDown(0.3);
      }
    }
    row("経費合計（税込）", yen(data.totalExpense));

    divider();

    if (data.salaryTaxType === "exclusive") {
      row("給与（税抜）", yen(data.subtotal));
      doc.moveDown(0.3);
      row("消費税（10%）", yen(data.taxAmount));
      doc.moveDown(0.3);
      row("経費合計（税込）", yen(data.totalExpense));
      doc.moveDown(0.3);
      doc.fontSize(11);
      row("税込請求合計", yen(data.totalAmount));
      doc.fontSize(10);
    } else {
      row("給与（税込）", yen(data.subtotal));
      doc.moveDown(0.3);
      row("経費合計（税込）", yen(data.totalExpense));
      doc.moveDown(0.3);
      doc.fontSize(11);
      row("請求合計", yen(data.totalAmount));
      doc.fontSize(10);
    }

    divider();

    doc.text("お振込先:");
    doc.text(data.bankInfo);
    doc.text(`振込期限: ${data.paymentDue}`);

    doc.end();
  });
}
