const { isDeepStrictEqual } = require("node:util");
const { humanizeKeystroke } = require("./humankeys");

class CommandPalette {
  constructor(recentlyUsed, window = lumine.workspace.getMainWindow(), recentAdapter = null) {
    this.window = window;
    this.document = window.getDocument();
    this.commands = [];
    this.showHiddenCommands = false;
    // The palette opens on the names alone: with a description on nearly every
    // command in the ecosystem, a second line on every row is what the list
    // costs to scan. Ctrl-D brings them back for the open palette only.
    this.showDescriptions = false;
    this.activeElement = null;

    const recentItemIds = [
      ...new Set(
        (Array.isArray(recentlyUsed) ? recentlyUsed : []).filter(
          (command) => typeof command === "string",
        ),
      ),
    ];

    const selectListOptions = {
      emptyMessage: "No matches found",
      getItemId: (item) => item.name,
      search: {
        // Command names are hyphenated (`editor:fold-all`) while their display
        // names are spaced (`Editor: Fold All`), so treat a typed `-` as a space.
        parseQuery: (query) => query.replace(/-/g, " "),
        // The rendered row is the filter surface. Descriptions participate only
        // while they are visible, so a match can never point at hidden text.
        getFilterText: (item) => {
          let text = item.displayName;
          if (item.tags) text += " " + item.tags.join(" ");
          if (this.showDescriptions && item.description) text += " " + item.description;
          return text;
        },
        // Fuzzy results keep their score order. Only the resting list is
        // alphabetical; recents are hoisted by the core model afterwards.
        sort: (left, right, { query }) =>
          query === "" ? left.displayName.localeCompare(right.displayName) : 0,
      },
      recents: {
        limit: lumine.config.get("command-palette.recentCount"),
        adapter: recentAdapter ?? {
          load: () => recentItemIds,
          // Serialization reads the model directly; no parallel mutable copy
          // is needed merely to receive a save notification.
          save: () => {},
        },
      },
      source: {
        mode: "snapshot",
        load: () => this.loadCommands(),
      },
      renderItem: (item, { matchIndices, highlight }) => {
        const li = this.document.createElement("li");
        li.classList.add("event", "two-lines");
        li.dataset.eventName = item.name;
        if (item.enabled === false) {
          li.classList.add("disabled");
          li.setAttribute("aria-disabled", "true");
        }

        const rightBlock = this.document.createElement("div");
        rightBlock.classList.add("pull-right");
        for (const keystrokes of item.keystrokes) {
          const kbd = this.document.createElement("kbd");
          kbd.classList.add("key-binding");
          kbd.textContent = humanizeKeystroke(keystrokes);
          rightBlock.appendChild(kbd);
        }
        li.appendChild(rightBlock);

        const leftBlock = this.document.createElement("div");
        const titleElement = this.document.createElement("div");
        titleElement.classList.add("primary-line");
        titleElement.title = item.name;
        titleElement.appendChild(highlight(item.displayName));
        leftBlock.appendChild(titleElement);

        if (this.showDescriptions && item.description) {
          const descriptionElement = this.document.createElement("div");
          descriptionElement.classList.add("secondary-line");
          descriptionElement.title = item.description;
          const offset =
            item.displayName.length + (item.tags ? item.tags.join(" ").length + 1 : 0) + 1;
          const descriptionMatchIndices = (matchIndices ?? [])
            .map((index) => index - offset)
            .filter((index) => index >= 0);
          descriptionElement.appendChild(highlight(item.description, descriptionMatchIndices));
          leftBlock.appendChild(descriptionElement);
        }

        li.appendChild(leftBlock);
        return li;
      },
      commands: {
        "command-palette:run-selected-command": {
          description: "Run the selected command on the element that opened the palette.",
          isAvailable: ({ detail }) => this.isCommandEnabled(detail?.item),
          didDispatch: (event) => this.runSelectedCommand(event.detail.item, event.detail),
        },
        "command-palette:copy-command-name": {
          description: "Copy the selected command's identifier to the clipboard.",
          isAvailable: ({ detail }) => Boolean(detail?.item?.name),
          didDispatch: (event) => {
            const name = event.detail?.item?.name;
            if (name) lumine.clipboard.write(name);
          },
        },
        "command-palette:toggle-hidden-commands": {
          description: "Include the commands hidden from the palette by their packages.",
          didDispatch: () => this.toggleHiddenCommands(),
        },
        "command-palette:toggle-descriptions": {
          description: "Show each command's description, and match the query against it.",
          didDispatch: () => this.toggleDescriptions(),
        },
      },
      actions: [
        {
          command: "command-palette:run-selected-command",
          context: "item",
          primary: true,
          group: "Run",
          disposition: "stay",
          dispatch: "local",
        },
        {
          command: "command-palette:copy-command-name",
          context: "item",
          group: "Clipboard",
          disposition: "stay",
          dispatch: "local",
        },
        {
          command: "command-palette:toggle-hidden-commands",
          context: "dialog",
          group: "Display",
          disposition: "stay",
          dispatch: "local",
        },
        {
          command: "command-palette:toggle-descriptions",
          context: "dialog",
          group: "Display",
          disposition: "stay",
          dispatch: "local",
        },
      ],
    };
    this.selectListHost = lumine.workspace.addSelectList(selectListOptions, {
      window,
      className: "command-palette",
      crumb: "Commands",
    });
    this.selectList = this.selectListHost.getModel();

    this.configObserver = lumine.config.onDidChange("command-palette.recentCount", ({ newValue }) =>
      this.selectList.setRecentLimit(newValue),
    );
    this.registryObserver = lumine.commands.onDidChange((change) => {
      if (
        change?.target &&
        change.target !== this.activeElement &&
        !change.target.contains?.(this.activeElement)
      )
        return;
      if (!this.selectListHost.isVisible() || this.refreshPending) return;
      this.refreshPending = true;
      queueMicrotask(() => {
        this.refreshPending = false;
        if (this.destroyed || !this.selectListHost.isVisible()) return;
        // An opening load may still hold an older snapshot. Supersede it
        // before it can overwrite a newer registration or availability state.
        if (this.selectList.isLoading()) {
          void this.selectList.reload();
          return;
        }
        // Registry presentations are already available synchronously. Publish
        // the updated catalogue in place so periodic availability changes do
        // not restart the source's loading lifecycle over the visible list.
        const previousCommands = this.commands;
        const commands = this.loadCommands();
        if (!isDeepStrictEqual(previousCommands, commands)) {
          void this.selectList.setItems(commands);
        }
      });
    });
  }

  destroy() {
    this.destroyed = true;
    this.registryObserver.dispose();
    this.configObserver.dispose();
    return this.selectListHost.destroy();
  }

  runSelectedCommand(item, context = this.selectList.getActionContext("command")) {
    if (!this.isCommandEnabled(item)) return false;
    const notifications = lumine.notifications;
    const reportFailure = (error) => {
      if (error?.name === "AbortError") return;
      notifications.addError(`Command failed: ${item.displayName ?? item.name}`, {
        detail: error?.message ?? String(error),
      });
    };
    let dispatched;
    try {
      dispatched = lumine.commands.dispatch(this.activeElement, item.name);
    } catch (error) {
      if (!this.destroyed) this.selectList.requestDisposition("close", { context });
      reportFailure(error);
      return true;
    }
    if (!dispatched) {
      const error = new Error("Command dispatch was declined.");
      error.name = "AbortError";
      throw error;
    }
    // The picker owns dispatch acceptance, not the command's lifetime. In
    // keep-open mode the captured context leaves it ready for another choice.
    void dispatched.catch(reportFailure);
    if (!this.destroyed) {
      this.selectList.requestDisposition("close", { context });
      void this.recordRecentCommand(item, notifications);
    }
    return true;
  }

  async recordRecentCommand(item, notifications) {
    if (this.destroyed) return;
    try {
      await this.selectList.recordRecentItem(item);
    } catch (error) {
      if (error?.name === "AbortError") return;
      notifications.addError("Failed to save recent commands", {
        detail: error?.message ?? String(error),
      });
    }
  }

  isCommandEnabled(item) {
    return Boolean(
      item &&
      this.activeElement?.isConnected &&
      lumine.commands.canDispatch(this.activeElement, item.name),
    );
  }

  loadCommands() {
    this.commands = lumine.commands
      .getCommandPresentations({
        target: this.activeElement,
        bindingTarget: this.activeElement,
      })
      .filter((command) => this.showHiddenCommands === Boolean(command.hiddenInCommandPalette));
    if (!this.activeElement?.isConnected) {
      this.commands = this.commands.map((command) => ({ ...command, enabled: false }));
    }
    return this.commands;
  }

  // Swaps the open palette between the visible commands and the ones packages
  // hide from it, keeping the originally focused command target.
  toggleHiddenCommands() {
    if (!this.selectListHost.isVisible()) return;
    this.showHiddenCommands = !this.showHiddenCommands;
    return this.selectList.reload();
  }

  // Descriptions affect both rendering and candidate text, so refresh the
  // current items atomically and let the list rebuild its filter-text cache.
  toggleDescriptions() {
    if (!this.selectListHost.isVisible()) return;
    this.showDescriptions = !this.showDescriptions;
    return this.selectList.refresh();
  }

  toggle() {
    if (this.selectListHost.isVisible()) return this.selectListHost.hide();
    return this.show();
  }

  show(showHiddenCommands = false) {
    this.showHiddenCommands = showHiddenCommands;
    this.showDescriptions = false;
    if (this.selectListHost.isVisible()) return this.selectList.reload();
    this.captureActiveElement();
    return this.selectListHost.show();
  }

  hide() {
    return this.selectListHost.hide();
  }

  captureActiveElement() {
    this.activeElement =
      this.document.activeElement === this.document.body
        ? this.window.getElement()
        : this.document.activeElement;
  }
}

module.exports = CommandPalette;
