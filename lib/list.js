const { humanizeKeystroke } = require("./humankeys");

class CommandPalette {
  constructor(recentlyUsed) {
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
        adapter: {
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
        const li = document.createElement("li");
        li.classList.add("event", "two-lines");
        li.dataset.eventName = item.name;

        const rightBlock = document.createElement("div");
        rightBlock.classList.add("pull-right");
        for (const keystrokes of item.keystrokes) {
          const kbd = document.createElement("kbd");
          kbd.classList.add("key-binding");
          kbd.textContent = humanizeKeystroke(keystrokes);
          rightBlock.appendChild(kbd);
        }
        li.appendChild(rightBlock);

        const leftBlock = document.createElement("div");
        const titleElement = document.createElement("div");
        titleElement.classList.add("primary-line");
        titleElement.title = item.name;
        titleElement.appendChild(highlight(item.displayName));
        leftBlock.appendChild(titleElement);

        if (this.showDescriptions && item.description) {
          const descriptionElement = document.createElement("div");
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
          didDispatch: (event) => this.runSelectedCommand(event.detail.item),
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
          disposition: "close",
          recordsRecent: true,
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
      className: "command-palette",
      crumb: "Commands",
    });
    this.selectList = this.selectListHost.getModel();

    this.configObserver = lumine.config.onDidChange("command-palette.recentCount", ({ newValue }) =>
      this.selectList.setRecentLimit(newValue),
    );
  }

  destroy() {
    this.configObserver.dispose();
    return this.selectListHost.destroy();
  }

  runSelectedCommand(item) {
    if (!item || !this.activeElement) return;
    const event = new CustomEvent(item.name, {
      bubbles: true,
      cancelable: true,
    });
    this.activeElement.dispatchEvent(event);
  }

  loadCommands() {
    this.commands = lumine.commands
      .getCommandPresentations({
        target: this.activeElement,
        bindingTarget: this.activeElement,
      })
      .filter((command) => this.showHiddenCommands === Boolean(command.hiddenInCommandPalette));
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
    this.captureActiveElement();
    return this.selectListHost.show();
  }

  hide() {
    return this.selectListHost.hide();
  }

  captureActiveElement() {
    this.activeElement =
      document.activeElement === document.body
        ? lumine.views.getView(lumine.workspace)
        : document.activeElement;
  }
}

module.exports = CommandPalette;
