import { describe, expect, it } from "vitest";
import {
  eraseConfirmationMatches,
  exportUiState,
  formatBytes,
  isExportWorking,
  notificationKindMeta,
  relativeTime,
  safeInternalLink,
  validateRetentionDays,
} from "@/lib/compliance-logic";

describe("notificationKindMeta", () => {
  it("maps known kinds to distinct icons", () => {
    const kinds = ["analysis", "ranking", "export", "bot_failed", "transcript_ready", "calendar_reauth"];
    const icons = kinds.map((k) => notificationKindMeta(k).icon);
    expect(new Set(icons).size).toBe(kinds.length);
    expect(notificationKindMeta("bot_failed").label).toBe("Notetaker");
  });
  it("falls back to a generic icon", () => {
    expect(notificationKindMeta("something_new")).toEqual({ icon: "notifications", label: "Notification" });
  });
});

describe("safeInternalLink", () => {
  it("allows only app-relative paths", () => {
    expect(safeInternalLink("/settings?tab=privacy")).toBe("/settings?tab=privacy");
    expect(safeInternalLink("https://evil.example")).toBeNull();
    expect(safeInternalLink("//evil.example")).toBeNull();
    expect(safeInternalLink(null)).toBeNull();
  });
});

describe("relativeTime", () => {
  const now = new Date("2030-01-10T12:00:00Z").getTime();
  const ago = (ms: number) => new Date(now - ms).toISOString();
  it("formats buckets", () => {
    expect(relativeTime(ago(10_000), now)).toBe("just now");
    expect(relativeTime(ago(5 * 60_000), now)).toBe("5 min ago");
    expect(relativeTime(ago(3 * 3_600_000), now)).toBe("3 h ago");
    expect(relativeTime(ago(2 * 86_400_000), now)).toBe("2 d ago");
  });
  it("uses a date after a week and tolerates future/invalid input", () => {
    expect(relativeTime(ago(30 * 86_400_000), now)).toMatch(/2029/);
    expect(relativeTime(new Date(now + 60_000).toISOString(), now)).toBe("just now");
    expect(relativeTime("nope", now)).toBe("");
  });
});

describe("validateRetentionDays", () => {
  it("accepts 1..3650", () => {
    expect(validateRetentionDays("1")).toEqual({ value: 1, error: null });
    expect(validateRetentionDays(" 3650 ")).toEqual({ value: 3650, error: null });
  });
  it("rejects out of range and non-integers", () => {
    for (const bad of ["0", "3651", "-5", "1.5", "", "abc", "1e3"]) {
      const r = validateRetentionDays(bad);
      expect(r.value).toBeNull();
      expect(r.error).toBeTruthy();
    }
  });
});

describe("exportUiState", () => {
  it("maps statuses to UI states", () => {
    expect(exportUiState("none")).toBe("none");
    expect(exportUiState(undefined)).toBe("none");
    expect(exportUiState("queued")).toBe("working");
    expect(exportUiState("running")).toBe("working");
    expect(exportUiState("completed")).toBe("completed");
    expect(exportUiState("failed")).toBe("failed");
    expect(exportUiState("expired")).toBe("expired");
  });
  it("polls only while working", () => {
    expect(isExportWorking("queued")).toBe(true);
    expect(isExportWorking("completed")).toBe(false);
  });
  it("formats sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(null)).toBe("unknown size");
  });
});

describe("eraseConfirmationMatches", () => {
  it("accepts the name or ERASE, ignoring case and padding", () => {
    expect(eraseConfirmationMatches("Ada Lovelace", "Ada Lovelace")).toBe(true);
    expect(eraseConfirmationMatches("  ada lovelace ", "Ada Lovelace")).toBe(true);
    expect(eraseConfirmationMatches("ERASE", "Ada Lovelace")).toBe(true);
    expect(eraseConfirmationMatches("erase", "Ada Lovelace")).toBe(true);
  });
  it("rejects partial or empty input", () => {
    expect(eraseConfirmationMatches("", "Ada Lovelace")).toBe(false);
    expect(eraseConfirmationMatches("Ada", "Ada Lovelace")).toBe(false);
    expect(eraseConfirmationMatches("eras", "Ada Lovelace")).toBe(false);
  });
});
