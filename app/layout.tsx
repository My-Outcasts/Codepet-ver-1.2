import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Codepet — your AI building companion',
  description:
    'Run your whole company with AI, department by department. Codepet drafts and builds with you — you approve every move.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the pre-paint script in <head> stamps data-theme on <html>
    // before hydration, so the server-vs-client attribute diff is intentional.
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;450;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Google+Sans+Flex:opsz,wght@6..144,300..700&display=swap"
          rel="stylesheet"
        />
        <link rel="preload" as="image" href="/splash.webp" />
        {/* Set the theme before first paint so there's no light→dark flash. Reads the saved
            preference (or falls back to the OS setting) and stamps data-theme on <html>;
            lib/theme's ThemeProvider then keeps it in sync. Kept tiny and dependency-free. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var p=localStorage.getItem('codepet-theme');var d=p==='dark'||((p==='system'||!p)&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light';}catch(e){}})();`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
