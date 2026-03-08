import { InputHTMLAttributes, forwardRef } from "react";
import { clsx } from "clsx";

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: React.ReactNode;
  error?: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ label, error, className, id, ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            ref={ref}
            id={id}
            type="checkbox"
            className={clsx(
              "mt-0.5 h-4 w-4 flex-shrink-0 cursor-pointer rounded border-slate-300",
              "text-blue-700 accent-blue-700",
              "focus:ring-2 focus:ring-blue-500 focus:ring-offset-1",
              error && "border-red-400",
              className
            )}
            {...props}
          />
          <span className="text-sm text-slate-700 leading-snug">{label}</span>
        </label>
        {error && (
          <p className="ml-7 text-xs text-red-600" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }
);

Checkbox.displayName = "Checkbox";
