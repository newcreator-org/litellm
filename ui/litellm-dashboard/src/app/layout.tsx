import type { Metadata } from "next";
import { Inter, Noto_Sans_JP } from "next/font/google";
import "./globals.css";

import AntdGlobalProvider from "@/contexts/AntdGlobalProvider";
import ReactQueryProvider from "@/contexts/ReactQueryProvider";
import { I18nProvider } from "@/i18n";

const inter = Inter({ subsets: ["latin"] });
const notoSansJP = Noto_Sans_JP({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

export const metadata: Metadata = {
  title: "Connect LM ダッシュボード",
  description: "Connect LM プロキシ管理UI",
  icons: { icon: "./favicon.ico" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className={`${inter.className} ${notoSansJP.className}`}>
        <ReactQueryProvider>
          <AntdGlobalProvider>
            <I18nProvider locale="ja">{children}</I18nProvider>
          </AntdGlobalProvider>
        </ReactQueryProvider>
      </body>
    </html>
  );
}
