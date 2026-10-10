"use client";

import { roleAllowed, useRole, type OrgRole } from "@/lib/roles";

/** Renders children only when the current org role is in `roles`. UI hiding only; the API enforces. */
export function RequireRole({
  roles,
  children,
  fallback = null,
}: {
  roles: readonly OrgRole[];
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const role = useRole();
  return <>{roleAllowed(role, roles) ? children : fallback}</>;
}
