import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = { title: "BotTeam", description: "Your own team of AI bots, in a chat app." };
export const viewport: Viewport = { themeColor: "#070707", viewportFit: "cover" };

interface Look { skin?: string; chatWidth?: string; font?: string; reduceMotion?: boolean; language?: string }

/** The saved look, read from the backend while the page is rendered, so the very first paint already has it
 * (even in a browser that has never visited). Falls back to the browser's own memory when the backend is down. */
async function savedLook(): Promise<Look | null> {
  try {
    const res = await fetch(`${process.env.BOTTEAM_API ?? "http://127.0.0.1:8899"}/api/config`, { cache: "no-store", signal: AbortSignal.timeout(1500) });
    if (!res.ok) return null;
    return ((await res.json()) as { settings?: Look }).settings ?? null;
  } catch {
    return null;
  }
}

// Used only when the server could not say: the skin the browser remembers, else light/dark from the system.
const BOOT = `try{var d=document.documentElement;if(!d.dataset.look){var s=localStorage.getItem("botteam-skin");if(!s||s==="system")s=matchMedia("(prefers-color-scheme: dark)").matches?"midnight":"daylight";d.dataset.skin=s;var w=localStorage.getItem("botteam-chat-width");if(w)d.dataset.chatWidth=w;var f=localStorage.getItem("botteam-font");if(f)d.dataset.font=f;if(localStorage.getItem("botteam-reduce-motion"))d.dataset.reduceMotion=""}}catch(e){}`;


export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const look = await savedLook();
  const attrs: Record<string, string | undefined> = look
    ? {
        "data-look": "server",
        "data-skin": look.skin || "daylight",
        "data-chat-width": look.chatWidth === "wide" ? "wide" : undefined,
        "data-font": look.font || undefined,
        "data-reduce-motion": look.reduceMotion ? "" : undefined,
      }
    : { "data-skin": "daylight" };
  return (
    <html lang={look?.language || "en"} {...attrs} className="h-full antialiased" suppressHydrationWarning>
      <body className="h-full overflow-hidden">
        <Script id="boot-prefs" strategy="beforeInteractive">
          {BOOT}
        </Script>
        {children}
      </body>
    </html>
  );
}
