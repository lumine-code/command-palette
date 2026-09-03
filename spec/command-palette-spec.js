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
    const clearRecent = lumine.commands.dispatch(workspaceElement, "command-palette:clear-recent");
    const pack = await activation;
    await clearRecent;
    mainModule = pack.mainModule;
    palette = mainModule.list;
  });

  afterEach(async () => {
    await lumine.packages.deactivatePackage("command-palette");
    for (const disposable of commandDisposables) disposable.dispose();
  });

  async function openPalette(command = "command-palette:toggle") {
    await lumine.commands.dispatch(workspaceElement, command);
    await lumine.views.getNextUpdatePromise();
    return palette.selectListView;
  }

  function listedCommandNames() {
    const items = palette.selectListView.getElement().querySelectorAll("li[data-event-name]");
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
      expect(selectListView.getItems().length).toBe(visibleCommands.length);
      expect(
        selectListView.getItems().some((command) => command.name === "command-palette-spec:noop"),
      ).toBe(true);
      expect(names.length).toBe(Math.min(visibleCommands.length, 99));
      if (visibleCommands.length > 99) {
        expect(selectListView.getElement().querySelector(".show-more-item")).not.toBeNull();
      }
    });

    it("loads every command presentation in one registry batch", () => {
      const visible = { name: "command-palette-spec:visible" };
      const hidden = { name: "command-palette-spec:hidden", hiddenInCommandPalette: true };
      const batch = spyOn(lumine.commands, "getCommandPresentations").and.returnValue([
        visible,
        hidden,
      ]);
      spyOn(lumine.commands, "findCommands").and.throwError("used the unbatched command lookup");
      spyOn(lumine.commands, "getCommandPresentation").and.throwError(
        "used the single-command presentation lookup",
      );
      palette.activeElement = workspaceElement;
      palette.showHiddenCommands = false;

      expect(palette.loadCommands()).toEqual([visible]);
      expect(batch.calls.count()).toBe(1);
      expect(batch).toHaveBeenCalledWith({
        target: workspaceElement,
        bindingTarget: workspaceElement,
      });
    });

    it("hides the palette when it is already visible", async () => {
      const selectListView = await openPalette();
      expect(selectListView.isVisible()).toBe(true);
      await lumine.commands.dispatch(workspaceElement, "command-palette:toggle");
      expect(selectListView.isVisible()).toBe(false);
    });

    it("shows the keybindings bound to the listed commands", async () => {
      await openPalette();
      const toggleItem = palette.selectListView
        .getElement()
        .querySelector("li[data-event-name='command-palette:toggle']");
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
      const item = palette.selectListView
        .getElement()
        .querySelector("li[data-event-name='command-palette-spec:noop']");

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
      return palette.selectListView.getElement().querySelector(NOOP_SECONDARY);
    }

    async function dispatchToggle() {
      await lumine.commands.dispatch(
        palette.selectListView.getQueryEditor().element,
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
      selectListView.getQueryEditor().setText("zzyzx");
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
      selectListView.getQueryEditor().setText("zzyzx");
      await lumine.views.getNextUpdatePromise();
      expect(listedCommandNames()).not.toContain("command-palette-spec:noop");
    });

    it("is bound to ctrl-d inside the palette", async () => {
      const selectListView = await openPalette();
      const bindings = lumine.keymaps.findKeyBindings({
        target: selectListView.getQueryEditor().element,
        command: "command-palette:toggle-descriptions",
      });

      expect(bindings.map((binding) => binding.keystrokes)).toContain("ctrl-d");
    });
  });

  describe("recently used commands", () => {
    it("records confirmed commands and serializes them", async () => {
      const selectList = await openPalette();
      const item = palette.commands.find((command) => command.name === "command-palette-spec:noop");
      expect(item).toBeDefined();
      await selectList.selectItem(item);
      await selectList.confirmSelection();

      expect(selectList.getRecentItemIds()[0]).toBe("command-palette-spec:noop");
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
      const selectList = await openPalette();
      const item = palette.commands.find(
        (command) => command.name === "command-palette-spec:confirm-me",
      );
      expect(item).toBeDefined();
      await selectList.selectItem(item);
      await selectList.confirmSelection();
      expect(dispatched).toBe(true);
    });

    it("runs the selected command through its semantic action exactly once", async () => {
      let dispatchCount = 0;
      commandDisposables.push(
        lumine.commands.add("lumine-workspace", "command-palette-spec:run-once", {
          didDispatch() {
            dispatchCount++;
          },
        }),
      );
      const selectList = await openPalette();
      const item = palette.commands.find(
        (command) => command.name === "command-palette-spec:run-once",
      );
      await selectList.selectItem(item);

      await selectList.showActions();
      const actionsList = workspaceElement.querySelector(".select-list-actions");
      await lumine.commands.dispatch(actionsList, "command-palette:run-selected-command");

      expect(dispatchCount).toBe(1);
      expect(selectList.getRecentItemIds()[0]).toBe("command-palette-spec:run-once");
      expect(selectList.isVisible()).toBe(false);
    });

    it("drops one command from the section without closing the palette", async () => {
      const selectList = await openPalette();
      const item = palette.commands.find((command) => command.name === "command-palette-spec:noop");
      await selectList.recordRecentItem(item);
      await selectList.selectItem(item);

      await selectList.runAction("select-list:remove-recent");

      expect(selectList.getRecentItemIds()).toEqual([]);
      expect(selectList.isVisible()).toBe(true);
      expect(selectList.getSelectedItem().name).toBe("command-palette-spec:noop");
    });

    it("offers the action only while a recent command is selected", async () => {
      const selectList = await openPalette();
      const item = palette.commands.find((command) => command.name === "command-palette-spec:noop");
      const other = palette.commands.find((command) => command.name !== item.name);
      await selectList.recordRecentItem(item);

      await selectList.selectItem(item);
      let actions = selectList.getAvailableActions().map((action) => action.command);
      expect(actions).toContain("select-list:remove-recent");

      await selectList.selectItem(other);
      actions = selectList.getAvailableActions().map((action) => action.command);
      expect(actions).not.toContain("select-list:remove-recent");
      expect(actions).toContain("command-palette:toggle-descriptions");
    });

    it("caps the list at the configured recent count", async () => {
      lumine.config.set("command-palette.recentCount", 2);
      const selectList = await openPalette();
      const items = selectList.getItems().slice(0, 3);
      for (const item of items) await selectList.recordRecentItem(item);
      expect(selectList.getRecentItemIds()).toEqual([items[2].name, items[1].name]);
    });

    it("separates recent commands from the rest of the rendered list", async () => {
      const selectList = await openPalette();
      const item = palette.commands.find((command) => command.name === "command-palette-spec:noop");
      await selectList.recordRecentItem(item);

      const selectListView = await openPalette();
      const separator = selectListView.getElement().querySelector(".select-list-separator");
      expect(separator.previousElementSibling.dataset.eventName).toBe("command-palette-spec:noop");
      expect(separator.nextElementSibling.dataset.eventName).toBeTruthy();
      expect(listedCommandNames()[0]).toBe("command-palette-spec:noop");

      selectListView.getQueryEditor().setText("noop");
      await lumine.views.getNextUpdatePromise();
      expect(selectListView.getElement().querySelector(".select-list-separator")).toBeNull();
    });

    it("clears the list with command-palette:clear-recent", async () => {
      const selectList = await openPalette();
      const item = palette.commands.find((command) => command.name === "command-palette-spec:noop");
      await selectList.recordRecentItem(item);
      expect(selectList.getRecentItemIds().length).toBe(1);

      await lumine.commands.dispatch(workspaceElement, "command-palette:clear-recent");
      expect(selectList.getRecentItemIds()).toEqual([]);
    });

    it("restores recently used commands from serialized state", async () => {
      const CommandPalette = require("../lib/list");
      const restored = new CommandPalette(["command-palette-spec:noop"]);
      expect(restored.selectListView.getRecentItemIds()).toEqual(["command-palette-spec:noop"]);
      await restored.destroy();
    });
  });

  describe("query handling", () => {
    it("resets the query on reopen, and restores it on request", async () => {
      const selectListView = await openPalette();
      selectListView.getQueryEditor().setText("noop");
      palette.hide();

      palette.show();
      expect(selectListView.getQuery()).toBe("");

      selectListView.restoreQuery();
      expect(selectListView.getQuery()).toBe("noop");
    });

    it("matches spaced display names when the query uses hyphens", async () => {
      const selectListView = await openPalette();
      selectListView.getQueryEditor().setText("palette-spec-noop");
      await lumine.views.getNextUpdatePromise();
      expect(listedCommandNames()).toEqual(["command-palette-spec:noop"]);
    });
  });

  describe("item actions", () => {
    it("derives its actions from the command registration", async () => {
      const selectList = await openPalette();
      const item = palette.commands.find((command) => command.name === "command-palette-spec:noop");
      await selectList.selectItem(item);
      const actions = selectList.getAvailableActions();
      const byCommand = new Map(actions.map((action) => [action.command, action]));

      const runSelected = byCommand.get("command-palette:run-selected-command");
      expect(runSelected.name).toBe("Run Selected Command");
      expect(runSelected.description).toBe(
        "Run the selected command on the element that opened the palette.",
      );
      expect(runSelected.keystrokes).toEqual(["enter"]);

      const toggleHidden = byCommand.get("command-palette:toggle-hidden-commands");
      expect(toggleHidden.name).toBe("Toggle Hidden Commands");
      expect(toggleHidden.description).toBe(
        "Include the commands hidden from the palette by their packages.",
      );
      expect(toggleHidden.keystrokes).toEqual(["ctrl-h"]);
      // It changes what the list shows rather than acting on the selected row.
      expect(toggleHidden.context).toBe("dialog");

      const toggleDescriptions = byCommand.get("command-palette:toggle-descriptions");
      expect(toggleDescriptions.name).toBe("Toggle Descriptions");
      expect(toggleDescriptions.description).toBe(
        "Show each command's description, and match the query against it.",
      );
      expect(toggleDescriptions.keystrokes).toEqual(["ctrl-d"]);
      expect(toggleDescriptions.context).toBe("dialog");

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

    it("keeps clear recent available without a match while history exists", async () => {
      const selectList = await openPalette();
      await selectList.setRecentItemIds(["command-palette-spec:noop"]);
      selectList.getQueryEditor().setText("no-command-can-match-this-query-zzyzx");
      await lumine.views.getNextUpdatePromise();

      const actions = selectList.getAvailableActions();
      const byCommand = new Map(actions.map((action) => [action.command, action]));
      expect(selectList.getSelectedItem()).toBeNull();
      expect(byCommand.has("command-palette:run-selected-command")).toBe(false);
      expect(byCommand.get("select-list:clear-recents").context).toBe("dialog");
      expect(byCommand.has("command-palette:toggle-hidden-commands")).toBe(true);
      expect(byCommand.has("command-palette:toggle-descriptions")).toBe(true);
    });

    it("shows the actions as a flow step and toggles the hidden commands", async () => {
      await openPalette();
      expect(listedCommandNames()).toContain("command-palette-spec:noop");

      await palette.selectListView.showActions();

      const actionsList = workspaceElement.querySelector(".select-list-actions");
      expect(actionsList).not.toBeNull();
      expect(lumine.workspace.getModalTrail()).toEqual(["Commands", "Actions"]);
      expect(actionsList.classList.contains("command-palette")).toBe(false);

      await lumine.commands.dispatch(actionsList, "command-palette:toggle-hidden-commands");

      expect(palette.selectListView.isVisible()).toBe(true);
      expect(palette.showHiddenCommands).toBe(true);
      await lumine.views.getNextUpdatePromise();
      const names = listedCommandNames();
      expect(names).toContain("command-palette-spec:hidden");
      expect(names).not.toContain("command-palette-spec:noop");
    });

    // Returning from the shared action picker resumes the palette instead of
    // opening it afresh, so display state must survive that round trip.
    it("shows the descriptions when run from the actions list", async () => {
      await openPalette();
      await palette.selectListView.showActions();

      const actionsList = workspaceElement.querySelector(".select-list-actions");
      await lumine.commands.dispatch(actionsList, "command-palette:toggle-descriptions");

      expect(palette.showDescriptions).toBe(true);
      await lumine.views.getNextUpdatePromise();
      expect(
        palette.selectListView
          .getElement()
          .querySelector("li[data-event-name='command-palette-spec:noop'] .secondary-line"),
      ).not.toBeNull();
    });

    it("toggles back to the visible commands on a second dispatch", async () => {
      const selectListView = await openPalette();
      const queryElement = selectListView.getQueryEditor().element;

      await lumine.commands.dispatch(queryElement, "command-palette:toggle-hidden-commands");
      await lumine.views.getNextUpdatePromise();
      expect(listedCommandNames()).toContain("command-palette-spec:hidden");

      await lumine.commands.dispatch(queryElement, "command-palette:toggle-hidden-commands");
      await lumine.views.getNextUpdatePromise();
      const names = listedCommandNames();
      expect(names).toContain("command-palette-spec:noop");
      expect(names).not.toContain("command-palette-spec:hidden");
    });
  });
});
