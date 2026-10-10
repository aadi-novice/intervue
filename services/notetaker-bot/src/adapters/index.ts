import { GoogleMeetAdapter } from "./google-meet/index.js";
import { TeamsAdapter } from "./teams/index.js";
import type { MeetingAdapter } from "./types.js";
import { ZoomAdapter } from "./zoom/index.js";

export { AdapterError } from "./types.js";
export type { MeetingAdapter, Platform } from "./types.js";

export function allAdapters(): MeetingAdapter[] {
  return [new GoogleMeetAdapter(), new TeamsAdapter(), new ZoomAdapter()];
}

/** Picks the adapter whose `matches(url)` is true, or null if the platform is unsupported. */
export function selectAdapter(url: string, adapters: MeetingAdapter[] = allAdapters()): MeetingAdapter | null {
  return adapters.find((a) => a.matches(url)) ?? null;
}
