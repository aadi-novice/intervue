"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/m3";
import { FormError, PasswordField } from "@/components/auth/auth-ui";
import { isPasswordValid } from "@/lib/password";
import { errorMessage, useResetPassword } from "@/lib/queries/auth";

function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get("token");
  const reset = useResetPassword();
  const [password, setPassword] = useState("");

  if (!token) {
    return (
      <div className="space-y-4">
        <h1 className="headline-s">Link invalid</h1>
        <FormError message="This password reset link is missing its token. Request a new one." />
        <Button asChild className="w-full" size="lg">
          <Link href="/forgot-password">Request a new link</Link>
        </Button>
      </div>
    );
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!isPasswordValid(password)) return;
        reset.mutate({ token, password }, { onSuccess: () => router.replace("/login?reset=1") });
      }}
      className="space-y-4"
    >
      <div>
        <h1 className="headline-s">Choose a new password</h1>
        <p className="mt-1 body-m text-on-surface-variant">Pick something you have not used elsewhere.</p>
      </div>

      <FormError message={reset.isError ? errorMessage(reset.error) : null} />

      <PasswordField label="New password" autoComplete="new-password" required showHints value={password} onValueChange={setPassword} />

      <Button type="submit" size="lg" className="w-full" loading={reset.isPending} disabled={!isPasswordValid(password)}>
        Update password
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
