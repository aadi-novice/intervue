"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, TextField } from "@/components/m3";
import { FormError, PasswordField, safeNext } from "@/components/auth/auth-ui";
import { isPasswordValid } from "@/lib/password";
import { errorMessage, useRegister } from "@/lib/queries/auth";

function RegisterForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next");
  const register = useRegister();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const canSubmit = fullName.trim().length > 0 && email.length > 0 && isPasswordValid(password);

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        register.mutate(
          { full_name: fullName.trim(), email: email.trim(), password },
          // New accounts have no org yet: AuthGate sends them to /onboarding, then on to `next`.
          { onSuccess: () => router.replace(next ? `/onboarding?next=${encodeURIComponent(safeNext(next))}` : "/onboarding") },
        );
      }}
      className="space-y-4"
    >
      <div>
        <h1 className="headline-s">Create your account</h1>
        <p className="mt-1 body-m text-on-surface-variant">Start screening candidates with AI-assisted interviews.</p>
      </div>

      <FormError message={register.isError ? errorMessage(register.error) : null} />

      <TextField
        label="Full name"
        variant="outlined"
        autoComplete="name"
        leadingIcon="person"
        required
        value={fullName}
        onChange={(e) => setFullName(e.target.value)}
      />
      <TextField
        label="Work email"
        variant="outlined"
        type="email"
        autoComplete="email"
        leadingIcon="mail"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <PasswordField label="Password" autoComplete="new-password" required showHints value={password} onValueChange={setPassword} />

      <Button type="submit" size="lg" className="w-full" loading={register.isPending} disabled={!canSubmit}>
        Create account
      </Button>

      <p className="text-center body-m text-on-surface-variant">
        Already have an account?{" "}
        <Link href="/login" className="focus-ring rounded-xs label-l text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}
