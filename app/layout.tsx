import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import ThemeToggle from "@/components/ThemeToggle";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TurboBet — Sports Betting",
  description: "Live odds, upcoming fixtures, and real-time sports betting.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // 🚀 UNLOCKED: Removed the hardcoded 'dark' class so the app can freely toggle
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="beforeInteractive"
        />
      </head>
      <body suppressHydrationWarning className="min-h-full flex flex-col bg-[#F0FDF4] dark:bg-[#02120b] transition-colors duration-500">
        
        {/* Toggle placed in the top right corner over the app content */}
        <div className="absolute top-4 right-4 z-50">
          <ThemeToggle />
        </div>

        {children}
      </body>
    </html>
  );
}