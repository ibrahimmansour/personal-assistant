import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Inter } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { AppearanceProvider } from "@/components/appearance-context";
import { ProfileProvider } from "@/components/profile-context";
import { ThemeColorSync } from "@/components/theme-color-sync";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Personal Assistant",
  description: "Your personal widget-based dashboard",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Personal Assistant",
  },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Page zoom is off. The dashboard is a fixed-chrome app shell — a pinch that
  // scales the whole page shrinks the layout viewport, which our media queries
  // read, so zooming in used to flip a phone toward the desktop grid and leave
  // panels clipped at the edges. The accessibility need it served is covered
  // instead by the five text-size steps (header text-size button, appearance
  // picker, command palette), which grow the type inside a layout that holds
  // still. Note mobile Safari ignores both of these flags by design; the
  // font-size floor on inputs in globals.css covers what that lets through.
  userScalable: false,
  maximumScale: 1,
  viewportFit: "cover",
  // Shrink the layout viewport when the on-screen keyboard opens instead of
  // panning it — without this, `fixed inset-0` overlays (expanded widgets)
  // get scrolled so their header (with the collapse button) ends up off
  // -screen above the keyboard on focus.
  interactiveWidget: "resizes-content",
  // Single tag, kept on the real page background at runtime by
  // <ThemeColorSync>. The media-scoped pair this replaced tracked the OS
  // preference, which is the wrong signal: the theme is class-driven and the
  // accent picker rewrites --background, so a dark-OS user on the light theme
  // got a near-black status bar above a white page. This value is only the
  // pre-hydration default.
  themeColor: "#ffffff",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${inter.variable}`}
    >
      <body className="min-h-screen bg-background antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <ThemeColorSync />
          <AppearanceProvider>
            <ProfileProvider>
              {children}
            </ProfileProvider>
          </AppearanceProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
