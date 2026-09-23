import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { UserProvider } from "@/components/UserProvider";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = {
  title: "FutsalNepal — Book Futsal Courts, Find Matches & Teams",
  description:
    "Nepal's friendliest futsal community: find a court near you, gather your friends, join a game and play tonight.",
};

/**
 * `viewport-fit=cover` is what makes `env(safe-area-inset-*)` resolve to
 * anything other than zero. The bottom nav pads itself with
 * `pb-[env(safe-area-inset-bottom)]`, but without this the inset is 0 and the
 * nav sits underneath the iPhone home indicator.
 *
 * Next.js only emits `width=device-width, initial-scale=1` by default, so this
 * has to be declared explicitly.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Stop iOS Safari and Android Chrome from inflating text on rotate, which
  // breaks layouts that were measured for the portrait width.
  maximumScale: 5,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FFF9F0" },
    { media: "(prefers-color-scheme: dark)", color: "#020617" },
  ],
};

const THEME_INIT = `(function(){try{var t=localStorage.getItem('futsal-theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark');document.documentElement.style.colorScheme='dark';}}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="min-h-screen bg-[#FFF9F0] text-stone-900 antialiased dark:bg-slate-950 dark:text-slate-100">
        <ThemeProvider>
          <UserProvider>
            <AppShell>{children}</AppShell>
          </UserProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
