"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, TextField } from "@/components/m3";
import { FormError, FormNotice } from "@/components/auth/auth-ui";
import { errorMessage, useForgotPassword } from "@/lib/queries/auth";

export default function ForgotPasswordPage() {
  const forgot = useForgotPassword();
  const [email, setEmail] = useState("");

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        forgot.mutate(email.trim());
      }}
      className="space-y-4"
    >
      <div>
        <h1 className="headline-s">Reset your password</h1>
        <p className="mt-1 body-m text-on-surface-variant">
          Enter your account email and we will send you a link to choose a new password.
        </p>
      </div>

      <FormError message={forgot.isError ? errorMessage(forgot.error) : null} />
      <FormNotice
        message={forgot.isSuccess ? "If an account exists for that email, a reset link is on its way." : null}
      />

      <TextField
        label="Email"
        variant="outlined"
        type="email"
        autoComplete="email"
        leadingIcon="mail"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />

      <Button type="submit" size="lg" className="w-full" loading={forgot.isPending} disabled={!email}>
        Send reset link
      </Button>

      <p className="text-center body-m">
        <Link href="/login" className="focus-ring rounded-xs label-l text-primary hover:underline">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
