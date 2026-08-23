import type { Metadata } from "next";
import type { ReactNode } from "react";
import { DM_Mono, Fraunces, Work_Sans } from "next/font/google";
import "./globals.css";

 const workSans = Work_Sans({
   variable: "--font-work-sans",
  subsets: ["latin"],
});

 const fraunces = Fraunces({
   variable: "--font-fraunces",
  subsets: ["latin"],
});

 const dmMono = DM_Mono({
   variable: "--font-dm-mono",
   subsets: ["latin"],
   weight: ["400", "500"],
 });

export const metadata: Metadata = {
  title: "In the Moment | Podcast Q&A",
  description: "Ask questions about the part of a podcast episode you have heard.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${workSans.variable} ${fraunces.variable} ${dmMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
