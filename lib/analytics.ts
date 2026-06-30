'use client';
// Vendor-agnostic analytics seam — the web mirror of the Swift app's
// Analytics.swift. `track()` is called throughout the app; where the events GO is
// decided by a single pluggable sink. Default sink logs in dev and no-ops in prod
// (the OSLog-equivalent — no vendor SDK shipped). Swap `setAnalyticsSink` for
// Firebase Analytics / Mixpanel / a server beacon without touching call sites.

export type AnalyticsProps = Record<string, string | number | boolean | null | undefined>;

export interface AnalyticsEvent {
  name: string;
  props?: AnalyticsProps;
  /** epoch ms */
  ts: number;
}

export type AnalyticsSink = (event: AnalyticsEvent) => void;

// Default: visible in dev, silent in prod. No external dependency.
const consoleSink: AnalyticsSink = (e) => {
  if (process.env.NODE_ENV !== 'production') {
    console.debug('[analytics]', e.name, e.props ?? {});
  }
};

let sink: AnalyticsSink = consoleSink;

/** Replace the analytics destination (e.g. wire Firebase Analytics at startup). */
export function setAnalyticsSink(next: AnalyticsSink): void {
  sink = next;
}

/** Record an event. Never throws into the caller — a broken sink can't break a click. */
export function track(name: string, props?: AnalyticsProps): void {
  try {
    sink({ name, props, ts: Date.now() });
  } catch (err) {
    console.error('[analytics] sink error', err);
  }
}
