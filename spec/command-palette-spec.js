describe("command-palette", () => {
  let workspaceElement, mainModule, palette, commandDisposables;

  beforeEach(async () => {
    workspaceElement = lumine.views.getView(lumine.workspace);
    jasmine.attachToDOM(workspaceElement);
    commandDisposables = [];
    commandDisposables.push(
      lumine.commands.add("lumine-workspace", "command-palette-spec:noop", {
        // The nonsense word is what makes a description-only query provable:
        // nothing else in the registry can match it.
        description: "A command with a description mentioning zzyzx.",
        didDispatch() {},
      }),
      lumine.commands.add("lumine-workspace", "command-palette-spec:hidden", {
        didDispatch() {},
        hiddenInCommandPalette: true,
      }),
    );
    // The package defers activation until one of its commands is dispatched,
    // so trigger it with the side-effect-free clear-recent command.
    const activation = lumine.packages.activatePackage("command-palette");
    lumine.commands.dispatch(workspaceElement, "command-palette:clear-recent");
    const pack = await activation;
    mainModule = pack.mainModule;
    palette = mainModule.list;
  });

  afterEach(() => {
    palette?.hide();
    for (const disposable of commandDisposables) disposable.dispose();
  });

  async function openPalette(command = "command-palette:toggle") {
    lumine.commands.dispatch(workspaceElement, command);
    await lumine.views.getNextUpdatePromise();
    return palette.selectListView;
  }

  function listedCommandNames() {
    const items = palette.selectListView.element.querySelectorAll("li[data-event-name]");
    return Array.from(items, (li) => li.dataset.eventName);
  }

  describe("command-palette:toggle", () => {
    it("shows the palette with the commands available for the focused element", async () => {
      const selectListView = await openPalette();
      expect(selectListView.isVisible()).toBe(true);

      const names = listedCommandNames();
      expect(names.length).toBeGreaterThan(0);

      const visibleCommands = lumine.commands
        .findCommands({ target: palette.activeElement })
        .filter((command) => !command.hiddenInCommandPalette);
      // Every available command is in the list; the view renders them in
      // 99-row batches behind the library's Show more row.
      expect(selectListView.props.items.length).toBe(visibleCommands.length);
      expect(
        selectListView.props.items.some((command) => command.name === "command-palette-spec:noop"),
      ).toBe(true);
      expect(names.length).toBe(Math.min(visibleCommands.length, 99));
      if (visibleCommands.length > 99) {
        expect(selectListView.element.querySelector(".show-more-item")).not.toBeNull();
      }
    });

    it("hides the palette when it is already visible", async () => {
      const selectListView = await openPalette();
      expect(selectListView.isVisible()).toBe(true);
      lumine.commands.dispatch(workspaceElement, "command-palette:toggle");
      expect(selectListView.isVisible()).toBe(false);
    });

    it("shows the keybindings bound to the listed commands", async () => {
      await openPalette();
      const toggleItem = palette.selectListView.element.querySelector(
        "li[data-event-name='command-palette:toggle']",
      );
      expect(toggleItem).not.toBeNull();
      const binding = lumine.keymaps
        .findKeyBindings({ target: workspaceElement })
        .find((keyBinding) => keyBinding.command === "command-palette:toggle");
      if (binding) {
        expect(toggleItem.querySelector("kbd.key-binding")).not.toBeNull();
      }
    });

    it("opens on the command names alone, descriptions withheld", async () => {
      await openPalette();
      const item = palette.selectListView.element.querySelector(
        "li[data-event-name='command-palette-spec:noop']",
      );

      expect(palette.showDescriptions).toBe(false);
      expect(item.querySelector(".secondary-line")).toBeNull();
    });
  });

  describe("command-palette:show-hidden-commands", () => {
    it("lists only the commands hidden from the palette", async () => {
      await openPalette("command-palette:show-hidden-commands");
      const names = listedCommandNames();
      expect(names).toContain("command-palette-spec:hidden");
      expect(names).not.toContain("command-palette-spec:noop");
    });

    it("recomputes the list when toggling between hidden and visible commands", async () => {
      await openPalette();
      expect(listedCommandNames()).toContain("command-palette-spec:noop");
      palette.hide();

      await openPalette("command-palette:show-hidden-commands");
      expect(listedCommandNames()).toContain("command-palette-spec:hidden");
      palette.hide();

      await openPalette();
      const names = listedCommandNames();
      expect(names).toContain("command-palette-spec:noop");
      expect(names).not.toContain("command-palette-spec:hidden");
    });
  });

  describe("command-palette:toggle-descriptions", () => {
    const NOOP_SECONDARY = "li[data-event-name='command-palette-spec:noop'] .secondary-line";

    function secondaryLine() {
      return palette.selectListView.element.querySelector(NOOP_SECONDARY);
    }

    async function dispatchToggle() {
      lumine.commands.dispatch(
        palette.selectListView.refs.queryEditor.element,
        "command-palette:toggle-descriptions",
      );
      await lumine.views.getNextUpdatePromise();
    }

    it("adds the secondary line and takes it away again on a second dispatch", async () => {
      await openPalette();
      expect(secondaryLine()).toBeNull();

      await dispatchToggle();
      expect(palette.showDescriptions).toBe(true);
      expect(secondaryLine().textContent).toBe("A command with a description mentioning zzyzx.");

      await dispatchToggle();
      expect(palette.showDescriptions).toBe(false);
      expect(secondaryLine()).toBeNull();
    });

    it("only matches a description once it is on screen", async () => {
      const selectListView = await openPalette();
      selectListView.refs.queryEditor.setText("zzyzx");
      await lumine.views.getNextUpdatePromise();
      expect(listedCommandNames()).not.toContain("command-palette-spec:noop");

      await dispatchToggle();
      expect(listedCommandNames()).toContain("command-palette-spec:noop");
    });

    it("goes back to the names alone on the next open, filter included", async () => {
      const selectListView = await openPalette();
      await dispatchToggle();
      expect(palette.showDescriptions).toBe(true);
      palette.hide();

      await openPalette();
      expect(palette.showDescriptions).toBe(false);
      // The candidates dropped the descriptions again, not just the rows: the
      // reset marks the list stale, so reopening rebuilds it.
      selectListView.refs.queryEditor.setText("zzyzx");
      await lumine.views.getNextUpdatePromise();
      expect(listedCommandNames()).not.toContain("command-palette-spec:noop");
    });

    it("is bound to f11 inside the palette", async () => {
      const selectListView = await openPalette();
      const bindings = lumine.keymaps.findKeyBindings({
        target: selectListView.refs.queryEditor.element,
        command: "command-palette:toggle-descriptions",
      });

      expect(bindings.map((binding) => binding.keystrokes)).toContain("f11");
    });
  });

  describe("recently used commands", () => {
    it("records confirmed commands and serializes them", async () => {
      await openPalette();
      const item = palette.commands.find((command) => command.name === "command-palette-spec:noop");
      expect(item).toBeDefined();
      palette.selectListView.props.didConfirmSelection(item);

      expect(palette.recentlyUsed[0]).toBe("command-palette-spec:noop");
      expect(mainModule.serialize()).toEqual({ recentlyUsed: ["command-palette-spec:noop"] });
    });

    it("dispatches the confirmed command on the previously focused element", async () => {
      let dispatched = false;
      commandDisposables.push(
        lumine.commands.add("lumine-workspace", "command-palette-spec:confirm-me", {
          didDispatch() {
            dispatched = true;
          },
        }),
      );
      // Focus a fresh element so the cached command list is recomputed.
      palette.lastActiveElement = null;
      await openPalette();
      const item = palette.commands.find(
        (command) => command.name === "command-palette-spec:confirm-me",
      );
      expect(item).toBeDefined();
      palette.selectListView.props.didConfirmSelection(item);
      expect(dispatched).toBe(true);
    });

    it("caps the list at the configured recent count", async () => {
      lumine.config.set("command-palette.recentCount", 2);
      await openPalette();
      for (const name of ["a", "b", "c"]) {
        palette.selectListView.props.didConfirmSelection({ name: `command-palette-spec:${name}` });
      }
      expect(palette.recentlyUsed).toEqual(["command-palette-spec:c", "command-palette-spec:b"]);
    });

    it("separates recent commands from the rest of the rendered list", async () => {
      await openPalette();
      const item = palette.commands.find((command) => command.name === "command-palette-spec:noop");
      palette.selectListView.props.didConfirmSelection(item);

      const selectListView = await openPalette();
      const separator = selectListView.element.querySelector(".select-list-separator");
      expect(separator.previousElementSibling.dataset.eventName).toBe("command-palette-spec:noop");
      expect(separator.nextElementSibling.dataset.eventName).toBeTruthy();
      expect(listedCommandNames()[0]).toBe("command-palette-spec:noop");

      selectListView.refs.queryEditor.setText("noop");
      await lumine.views.getNextUpdatePromise();
      expect(selectListView.element.querySelector(".select-list-separator")).toBeNull();
    });

    it("clears the list with command-palette:clear-recent", async () => {
      await openPalette();
      const item = palette.commands.find((command) => command.name === "command-palette-spec:noop");
      palette.selectListView.props.didConfirmSelection(item);
      expect(palette.recentlyUsed.length).toBe(1);

      lumine.commands.dispatch(workspaceElement, "command-palette:clear-recent");
      expect(palette.recentlyUsed).toEqual([]);
    });

    it("restores recently used commands from serialized state", async () => {
      const CommandPalette = require("../lib/list");
      const restored = new CommandPalette(["command-palette-spec:noop"]);
      expect(restored.recentlyUsed).toEqual(["command-palette-spec:noop"]);
      await restored.destroy();
    });
  });

  describe("query handling", () => {
    it("resets the query on reopen, and restores it on request", async () => {
      const selectListView = await openPalette();
      selectListView.refs.queryEditor.setText("noop");
      palette.hide();

      palette.show();
      expect(selectListView.getQuery()).toBe("");

      selectListView.restoreQuery();
      expect(selectListView.getQuery()).toBe("noop");
    });

    it("matches spaced display names when the query uses hyphens", async () => {
      const selectListView = await openPalette();
      selectListView.refs.queryEditor.setText("palette-spec-noop");
      await lumine.views.getNextUpdatePromise();
      expect(listedCommandNames()).toEqual(["command-palette-spec:noop"]);
    });
  });

  describe("item actions", () => {
    it("derives its actions from the command registration", () => {
      const actions = palette.selectListView.itemActions();
      const byCommand = new Map(actions.map((action) => [action.command, action]));

      const toggleHidden = byCommand.get("command-palette:toggle-hidden-commands");
      expect(toggleHidden.name).toBe("Toggle Hidden Commands");
      expect(toggleHidden.description).toBe(
        "Include the commands hidden from the palette by their packages.",
      );
      expect(toggleHidden.keystrokes).toEqual([]);
      // It changes what the list shows rather than acting on the selected row.
      expect(toggleHidden.scope).toBe("list");

      const toggleDescriptions = byCommand.get("command-palette:toggle-descriptions");
      expect(toggleDescriptions.name).toBe("Toggle Descriptions");
      expect(toggleDescriptions.description).toBe(
        "Show each command's description, and match the query against it.",
      );
      expect(toggleDescriptions.keystrokes).toEqual(["f11"]);
      expect(toggleDescriptions.scope).toBe("list");

      // Every action explains itself with more than a restated title.
      for (const action of actions) {
        expect(action.description).toBeTruthy();
      }

      // Chrome and workspace-scope commands stay out: the actions list shows
      // only what the dialog contributes itself.
      expect(byCommand.has("core:confirm")).toBe(false);
      expect(byCommand.has("select-list:actions")).toBe(false);
      expect(byCommand.has("command-palette:toggle")).toBe(false);
      expect(byCommand.has("command-palette:show-hidden-commands")).toBe(false);
      expect(byCommand.has("command-palette:clear-recent")).toBe(false);
    });

    it("shows the actions as a flow step and toggles the hidden commands", async () => {
      await openPalette();
      expect(listedCommandNames()).toContain("command-palette-spec:noop");

      await palette.selectListView.showItemActions();

      const actionsList = palette.selectListView.itemActionsList;
      expect(actionsList.isVisible()).toBe(true);
      expect(lumine.workspace.getModalTrail()).toEqual(["Commands", "Actions"]);
      // The actions list wears the package class, so its styling applies there.
      expect(actionsList.element.classList.contains("command-palette")).toBe(true);

      const index = actionsList.items.findIndex(
        (item) => item.command === "command-palette:toggle-hidden-commands",
      );
      actionsList.selectIndex(index);
      actionsList.confirmSelection();

      expect(palette.selectListView.isVisible()).toBe(true);
      expect(actionsList.isVisible()).toBe(false);
      expect(palette.showHiddenCommands).toBe(true);
      await lumine.views.getNextUpdatePromise();
      const names = listedCommandNames();
      expect(names).toContain("command-palette-spec:hidden");
      expect(names).not.toContain("command-palette-spec:noop");
    });

    // `runItemAction` re-shows the palette before dispatching, so this is the
    // path that would break if the description reset ran on every show.
    it("shows the descriptions when run from the actions list", async () => {
      await openPalette();
      await palette.selectListView.showItemActions();

      const actionsList = palette.selectListView.itemActionsList;
      const index = actionsList.items.findIndex(
        (item) => item.command === "command-palette:toggle-descriptions",
      );
      actionsList.selectIndex(index);
      actionsList.confirmSelection();

      expect(palette.showDescriptions).toBe(true);
      await lumine.views.getNextUpdatePromise();
      expect(
        palette.selectListView.element.querySelector(
          "li[data-event-name='command-palette-spec:noop'] .secondary-line",
        ),
      ).not.toBeNull();
    });

    it("toggles back to the visible commands on a second dispatch", async () => {
      const selectListView = await openPalette();
      const queryElement = selectListView.refs.queryEditor.element;

      lumine.commands.dispatch(queryElement, "command-palette:toggle-hidden-commands");
      await lumine.views.getNextUpdatePromise();
      expect(listedCommandNames()).toContain("command-palette-spec:hidden");

      lumine.commands.dispatch(queryElement, "command-palette:toggle-hidden-commands");
      await lumine.views.getNextUpdatePromise();
      const names = listedCommandNames();
      expect(names).toContain("command-palette-spec:noop");
      expect(names).not.toContain("command-palette-spec:hidden");
    });
  });
});
