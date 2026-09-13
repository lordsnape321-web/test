"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Navbar } from "./Navbar";
import { MobileNav } from "./MobileNav";
import { OwnerShell } from "./OwnerShell";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isOwnerApp = pathname === "/admin" || pathname.startsWith("/admin/");

  // Completely separate interfaces:
  // - /admin/*  -> light "Owner Studio" with sidebar
  // - everything else -> dark player app with top nav + bottom tabs
  if (isOwnerApp) {
    return <OwnerShell>{children}</OwnerShell>;
  }

  return (
    <>
      <Navbar />
      <div className="pb-20 lg:pb-0">{children}</div>
      <MobileNav />
    </>
  );
}
