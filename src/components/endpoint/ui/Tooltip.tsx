"use client";

import React, { useState } from "react";
import { cn } from "@/lib/cn";

interface TooltipProps {
  text: React.ReactNode;
  position?: "top" | "bottom" | "left" | "right";
  color?: string;
  children: React.ReactNode;
  className?: string;
}

const POSITIONS: Record<NonNullable<TooltipProps["position"]>, string> = {
  top: "bottom-full left-1/2 -translate-x-1/2 mb-1.5",
  bottom: "top-full left-1/2 -translate-x-1/2 mt-1.5",
  left: "right-full top-1/2 -translate-y-1/2 mr-1.5",
  right: "left-full top-1/2 -translate-y-1/2 ml-1.5",
};

export default function Tooltip({ text, position = "top", color, children, className }: TooltipProps) {
  const [show, setShow] = useState(false);
  return (
    <span
      className={cn("relative inline-flex", className)}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onFocus={() => setShow(true)}
      onBlur={() => setShow(false)}
    >
      {children}
      {show && (
        <span
          role="tooltip"
          className={cn(
            "pointer-events-none absolute z-50 whitespace-nowrap rounded-md px-2 py-1",
            "bg-surface-2 border border-border-subtle text-[11px] font-medium text-text-main shadow-md",
            "fade-in",
            POSITIONS[position]
          )}
          style={color ? { borderColor: color, color } : undefined}
        >
          {text}
        </span>
      )}
    </span>
  );
}
