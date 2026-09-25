"use client";

import { ArrowLeft, ArrowRight, Check, ChevronRight, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { timeAgo } from "@/lib/time";

type NotificationRowData = {
  id: number;
  type: string;
  title: string;
  message: string;
  link: string;
  isRead: boolean;
  createdAt: string | null;
};

export function SwipeNotificationRow({
  notification: n,
  typeClass,
  owner = false,
  onOpen,
  onRead,
  onDelete,
}: {
  notification: NotificationRowData;
  typeClass: string;
  owner?: boolean;
  onOpen: (notification: NotificationRowData) => void;
  onRead: (notification: NotificationRowData) => void;
  onDelete: (id: number) => void;
}) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const currentOffset = useRef(0);
  const swiped = useRef(false);
  const suppressClick = useRef(false);

  function pointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    startX.current = e.clientX;
    swiped.current = false;
    setDragging(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function pointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    const dx = e.clientX - startX.current;
    if (Math.abs(dx) > 6) swiped.current = true;
    currentOffset.current = Math.max(-132, Math.min(132, dx));
    setOffset(currentOffset.current);
  }

  function finishSwipe() {
    setDragging(false);
    if (!swiped.current) {
      currentOffset.current = 0;
      setOffset(0);
      return;
    }

    const finalOffset = currentOffset.current;
    suppressClick.current = true;
    if (finalOffset >= 72 && !n.isRead) {
      setOffset(112);
      onRead(n);
    } else if (finalOffset <= -72) {
      setOffset(-112);
      onDelete(n.id);
    } else {
      currentOffset.current = 0;
      setOffset(0);
    }
    window.setTimeout(() => {
      suppressClick.current = false;
      currentOffset.current = 0;
      setOffset(0);
    }, 220);
  }

  function pointerCancel() {
    setDragging(false);
    currentOffset.current = 0;
    setOffset(0);
  }

  const surface = owner
    ? n.isRead
      ? "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
      : "border-slate-900 bg-white ring-1 ring-slate-900 dark:border-white dark:bg-slate-900 dark:ring-white"
    : n.isRead
      ? "border-stone-200 bg-white dark:border-white/10 dark:bg-slate-900"
      : "border-emerald-300 bg-emerald-50/60 dark:border-emerald-500/40 dark:bg-emerald-500/10";

  return (
    <div
      className="relative overflow-hidden rounded-2xl"
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={finishSwipe}
      onPointerCancel={pointerCancel}
      style={{ touchAction: "pan-y" }}
    >
      <div className="absolute inset-0 flex items-center justify-between bg-slate-100 px-5 text-xs font-black dark:bg-slate-800">
        {offset > 8 && !n.isRead && (
          <span className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300">
            <ArrowRight className="h-4 w-4" />
            <Check className="h-4 w-4" /> Mark read
          </span>
        )}
        {offset < -8 && (
          <span className="flex items-center gap-1.5 text-red-600 dark:text-red-400">
            Delete <Trash2 className="h-4 w-4" />
            <ArrowLeft className="h-4 w-4" />
          </span>
        )}
      </div>

      <div
        className={`relative z-10 flex items-start gap-3 rounded-2xl border p-4 shadow-sm ${surface}`}
        style={{
          transform: `translateX(${offset}px)`,
          transition: dragging ? "none" : "transform 180ms ease-out",
        }}
      >
        <div className="mt-0.5 flex shrink-0 flex-col items-start gap-1">
          <span className={`rounded-lg px-2.5 py-1.5 text-[10px] font-black uppercase ${typeClass}`}>
            {n.type.replace(/_/g, " ")}
          </span>
          <span className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wide ${
            n.isRead
              ? "bg-stone-100 text-stone-500 dark:bg-white/10 dark:text-slate-400"
              : "bg-red-500 text-white"
          }`}>
            {n.isRead ? "Read" : "Unread"}
          </span>
        </div>
        <button
          onClick={() => {
            if (suppressClick.current) return;
            onOpen(n);
          }}
          className="min-w-0 flex-1 text-left"
          aria-label={n.link ? `Open ${n.title}` : n.title}
        >
          <p className={`text-sm font-extrabold leading-snug ${owner ? "text-slate-900 dark:text-slate-100" : "text-stone-900 dark:text-slate-100"}`}>
            {!n.isRead && owner && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-red-500" />}
            {n.title}
          </p>
          {n.message && (
            <p className={`mt-1 text-[13px] leading-relaxed ${owner ? "text-slate-500 dark:text-slate-400" : "text-stone-500 dark:text-slate-400"}`}>
              {n.message}
            </p>
          )}
          <p className={`mt-1.5 flex items-center gap-1 text-[11px] font-bold ${owner ? "text-slate-400 dark:text-slate-500" : "text-stone-400 dark:text-slate-500"}`}>
            {timeAgo(n.createdAt)}
            {n.link && (
              <span className={`flex items-center gap-0.5 ${owner ? "text-orange-600 dark:text-orange-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                • {owner ? "Open" : "Have a look"} <ChevronRight className="h-3 w-3" />
              </span>
            )}
          </p>
        </button>
      </div>
    </div>
  );
}
