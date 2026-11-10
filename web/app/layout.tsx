import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = { title: "BotTeam", description: "Your own team of AI bots, in a chat app." };
export const viewport: Viewport = { themeColor: "#070707", viewportFit: "cover" };

// Applied before first paint so a saved skin never flashes.
const BOOT = `try{var d=document.documentElement,s=localStorage.getItem("botteam-skin");if(!s||s==="system")s=matchMedia("(prefers-color-scheme: dark)").matches?"midnight":"daylight";d.dataset.skin=s;var w=localStorage.getItem("botteam-chat-width");if(w)d.dataset.chatWidth=w}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-skin="daylight" className="h-full antialiased" suppressHydrationWarning>
      <body className="h-full overflow-hidden">
        <Script id="boot-prefs" strategy="beforeInteractive">
          {BOOT}
        </Script>
        {children}
      </body>
    </html>
  );
}
