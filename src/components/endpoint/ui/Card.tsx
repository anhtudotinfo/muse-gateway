"use client";

import React from "react";
import { cn } from "@/lib/cn";

type CardPadding = "none" | "xs" | "sm" | "md" | "lg";

interface CardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  children: React.ReactNode;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: string;
  action?: React.ReactNode;
  padding?: CardPadding;
  hover?: boolean;
  elev?: boolean;
  className?: string;
}

export default function Card({
  children,
  title,
  subtitle,
  icon,
  action,
  padding = "md",
  hover = false,
  elev = false,
  className,
  ...props
}: CardProps) {
  const paddings: Record<CardPadding, string> = {
    none: "",
    xs: "p-3",
    sm: "p-4",
    md: "p-6",
    lg: "p-8",
  };

  return (
    <div
      className={cn(
        "bg-surface border border-border-subtle",
        elev ? "rounded-[14px] shadow-[var(--shadow-elev)]" : "rounded-[14px] shadow-[var(--shadow-soft)]",
        hover && "hover:shadow-[var(--shadow-warm)] hover:border-brand-500/30 transition-all cursor-pointer",
        paddings[padding],
        className
      )}
      {...props}
    >
      {(title || action) && (
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            {icon && (
              <div className="p-2 rounded-[10px] bg-bg text-text-muted">
                <span className="material-symbols-outlined text-[20px]">{icon}</span>
              </div>
            )}
            <div>
              {title && (
                <h3 className="text-text-main font-semibold">{title}</h3>
              )}
              {subtitle && (
                <p className="text-sm text-text-muted">{subtitle}</p>
              )}
            </div>
          </div>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}
