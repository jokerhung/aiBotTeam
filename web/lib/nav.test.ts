import { describe, expect, it } from "vitest";
import { GO_KEYS, NAV, PROJECTS_ITEM, VIEWS, hasChatList, isView, itemOf, parseHash, toHash } from "./nav";
import { vi } from "./i18n-vi";
import { initialState, reducer, type AppState } from "../state/store";

describe("menu table", () => {
  it("lists every page of the plan once, and the empty ones are marked", () => {
    const views = NAV.flatMap((g) => g.items.map((i) => i.view));
    expect(views).toEqual(["dashboard", "chat", "inbox", "agents", "workflows", "routines", "bases", "documents", "resources", "skills", "apps", "input"]);
    expect(new Set(views).size).toBe(views.length);
    expect(NAV.flatMap((g) => g.items).filter((i) => i.placeholder).map((i) => i.view)).toEqual(["workflows", "bases", "documents"]);
    expect(PROJECTS_ITEM.view).toBe("projects");
  });

  it("every label has a Vietnamese entry", () => {
    for (const item of [...NAV.flatMap((g) => g.items), PROJECTS_ITEM]) expect(vi[item.label], item.label).toBeTruthy();
    for (const g of NAV) if (g.label) expect(vi[g.label], g.label).toBeTruthy();
  });

  it("knows every view and which ones keep the chat list", () => {
    for (const v of VIEWS) expect(isView(v)).toBe(true);
    expect(isView("nope")).toBe(false);
    expect(VIEWS.filter(hasChatList)).toEqual(["chat", "project", "section"]);
    expect(itemOf("workflows")?.label).toBe("Workflows");
  });
});

describe("go-to keys", () => {
  it("give every page of the menu one distinct letter", () => {
    const pages = [...NAV.flatMap((g) => g.items.map((i) => i.view)), PROJECTS_ITEM.view].sort();
    expect(Object.values(GO_KEYS).sort()).toEqual(pages);
    expect(new Set(Object.keys(GO_KEYS)).size).toBe(Object.keys(GO_KEYS).length);
  });
});

describe("hash route", () => {
  it("preserves explicit resource versions and safely handles malformed links", () => {
    expect(toHash("resources", "res_123", "build", 2)).toBe("#/resources/res_123/v/2");
    expect(parseHash("#/resources/res_123/v/2")).toEqual({ view: "resources", id: "res_123", version: 2 });
    expect(parseHash("#/resources/res_123")).toEqual({ view: "resources", id: "res_123", version: undefined });
    expect(parseHash("#/resources/%E0%A4%A/v/2")).toEqual({ view: "resources" });
    expect(parseHash("#/resources/res_123/v/999999999999999999999")).toBeNull();
    expect(parseHash("#/resources/res_123/v/0")).toBeNull();
    expect(reducer(initialState, { type: "openResource", id: "res_123", version: 2 })).toMatchObject({ view: "resources", resourceId: "res_123", resourceVersion: 2 });
  });
  it("writes and reads a page, with the id only for chat and project", () => {
    expect(toHash("dashboard", "ignored")).toBe("#/dashboard");
    expect(toHash("chat", "bot 1")).toBe("#/chat/bot%201");
    expect(parseHash("#/chat/bot%201")).toEqual({ view: "chat", id: "bot 1" });
    expect(parseHash("#/project/g1")).toEqual({ view: "project", id: "g1" });
    expect(toHash("section", "sec_1")).toBe("#/section/sec_1");
    expect(parseHash("#/section/sec_1")).toEqual({ view: "section", id: "sec_1" });
    expect(parseHash("#/agents")).toEqual({ view: "agents", id: undefined });
    for (const v of VIEWS) expect(parseHash(toHash(v))?.view).toBe(v);
  });

  it("ignores addresses that are not pages", () => {
    expect(parseHash("")).toBeNull();
    expect(parseHash("#/nope")).toBeNull();
    expect(parseHash("#section")).toBeNull();
    expect(parseHash("#/chat/%E0%A4%A")).toEqual({ view: "chat", id: undefined });
  });
});

describe("view in the store", () => {
  const s0: AppState = { ...initialState };

  it("starts on chat and a view action opens a page and closes the drawers and old flags", () => {
    expect(s0.view).toBe("chat");
    const s = reducer({ ...s0, railOpen: true, usageOpen: true, appsOpen: true, automationsOpen: true }, { type: "view", view: "agents" });
    expect(s).toMatchObject({ view: "agents", railOpen: false, usageOpen: false, appsOpen: false, automationsOpen: false });
  });

  it("the older openers land on the matching page", () => {
    expect(reducer(s0, { type: "automations", open: true }).view).toBe("routines");
    expect(reducer(s0, { type: "teamMap", open: true }).view).toBe("team-map");
    expect(reducer(s0, { type: "usage", open: true }).view).toBe("dashboard");
    expect(reducer(s0, { type: "inboxPanel", open: true }).view).toBe("inbox");
    expect(reducer(s0, { type: "apps", open: true }).view).toBe("apps");
    expect(reducer(s0, { type: "apps", open: true, tab: "mcp" }).view).toBe("apps");
    expect(reducer(s0, { type: "apps", open: true, tab: "input" }).view).toBe("input");
  });

  it("closing the page you are on goes back to chat, closing another one changes nothing", () => {
    expect(reducer({ ...s0, view: "routines" }, { type: "automations", open: false }).view).toBe("chat");
    expect(reducer({ ...s0, view: "agents" }, { type: "automations", open: false }).view).toBe("agents");
    expect(reducer({ ...s0, view: "input" }, { type: "apps", open: false }).view).toBe("chat");
  });

  it("choosing a bot or a room opens its chat from any page", () => {
    expect(reducer({ ...s0, view: "skills" }, { type: "select", id: "a" }).view).toBe("chat");
    expect(reducer({ ...s0, view: "skills" }, { type: "selectGroup", id: "g" }).view).toBe("project");
  });

  it("opening a project (a section of bots) shows its page from any page", () => {
    const s = reducer({ ...s0, view: "skills" }, { type: "openSection", id: "sec_1" });
    expect(s).toMatchObject({ view: "section", selectedSectionId: "sec_1", railOpen: false });
  });

  it("choosing a bot of the open project stays in the project; any other bot opens the plain chat", () => {
    const inProject = { ...s0, view: "section" as const, selectedSectionId: "sec_1", bots: [{ id: "a", section: "sec_1" }, { id: "b", section: "sec_2" }] as never };
    expect(reducer(inProject, { type: "select", id: "a" }).view).toBe("section");
    expect(reducer(inProject, { type: "select", id: "b" }).view).toBe("chat");
  });

  it("the rail drawer opens and closes", () => {
    expect(reducer(s0, { type: "rail", open: true }).railOpen).toBe(true);
    expect(reducer({ ...s0, railOpen: true }, { type: "select", id: "a" }).railOpen).toBe(false);
  });
});
