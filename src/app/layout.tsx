import type { Metadata, Viewport } from "next";
import { Fredoka, M_PLUS_Rounded_1c, Nunito } from "next/font/google";
import "./globals.css";

const mplus = M_PLUS_Rounded_1c({
  variable: "--font-mplus",
  weight: ["400", "700", "800"],
  subsets: ["latin"],
  display: "swap",
  preload: false,
});

const fredoka = Fredoka({
  variable: "--font-fredoka",
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
});

const nunito = Nunito({
  variable: "--font-nunito",
  weight: ["400", "600", "800"],
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "こども英語ひろば | Buddy & Friends",
  description:
    "こども英語ひろば — 英語の冒険にでかけよう。フラッシュカード、単語ならべかえ、発音練習で、遊びながら学べる子供向け英語アプリ。",
};

export const viewport: Viewport = {
  themeColor: "#cdeeff",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ja"
      className={`${mplus.variable} ${fredoka.variable} ${nunito.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
