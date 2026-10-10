"use client";

import { Suspense, useEffect, useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button, CircularProgress, Icon } from "@/components/m3";
import { FormError } from "@/components/auth/auth-ui";
import { errorMessage, useVerifyEmail } from "@/lib/queries/auth";

function VerifyView() {
  const token = useSearchParams().get("token");
  const verify = useVerifyEmail();
  const started = useRef(false);

  useEffect(() => {
    // Guard against React strict-mode double invocation: the token is single-use.
    if (!token || started.current) return;
    started.current = true;
    verify.mutate(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (!token) {
    return (
      <div className="space-y-4">
        <h1 className="headline-s">Link invalid</h1>
        <FormError message="This verification link is missing its token." />
      </div>
    );
  }

  return (
    <div className="space-y-4 text-center" aria-live="polite">
      {verify.isError ? (
        <>
          <h1 className="headline-s">Verification failed</h1>
          <FormError message={errorMessage(verify.error)} />
          <p className="body-m text-on-surface-variant">Sign in and use &quot;Resend&quot; to get a fresh link.</p>
        </>
      ) : verify.isSuccess ? (
        <>
          <Icon name="check_circle" filled size={48} className="mx-auto text-match-strong" />
          <h1 className="headline-s">Email verified</h1>
          <p className="body-m text-on-surface-variant">Thanks, your email address is confirmed.</p>
        </>
      ) : (
        <>
          <div className="flex justify-center">
            <CircularProgress aria-label="Verifying email" />
          </div>
          <h1 className="headline-s">Verifying your email…</h1>
        </>
      )}
      {(verify.isSuccess || verify.isError) && (
        <Button asChild size="lg" className="w-full">
          <Link href="/dashboard">Continue to Intervue</Link>
        </Button>
      )}
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyView />
    </Suspense>
  );
}
