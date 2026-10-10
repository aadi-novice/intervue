"use client";

import { useState } from "react";
import { Icon, IconButton, TextField, type TextFieldProps } from "@/components/m3";
import { cn } from "@/lib/utils";
import { passwordRules } from "@/lib/password";

/** Only allow same-site relative redirect targets. */
export function safeNext(next: string | null | undefined, fallback = "/dashboard"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="flex items-start gap-2 rounded-sm bg-error-container px-3 py-2 body-m text-on-error-container">
      <Icon name="error" size={20} className="mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

export function FormNotice({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div role="status" className="flex items-start gap-2 rounded-sm bg-secondary-container px-3 py-2 body-m text-on-secondary-container">
      <Icon name="check_circle" size={20} className="mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

/** Live checklist of password rules. */
export function PasswordHints({ password, id }: { password: string; id?: string }) {
  return (
    <ul id={id} aria-label="Password requirements" className="space-y-1 px-4 pt-2">
      {passwordRules(password).map((r) => (
        <li
          key={r.id}
          className={cn("flex items-center gap-2 body-s", r.met ? "text-match-strong" : "text-on-surface-variant")}
        >
          <Icon name={r.met ? "check_circle" : "radio_button_unchecked"} size={16} filled={r.met} />
          <span>
            {r.label}
            <span className="sr-only">{r.met ? " (met)" : " (not met)"}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

type PasswordFieldProps = Omit<TextFieldProps, "type" | "trailing" | "value" | "onChange"> & {
  value: string;
  onValueChange: (v: string) => void;
  showHints?: boolean;
};

/** Password input with show/hide toggle and optional live rule hints. */
export function PasswordField({ value, onValueChange, showHints = false, label = "Password", ...props }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <TextField
        {...props}
        label={label}
        variant="outlined"
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        leadingIcon="lock"
        trailing={
          <IconButton
            type="button"
            icon={visible ? "visibility_off" : "visibility"}
            label={visible ? "Hide password" : "Show password"}
            size="sm"
            onClick={() => setVisible((v) => !v)}
          />
        }
      />
      {showHints && <PasswordHints password={value} />}
    </div>
  );
}
