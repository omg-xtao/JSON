"use client";

import { useEffect } from "react";
import { ThemeProvider } from "@/components/ui/ThemeProvider";
import { registerServiceWorker } from "@/lib/pwa";

type ProvidersProps = {
  children: React.ReactNode;
};

export function Providers({ children }: ProvidersProps) {
  useEffect(() => {
    return registerServiceWorker();
  }, []);

  return <ThemeProvider>{children}</ThemeProvider>;
}
