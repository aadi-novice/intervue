"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Button, EmptyState, LoadingRegion, PageHeader, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/m3";
import { PipelineBoard } from "@/components/pipeline/pipeline-board";
import { useMotionPattern } from "@/app/theme/motion";
import { apiMessage } from "@/lib/api-ranking";
import { useRoleDetail } from "@/lib/queries/ranking";
import { CAN, roleAllowed, useRole } from "@/lib/roles";
import { RankingTab } from "./ranking-tab";
import { RoleSettings } from "./role-settings";
import { RoleStatusChip } from "./role-status-chip";
import { RubricEditor } from "./rubric-editor";

export const TABS = ["ranking", "pipeline", "rubric", "settings"] as const;
export type RoleTab = (typeof TABS)[number];

export function parseTab(v: string | null): RoleTab {
  return (TABS as readonly string[]).includes(v ?? "") ? (v as RoleTab) : "ranking";
}

export function RoleDetail({ roleId }: { roleId: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const tab = parseTab(search.get("tab"));
  const variants = useMotionPattern("sharedAxisX");
  const orgRole = useRole();
  const canWrite = roleAllowed(orgRole, CAN.create);
  const role = useRoleDetail(roleId);

  const setTab = (t: string) => {
    const p = new URLSearchParams(search.toString());
    p.set("tab", t);
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  };

  if (role.isLoading) {
    return (
      <LoadingRegion label="Loading role" className="space-y-4 p-4 medium:p-6">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-64 w-full rounded-md" />
      </LoadingRegion>
    );
  }
  if (role.isError || !role.data) {
    return (
      <div className="p-4 medium:p-6">
        <EmptyState icon="work" title="Role not found">
          {role.error ? apiMessage(role.error) : "This role does not exist."}
        </EmptyState>
        <div className="flex justify-center">
          <Button asChild variant="tonal">
            <Link href="/roles">Back to roles</Link>
          </Button>
        </div>
      </div>
    );
  }
  const r = role.data;
  return (
    <div className="space-y-4 p-4 medium:p-6">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {r.name}
            <RoleStatusChip status={r.status} />
          </span>
        }
        subtitle={`${r.experience_level} · ${r.experience_required_years}+ years`}
        actions={
          <Button asChild variant="text" icon="arrow_back">
            <Link href="/roles">All roles</Link>
          </Button>
        }
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="ranking">Ranking</TabsTrigger>
          <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
          <TabsTrigger value="rubric">Rubric</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={tab} variants={variants} initial="initial" animate="animate" exit="exit" className="pt-4">
            <TabsContent value={tab} forceMount>
              {tab === "ranking" && <RankingTab roleId={roleId} />}
              {tab === "pipeline" && (
                <div className="h-[70dvh]">
                  <PipelineBoard roleId={roleId} />
                </div>
              )}
              {tab === "rubric" && <RubricEditor roleId={roleId} canWrite={canWrite} hasDescription={!!r.description?.trim()} />}
              {tab === "settings" && <RoleSettings key={r.id} role={r} canWrite={canWrite} />}
            </TabsContent>
          </motion.div>
        </AnimatePresence>
      </Tabs>
    </div>
  );
}
