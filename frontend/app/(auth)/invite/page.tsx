"use client";

import { Suspense, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, CircularProgress, Icon } from "@/components/m3";
import { FormError } from "@/components/auth/auth-ui";
import { ApiError } from "@/lib/api";
import { errorMessage, useAcceptInvitation, useMe } from "@/lib/queries/auth";

function InviteView() {
  const router = useRouter();
  const token = useSearchParams().get("token");
  const me = useMe();
  const accept = useAcceptInvitation();
  const started = useRef(false);

  const signedIn = me.isSuccess;
  const needsLogin = me.isError && me.error instanceof ApiError && me.error.status === 401;

  useEffect(() => {
    // The invitation token is single-use, so guard against double invocation.
    if (!token || !signedIn || started.current) return;
    started.current = true;
    accept.mutate(token, { onSuccess: () => router.replace("/dashboard") });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, signedIn]);

  if (!token) {
    return (
      <div className="space-y-4">
        <h1 className="headline-s">Invitation invalid</h1>
        <FormError message="This invitation link is missing its token." />
      </div>
    );
  }

  if (needsLogin) {
    const next = encodeURIComponent(`/invite?token=${token}`);
    return (
      <div className="space-y-4">
        <Icon name="group_add" size={40} className="text-primary" />
        <h1 className="headline-s">You have been invited</h1>
        <p className="body-m text-on-surface-variant">
          Sign in with the email address the invitation was sent to, or create an account, to join the organization.
        </p>
        <Button asChild size="lg" className="w-full">
          <Link href={`/login?next=${next}`}>Sign in</Link>
        </Button>
        <Button asChild size="lg" variant="outlined" className="w-full">
          <Link href={`/register?next=${next}`}>Create account</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 text-center" aria-live="polite">
      {accept.isError || me.isError ? (
        <>
          <h1 className="headline-s">Could not accept invitation</h1>
          <FormError message={errorMessage(accept.error ?? me.error)} />
          <Button asChild variant="outlined" className="w-full">
            <Link href="/dashboard">Go to dashboard</Link>
          </Button>
        </>
      ) : (
        <>
          <div className="flex justify-center">
            <CircularProgress aria-label="Joining organization" />
          </div>
          <h1 className="headline-s">Joining organization…</h1>
        </>
      )}
    </div>
  );
}

export default function InvitePage() {
  return (
    <Suspense>
      <InviteView />
    </Suspense>
  );
}
