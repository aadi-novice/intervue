"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { CompareView } from "@/components/ranking/compare-view";

function Inner() {
  const sp = useSearchParams();
  return <CompareView roleParam={sp.get("role")} idsParam={sp.get("ids")} />;
}

export default function ComparePage() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  );
}
