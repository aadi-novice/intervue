import { Suspense } from "react";
import { RoleDetail } from "@/components/ranking/role-detail";

export default async function RoleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <RoleDetail roleId={Number(id)} />
    </Suspense>
  );
}
