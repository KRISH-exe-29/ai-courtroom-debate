import type { Metadata, Viewport } from "next";
import { Barlow_Condensed, Source_Serif_4 } from "next/font/google";
import "./globals.css";

const display = Barlow_Condensed({ variable: "--font-display", subsets: ["latin"], weight: ["500", "600", "700", "800"] });
const serif = Source_Serif_4({ variable: "--font-serif", subsets: ["latin"] });

const title = "Courtroom AI: put your idea on trial";
const description =
  "Two AI lawyers argue over your idea or decision. A blind AI judge docks points for every bluff, dodge and contradiction, then gives a ruling with conditions.";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000",
  ),
  title,
  description,
  keywords: ["AI debate", "AI judge", "LLM as a judge", "decision making", "AI courtroom", "multi-agent debate"],
  openGraph: { title, description, type: "website" },
  twitter: { card: "summary_large_image", title, description },
};

export const viewport: Viewport = { themeColor: "#0c1020", colorScheme: "dark" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${serif.variable}`}>
      <body>{children}</body>
    </html>
  );
}
