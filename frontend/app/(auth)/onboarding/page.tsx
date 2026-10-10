"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Skeleton, TextField } from "@/components/m3";
import { FormError, safeNext } from "@/components/auth/auth-ui";
import { errorMessage, useCreateOrg, useMe } from "@/lib/queries/auth";

function OnboardingForm() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const me = useMe();
  const create = useCreateOrg();
  const [name, setName] = useState("");

  const hasOrgs = (me.data?.orgs.length ?? 0) > 0;

  useEffect(() => {
    // Only for users with zero orgs; anyone else goes straight in (unless we just created one).
    if (hasOrgs && !create.isPending && !create.isSuccess) router.replace(next);
  }, [hasOrgs, create.isPending, create.isSuccess, router, next]);

  if (me.isPending || hasOrgs) {
    return (
      <div className="space-y-4" role="status" aria-busy="true">
        <span className="sr-only">Loading</span>
        <Skeleton className="h-8 w-2/3 rounded-sm" />
        <Skeleton className="h-14 rounded-sm" />
        <Skeleton className="h-12 rounded-full" />
      </div>
    );
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        create.mutate(name.trim(), { onSuccess: () => router.replace(next) });
      }}
      className="space-y-4"
    >
      <div>
        <h1 className="headline-s">Set up your organization</h1>
        <p className="mt-1 body-m text-on-surface-variant">
          {me.data ? `Welcome, ${me.data.user.full_name}. ` : ""}
          Name your company or team. You can invite teammates afterwards.
        </p>
      </div>

      <FormError message={create.isError ? errorMessage(create.error) : (me.isError ? errorMessage(me.error) : null)} />

      <TextField
        label="Organization name"
        variant="outlined"
        leadingIcon="domain"
        required
        maxLength={200}
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
      />

      <Button type="submit" size="lg" className="w-full" loading={create.isPending} disabled={!name.trim()}>
        Create organization
      </Button>
    </form>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense>
      <OnboardingForm />
    </Suspense>
  );
}
