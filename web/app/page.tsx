"use client";
import { AuthGate } from "@/components/AuthGate";
import { Shell } from "@/components/Shell";
import { StoreProvider } from "@/state/store";

export default function Page() {
  return (
    <AuthGate>
      <StoreProvider>
        <Shell />
      </StoreProvider>
    </AuthGate>
  );
}
