"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Divider, TextField } from "@/components/m3";
import { FormError, FormNotice, PasswordField, safeNext } from "@/components/auth/auth-ui";
import { api } from "@/lib/api";
import { errorMessage, useLogin } from "@/lib/queries/auth";

type Provider = "google" | "microsoft";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const login = useLogin();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [oauthBusy, setOauthBusy] = useState<Provider | null>(null);

  const oauthQueryError = params.get("error");

  async function startOAuth(provider: Provider) {
    setOauthError(null);
    setOauthBusy(provider);
    const url = api.auth.oauthUrl(provider);
    try {
      // Pre-flight so an unconfigured provider (501) becomes a friendly message, not a JSON page.
      const res = await fetch(url, { redirect: "manual", credentials: "include" });
      if (res.status === 501) {
        setOauthError(
          `${provider === "google" ? "Google" : "Microsoft"} sign-in is not configured for this deployment yet.`,
        );
        setOauthBusy(null);
        return;
      }
    } catch {
      // Network hiccup on the pre-flight: fall through and let the browser navigate.
    }
    window.location.assign(url);
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        login.mutate({ email: email.trim(), password }, { onSuccess: () => router.replace(next) });
      }}
      className="space-y-4"
    >
      <div>
        <h1 className="headline-s">Sign in</h1>
        <p className="mt-1 body-m text-on-surface-variant">Welcome back. Sign in to continue to Intervue.</p>
      </div>

      <FormNotice message={params.get("reset") ? "Password updated. You can sign in now." : null} />
      <FormError message={login.isError ? errorMessage(login.error) : (oauthError ?? oauthQueryError)} />

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
      <PasswordField
        label="Password"
        autoComplete="current-password"
        required
        value={password}
        onValueChange={setPassword}
      />

      <div className="flex justify-end">
        <Link href="/forgot-password" className="focus-ring rounded-xs label-l text-primary hover:underline">
          Forgot password?
        </Link>
      </div>

      <Button type="submit" size="lg" className="w-full" loading={login.isPending} disabled={!email || !password}>
        Sign in
      </Button>

      <div className="flex items-center gap-3" role="separator" aria-label="or">
        <Divider className="flex-1" />
        <span className="label-m text-on-surface-variant">or</span>
        <Divider className="flex-1" />
      </div>

      <div className="grid gap-2">
        <Button
          type="button"
          variant="outlined"
          icon="login"
          loading={oauthBusy === "google"}
          onClick={() => startOAuth("google")}
        >
          Continue with Google
        </Button>
        <Button
          type="button"
          variant="outlined"
          icon="login"
          loading={oauthBusy === "microsoft"}
          onClick={() => startOAuth("microsoft")}
        >
          Continue with Microsoft
        </Button>
      </div>

      <p className="text-center body-m text-on-surface-variant">
        New to Intervue?{" "}
        <Link
          href={next === "/dashboard" ? "/register" : `/register?next=${encodeURIComponent(next)}`}
          className="focus-ring rounded-xs label-l text-primary hover:underline"
        >
          Create an account
        </Link>
      </p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
