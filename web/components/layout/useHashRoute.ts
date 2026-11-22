"use client";
import { useEffect, useRef } from "react";
import { parseHash, toHash } from "@/lib/nav";
import { useStore } from "@/state/store";

/** Keeps `view` and the hash in step: a link or the Back button opens the page, and moving between pages writes the hash. */
export function useHashRoute(enabled: boolean) {
  const { state, dispatch } = useStore();
  const live = useRef(state);
  useEffect(() => { live.current = state; });
  const pending = useRef<string | null>(null);
  const ready = state.hydrated;

  useEffect(() => {
    if (!enabled || !ready) return;
    const apply = () => {
      const route = parseHash(window.location.hash);
      if (!route) return;
      const s = live.current;
      const navigate = (action: Parameters<typeof dispatch>[0]) => {
        if (dispatch(action)) return;
        pending.current = null;
        const id = s.view === "agent" ? s.selectedAgentId : s.view === "chat" ? s.selectedId : s.view === "project" ? s.selectedGroupId : s.selectedSectionId;
        window.history.replaceState(null, "", toHash(s.view, id, s.agentTab));
      };
      // the address names the page to open; the writer below waits until the state shows exactly that page (a chat without an id has no fixed target)
      pending.current = route.view === "chat" && !route.id ? null : toHash(route.view, route.id, route.tab);
      if (route.view === "agent") {
        if (s.bots.some((b) => b.id === route.id)) navigate({ type: "openAgent", id: route.id!, tab: route.tab });
        else { pending.current = null; navigate({ type: "view", view: "agents" }); }
      } else if (route.view === "chat" && route.id) {
        if (s.bots.some((b) => b.id === route.id)) navigate({ type: "select", id: route.id });
        else { pending.current = null; navigate({ type: "view", view: "chat" }); }
      } else if (route.view === "project" && route.id) {
        if (s.groups.some((g) => g.id === route.id)) navigate({ type: "selectGroup", id: route.id });
        else { pending.current = null; navigate({ type: "view", view: "projects" }); }
      } else if (route.view === "section" && route.id) {
        if (s.sections.some((x) => x.id === route.id)) navigate({ type: "openSection", id: route.id });
        else { pending.current = null; navigate({ type: "view", view: "projects" }); }
      } else if (route.view === "section") {
        pending.current = null;
        navigate({ type: "view", view: "projects" });
      } else if (route.view === "project") {
        pending.current = null;
        navigate({ type: "view", view: "projects" });
      } else navigate({ type: "view", view: route.view });
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, [enabled, ready, dispatch]);

  useEffect(() => {
    if (!enabled || !ready) return;
    const id = state.view === "agent" ? state.selectedAgentId : state.view === "chat" ? state.selectedId : state.view === "project" ? state.selectedGroupId : state.view === "section" ? state.selectedSectionId : undefined;
    const want = toHash(state.view, id, state.agentTab);
    if (pending.current) {
      if (want !== pending.current) return; // the page named in the address is still being opened
      pending.current = null;
    }
    if (window.location.hash !== want) window.history.pushState(null, "", want);
  }, [enabled, ready, state.view, state.selectedId, state.selectedGroupId, state.selectedSectionId, state.selectedAgentId, state.agentTab]);
}
