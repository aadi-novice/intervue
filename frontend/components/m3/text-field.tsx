"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Icon, type IconName } from "./icon";

const fieldVariants = cva("group relative flex w-full items-center gap-2 transition-colors", {
  variants: {
    variant: {
      filled:
        "min-h-14 rounded-t-xs border-b border-on-surface-variant bg-surface-container-highest px-4 focus-within:border-b-2 focus-within:border-primary hover:bg-surface-container-highest",
      outlined:
        "min-h-14 rounded-xs border border-outline px-4 hover:border-on-surface focus-within:border-2 focus-within:border-primary",
    },
    invalid: { true: "!border-error focus-within:!border-error", false: "" },
    disabled: { true: "opacity-38 pointer-events-none", false: "" },
  },
  defaultVariants: { variant: "filled", invalid: false, disabled: false },
});

type NativeInput = Omit<React.InputHTMLAttributes<HTMLInputElement>, "size" | "prefix">;

export interface TextFieldProps extends NativeInput, Omit<VariantProps<typeof fieldVariants>, "invalid" | "disabled"> {
  label: string;
  supportingText?: string;
  error?: string;
  leadingIcon?: IconName;
  trailing?: React.ReactNode;
  /** Render a multi-line textarea. */
  multiline?: boolean;
  rows?: number;
  containerClassName?: string;
}

/** M3 text field (filled / outlined) with floating label, supporting text and error state. */
export const TextField = React.forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, supportingText, error, variant, leadingIcon, trailing, multiline, rows = 3, containerClassName, className, id, disabled, ...props },
  ref,
) {
  const autoId = React.useId();
  const fid = id ?? autoId;
  const describedBy = supportingText || error ? `${fid}-support` : undefined;
  const sharedClass = cn(
    "peer w-full min-w-0 bg-transparent body-l text-on-surface caret-primary outline-none placeholder:text-transparent focus:placeholder:text-on-surface-variant",
    variant === "outlined" ? "py-4" : "pb-2 pt-6",
    className,
  );
  const common = {
    id: fid,
    disabled,
    placeholder: props.placeholder ?? " ",
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
  };
  return (
    <div className={containerClassName}>
      <div className={fieldVariants({ variant, invalid: !!error, disabled: !!disabled })}>
        {leadingIcon && <Icon name={leadingIcon} className="text-on-surface-variant" />}
        <div className="relative min-w-0 flex-1">
          {multiline ? (
            <textarea
              {...common}
              rows={rows}
              className={cn(sharedClass, "resize-y")}
              {...(props as unknown as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
            />
          ) : (
            <input ref={ref} {...common} className={sharedClass} {...props} />
          )}
          <label
            htmlFor={fid}
            className={cn(
              "pointer-events-none absolute start-0 origin-left truncate transition-all duration-150 ease-standard",
              error ? "text-error" : "text-on-surface-variant peer-focus:text-primary",
              // floated
              "top-1.5 body-s peer-placeholder-shown:top-4 peer-placeholder-shown:body-l peer-focus:top-1.5 peer-focus:body-s",
              variant === "outlined" &&
                "-top-2.5 bg-surface px-1 -ms-1 peer-placeholder-shown:top-4 peer-focus:-top-2.5 peer-placeholder-shown:bg-transparent peer-focus:bg-surface",
            )}
          >
            {label}
          </label>
        </div>
        {error ? <Icon name="error" className="text-error" /> : trailing}
      </div>
      {(supportingText || error) && (
        <p id={`${fid}-support`} className={cn("px-4 pt-1 body-s", error ? "text-error" : "text-on-surface-variant")} role={error ? "alert" : undefined}>
          {error ?? supportingText}
        </p>
      )}
    </div>
  );
});
