'use client';
// Client side of byte's roadmap generation. POST /api/roadmap asks byte to lay out a real
// per-company roadmap (returns ready-to-render RoadmapTaskDef[]); GET returns the last one
// byte generated. Best-effort: any failure returns null and the caller keeps the canonical
// template.
import { authHeader } from './runTask';
import type { RoadmapTaskDef } from '../overview/roadmapModel';
import type { CompanyBrief } from '../firebase/schema';

/** Generate a fresh, tailored roadmap for the founder's company. Null on any failure. */
export async function generateRoadmap(brief?: CompanyBrief): Promise<RoadmapTaskDef[] | null> {
  try {
    const res = await fetch('/api/roadmap', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify({ brief }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { roadmap?: RoadmapTaskDef[] | null };
    return data.roadmap?.length ? data.roadmap : null;
  } catch {
    return null;
  }
}

/** Load the founder's last-generated roadmap, or null if none / on failure. */
export async function loadSavedRoadmap(): Promise<RoadmapTaskDef[] | null> {
  try {
    const res = await fetch('/api/roadmap', { headers: await authHeader() });
    if (!res.ok) return null;
    const data = (await res.json()) as { roadmap?: RoadmapTaskDef[] | null };
    return data.roadmap?.length ? data.roadmap : null;
  } catch {
    return null;
  }
}
