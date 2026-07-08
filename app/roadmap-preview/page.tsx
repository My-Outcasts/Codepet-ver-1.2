// Standalone preview of the phase-1 Overview roadmap. Renders the read-only RoadmapView on
// the canonical company-building template, decoupled from the app shell/nav so it can be
// eyeballed on the Vercel preview without touching the (concurrently-evolving) Overview.
// Not linked from anywhere in the app — reach it directly at /roadmap-preview.
import RoadmapView from '@/components/views/overview/RoadmapView';

export const metadata = { title: 'Roadmap preview — Codepet' };

export default function RoadmapPreviewPage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        background:
          'radial-gradient(1100px 620px at 78% -8%, rgba(139,92,246,0.16), transparent 60%), #05040b',
        color: '#f5f3ff',
        fontFamily: 'ui-sans-serif, -apple-system, Segoe UI, Roboto, sans-serif',
        padding: '40px 28px 80px',
      }}
    >
      <div style={{ maxWidth: 1160, margin: '0 auto' }}>
        <div
          style={{
            fontFamily: 'ui-monospace, monospace',
            fontSize: 11,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: '#7de3ff',
          }}
        >
          Codepet · Overview · phase 1 preview
        </div>
        <h1
          style={{
            fontFamily: 'Georgia, serif',
            fontSize: 30,
            fontWeight: 600,
            margin: '10px 0 4px',
          }}
        >
          The company-building roadmap
        </h1>
        <p
          style={{
            color: 'rgba(245,243,255,0.55)',
            fontSize: 14,
            margin: '0 0 26px',
            maxWidth: '60ch',
          }}
        >
          Read-only render of the canonical journey — phases across, departments per task, the
          critical path lit out of byte&rsquo;s current move. Data + geometry come from the pure,
          unit-tested layout engine.
        </p>
        <div
          style={{
            border: '1px solid rgba(245,243,255,0.16)',
            borderRadius: 20,
            background:
              'radial-gradient(700px 380px at 82% -20%, rgba(139,92,246,0.14), transparent 60%), #07060f',
            padding: 16,
          }}
        >
          <RoadmapView projectName="Fernweh" />
        </div>
      </div>
    </main>
  );
}
