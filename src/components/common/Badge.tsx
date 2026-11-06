import React from "react";

interface BadgeProps {
  children: React.ReactNode;
  variant?: "sky" | "emerald" | "amber" | "rose" | "slate";
  size?: "sm" | "md";
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = "slate",
  size = "md",
}) => {
  const variantStyles = {
    sky: "bg-sky-950/70 text-sky-400 border-sky-800/60",
    emerald: "bg-emerald-950/70 text-emerald-400 border-emerald-800/60",
    amber: "bg-amber-950/70 text-amber-400 border-amber-800/60",
    rose: "bg-rose-950/70 text-rose-400 border-rose-800/60",
    slate: "bg-slate-800/80 text-slate-300 border-slate-700/60",
  };

  const sizeStyles = {
    sm: "text-[10px] px-1.5 py-0.5",
    md: "text-xs px-2 py-0.5",
  };

  return (
    <span
      className={`inline-flex items-center font-medium rounded-full border ${variantStyles[variant]} ${sizeStyles[size]}`}
    >
      {children}
    </span>
  );
};
