"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PickerOption {
  value: string;
  label: string;
  description?: string;
}

/**
 * Compact dropdown for picking one of a few labelled values (model, effort,
 * provider). Shared by the Claude Code widget and the AI assistant.
 */
export function OptionPicker({
  value,
  options,
  onChange,
  icon,
  title,
  footnote,
  width = "w-64",
  align = "right",
  disabled = false,
}: {
  value: string;
  options: readonly PickerOption[];
  onChange: (v: string) => void;
  icon?: ReactNode;
  title: string;
  footnote?: string;
  width?: string;
  align?: "left" | "right";
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const current = options.find((m) => m.value === value) || options[0];

  return (
    <div
      className="relative"
      ref={ref}
      onKeyDown={(e) => { if (e.key === "Escape" && open) { e.preventDefault(); e.stopPropagation(); setOpen(false); } }}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 px-2 h-11 md:h-7 text-xs rounded-md hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:pointer-events-none"
        title={`${title}: ${current.label}`}
        aria-label={`${title}: ${current.label}`}
      >
        {icon}
        <span>{current.label}</span>
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div className={cn("absolute top-full mt-1 z-20 rounded-md border border-border bg-popover shadow-md py-1", width, align === "right" ? "right-0" : "left-0")}>
          {options.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => { onChange(m.value); setOpen(false); }}
              className={cn(
                "w-full min-h-11 md:min-h-0 text-left px-2 py-1.5 hover:bg-accent flex flex-col gap-0.5",
                m.value === value && "bg-accent",
              )}
            >
              <span className="text-xs font-medium">{m.label}</span>
              {m.description && <span className="text-[0.625rem] text-muted-foreground">{m.description}</span>}
            </button>
          ))}
          {footnote && (
            <div className="px-2 pt-1 mt-1 border-t border-border text-[0.625rem] text-muted-foreground">
              {footnote}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
