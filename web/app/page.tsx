"use client";
import { Shell } from "@/components/Shell";
import { StoreProvider } from "@/state/store";

export default function Page() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
