import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Invoice Reminder Bot",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
