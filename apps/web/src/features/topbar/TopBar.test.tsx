import { expect, test } from "bun:test";
import { WorkspaceSchema } from "@structsmith/contracts";
import { QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { TooltipProvider } from "@/components/ui/tooltip";
import i18n from "@/i18n";
import { queryClient } from "@/lib/query";
import { ThemeProvider } from "@/lib/theme";
import { TopBar } from "./TopBar";

test("workspace Settings has an icon and appears immediately before Add", async () => {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const language = i18n.language;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { matchMedia: () => ({ matches: false }) },
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: () => null },
  });
  try {
    await i18n.changeLanguage("en");
    const workspace = WorkspaceSchema.parse({
      id: "test",
      name: "Test",
      description: null,
      mode: "relaxed",
      revision: 1,
      createdAt: "2026-11-16",
      updatedAt: "2026-11-16",
    });
    const noop = () => {};
    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <TooltipProvider>
            <TopBar
              productName="StructSmith"
              workspace={workspace}
              workspaces={[workspace]}
              views={[]}
              activeView={null}
              canUndo={false}
              canRedo={false}
              mcpReadOnly={false}
              onSelectWorkspace={noop}
              onSelectView={noop}
              onDeleteView={noop}
              onAutoLayout={noop}
              onFitView={noop}
              onUndo={noop}
              onRedo={noop}
              onOpenMcp={noop}
              onGoHome={noop}
            />
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>,
    );
    const buttons = markup.match(/<button\b[\s\S]*?<\/button>/g) ?? [];
    const settingsIndex = buttons.findIndex((button) => button.includes("Settings</button>"));
    expect(settingsIndex).toBeGreaterThanOrEqual(0);
    expect(buttons[settingsIndex]).toContain("<svg");
    expect(buttons[settingsIndex + 1]).toContain("Add</button>");
  } finally {
    if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
    else Reflect.deleteProperty(globalThis, "window");
    if (storageDescriptor) Object.defineProperty(globalThis, "localStorage", storageDescriptor);
    else Reflect.deleteProperty(globalThis, "localStorage");
    await i18n.changeLanguage(language);
  }
});
