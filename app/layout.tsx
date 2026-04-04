import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ThemeProvider } from "./components/ThemeProvider";
import { ServiceWorkerRegister } from "./components/ServiceWorkerRegister";
import { OfflineIndicator } from "./components/OfflineIndicator";
import NotificationPrompt from "./components/NotificationPrompt";
import { UserBootstrap } from "./components/UserBootstrap";
import AppLaunchSplash from "./components/AppLaunchSplash";

export const metadata: Metadata = {
  title: "Daniel & Huaiyao",
  description: "Some fun stuff we made",
  manifest: "/manifest.json?v=20260308",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: "/icons/icon-192.png",
    apple: "/icons/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Daniel & Huaiyao",
  },
};

export const viewport: Viewport = {
  themeColor: "#8b5cf6",
  width: "device-width",
  initialScale: 1,
};

// Inline script to prevent flash of wrong theme
const themeScript = `
  (function() {
    try {
      var theme = localStorage.getItem('theme');
      var isDark = theme === 'dark' || (theme === 'system' || !theme) && window.matchMedia('(prefers-color-scheme: dark)').matches;
      if (isDark) document.documentElement.classList.add('dark');
    } catch (e) {}
  })();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <link rel="apple-touch-startup-image" href="/icons/apple-touch-icon.png" />
      </head>
      <body
        className="font-sans antialiased"
      >
        <ThemeProvider>
          <UserBootstrap />
          <AppLaunchSplash />
          <OfflineIndicator />
          {children}
          <ServiceWorkerRegister />
          <NotificationPrompt />
        </ThemeProvider>
      </body>
    </html>
  );
}
