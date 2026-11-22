import { useStore } from "@/state/store";

/** True while the workspace layout (left navigation and pages) is on; false for the classic bot list. */
export function useWorkspace(): boolean {
  const { state } = useStore();
  return state.config.settings.layout !== "classic";
}
