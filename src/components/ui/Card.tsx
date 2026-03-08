import { HTMLAttributes } from "react";
import { clsx } from "clsx";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: "none" | "sm" | "md" | "lg";
}

export function Card({ children, className, padding = "md", ...props }: CardProps) {
  const paddingClasses = {
    none: "",
    sm: "p-4",
    md: "p-6",
    lg: "p-8",
  };

  return (
    <div
      className={clsx(
        "rounded-xl border border-slate-200 bg-white shadow-sm",
        paddingClasses[padding],
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

interface CardHeaderProps extends HTMLAttributes<HTMLDivElement> {}

export function CardHeader({ children, className, ...props }: CardHeaderProps) {
  return (
    <div
      className={clsx("mb-4 flex flex-col gap-1", className)}
      {...props}
    >
      {children}
    </div>
  );
}

interface CardTitleProps extends HTMLAttributes<HTMLHeadingElement> {}

export function CardTitle({ children, className, ...props }: CardTitleProps) {
  return (
    <h2
      className={clsx("text-lg font-semibold text-slate-900", className)}
      {...props}
    >
      {children}
    </h2>
  );
}

interface CardDescriptionProps extends HTMLAttributes<HTMLParagraphElement> {}

export function CardDescription({
  children,
  className,
  ...props
}: CardDescriptionProps) {
  return (
    <p className={clsx("text-sm text-slate-500", className)} {...props}>
      {children}
    </p>
  );
}
