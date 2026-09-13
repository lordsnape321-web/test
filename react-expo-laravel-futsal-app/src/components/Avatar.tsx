"use client";

import { initials } from "@/lib/futsal";

type AvatarUser = {
  name: string;
  avatarColor: string;
  avatarUrl?: string | null;
};

export function Avatar({
  user,
  className = "h-8 w-8 text-xs",
  rounded = "rounded-full",
  ring = "",
}: {
  user: AvatarUser;
  className?: string;
  rounded?: string;
  ring?: string;
}) {
  const url = (user.avatarUrl ?? "").trim();
  if (url) {
    return (
      <span
        className={`grid shrink-0 place-items-center overflow-hidden font-black text-white ${rounded} ${ring} ${className}`}
        style={{ background: user.avatarColor }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={user.name} className="h-full w-full object-cover" />
      </span>
    );
  }
  return (
    <span
      className={`grid shrink-0 place-items-center font-black text-white ${rounded} ${ring} ${className}`}
      style={{ background: user.avatarColor }}
    >
      {initials(user.name)}
    </span>
  );
}
