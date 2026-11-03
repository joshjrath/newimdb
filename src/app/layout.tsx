import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/Toasts";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "Watch Journal", template: "%s · Watch Journal" },
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: "no-referrer",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

const themeScript = `try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <a className="skip-link" href="#main">Skip to content</a>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
