import type { Metadata, Viewport } from "next";
import { Crimson_Pro, Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "./components/ThemeProvider";
import { ServiceWorkerRegister } from "./components/ServiceWorkerRegister";
import { OfflineIndicator } from "./components/OfflineIndicator";
import NotificationPrompt from "./components/NotificationPrompt";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const crimsonPro = Crimson_Pro({
  variable: "--font-serif",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Daniel & Huaiyao",
  description: "Some fun stuff we made",
  manifest: "/manifest.json",
  icons: {
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>👋</text></svg>",
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
  maximumScale: 1,
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
      </head>
      <body
        className={`${inter.variable} ${crimsonPro.variable} font-sans antialiased`}
      >
        <ThemeProvider>
          <OfflineIndicator />
          {children}
          <ServiceWorkerRegister />
          <NotificationPrompt />
        </ThemeProvider>
      </body>
    </html>
  );
}
