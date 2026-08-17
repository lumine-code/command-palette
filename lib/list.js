const { humanizeKeystroke } = require("./humankeys");

class CommandPalette {
  constructor(recentlyUsed) {
    this.keyBindingsForActiveElement = [];
    this.commands = [];
    this.showHiddenCommands = false;
    this.lastShowHiddenCommands = false;
    // The palette opens on the names alone: with a description on nearly every
    // command in the ecosystem, a second line on every row is what the list
    // costs to scan. F11 brings them back, for the open palette only, so every
    // fresh show starts compact again.
    this.showDescriptions = false;
    this.lastActiveElement = null;
    this.recentlyUsed = recentlyUsed || [];
    this.recentCount = lumine.config.get("command-palette.recentCount");
    this.needsUpdate = true;

    this.configObserver = lumine.config.onDidChange(
      "command-palette.recentCount",
      ({ newValue }) => {
        this.recentCount = newValue;
        while (this.recentlyUsed.length > this.recentCount) this.recentlyUsed.pop();
        this.needsUpdate = true;
      },
    );
    this.selectListView = lumine.workspace.buildSelectList({
      className: "command-palette",
      crumb: "Commands",
      emptyMessage: "No matches found",
      // The recently used commands lead the unfiltered list, with the list's
      // own rule under them; `order` is left with the alphabetical fallback
      // for everything else.
      idForItem: (item) => item.name,
      order: (a, b) =>
        this.selectListView.getQuery() === "" ? a.displayName.localeCompare(b.displayName) : 0,

      // Command names are hyphenated (`editor:fold-all`) while their display
      // names are spaced (`Editor: Fold All`), so treat a typed `-` as a space.
      filterQuery: (query) => query.replace(/-/g, " "),

      // The rendered row is the filter surface: with the descriptions hidden a
      // match on one would be a hit on text that is not on screen. This is also
      // what keeps `elementForItem`'s offset honest — it counts the characters
      // this key puts before the description — so the two conditions below are
      // one decision and have to move together.
      filterKeyForItem: (item) => {
        let key = item.displayName;
        if (item.tags) {
          key += " " + item.tags.join(" ");
        }
        if (this.showDescriptions && item.description) {
          key += " " + item.description;
        }
        return key;
      },

      willShow: () => {
        this.activeElement =
          document.activeElement === document.body
            ? lumine.views.getView(lumine.workspace)
            : document.activeElement;
        // The command list depends on both the focused element and the hidden
        // filter, so a change to either one invalidates the cached commands.
        if (
          this.activeElement !== this.lastActiveElement ||
          this.showHiddenCommands !== this.lastShowHiddenCommands
        ) {
          this.refreshCommands();
        }
        if (this.needsUpdate) {
          this.needsUpdate = false;
          this.selectListView.update(this.listProps());
        }
      },

      elementForItem: (item, { matchIndices, highlight }) => {
        const li = document.createElement("li");
        li.classList.add("event", "two-lines");
        li.dataset.eventName = item.name;

        // Key bindings on the right
        const rightBlock = document.createElement("div");
        rightBlock.classList.add("pull-right");
        const seen = new Set();
        this.keyBindingsForActiveElement
          .filter(({ command, keystrokes }) => {
            if (command !== item.name || seen.has(keystrokes)) return false;
            seen.add(keystrokes);
            return true;
          })
          .forEach((keyBinding) => {
            const kbd = document.createElement("kbd");
            kbd.classList.add("key-binding");
            kbd.textContent = humanizeKeystroke(keyBinding.keystrokes);
            rightBlock.appendChild(kbd);
          });
        li.appendChild(rightBlock);

        // Primary line: command name
        const leftBlock = document.createElement("div");
        const titleEl = document.createElement("div");
        titleEl.classList.add("primary-line");
        titleEl.title = item.name;
        titleEl.appendChild(highlight(item.displayName));
        leftBlock.appendChild(titleEl);

        // Secondary line: description
        if (this.showDescriptions && item.description) {
          const secondaryEl = document.createElement("div");
          secondaryEl.classList.add("secondary-line");
          secondaryEl.title = item.description;
          const offset =
            item.displayName.length + (item.tags ? item.tags.join(" ").length + 1 : 0) + 1;
          const descriptionMatchIndices = (matchIndices ?? [])
            .map((index) => index - offset)
            .filter((index) => index >= 0);
          secondaryEl.appendChild(highlight(item.description, descriptionMatchIndices));
          leftBlock.appendChild(secondaryEl);
        }

        li.appendChild(leftBlock);
        return li;
      },

      didConfirmSelection: (item) => {
        this.selectListView.hide();
        const idx = this.recentlyUsed.indexOf(item.name);
        if (idx !== -1) this.recentlyUsed.splice(idx, 1);
        this.recentlyUsed.unshift(item.name);
        while (this.recentlyUsed.length > this.recentCount) this.recentlyUsed.pop();
        this.needsUpdate = true;
        const event = new CustomEvent(item.name, {
          bubbles: true,
          cancelable: true,
        });
        this.activeElement.dispatchEvent(event);
      },

      didCancelSelection: () => {
        this.selectListView.hide();
      },
    });

    // Registered in the package's own namespace on the palette element: the
    // item-actions list (F12) derives its rows — label, description,
    // keybinding — from commands the dialog contributes itself, so this is
    // what makes the mode swap discoverable from inside the palette.
    this.commandsDisposable = lumine.commands.add(this.selectListView.element, {
      "command-palette:toggle-hidden-commands": {
        description: "Include the commands hidden from the palette by their packages.",
        // What the list shows, not what the selected row is.
        actionScope: "list",
        didDispatch: () => this.toggleHiddenCommands(),
      },
      "command-palette:toggle-descriptions": {
        description: "Show each command's description, and match the query against it.",
        actionScope: "list",
        didDispatch: () => this.toggleDescriptions(),
      },
    });
  }

  destroy() {
    this.configObserver.dispose();
    this.commandsDisposable.dispose();
    return this.selectListView.destroy();
  }

  // Recomputes the command list and its keybindings for the current active
  // element and hidden filter; `needsUpdate` marks the result for the next
  // update push.
  refreshCommands() {
    this.lastActiveElement = this.activeElement;
    this.lastShowHiddenCommands = this.showHiddenCommands;
    this.keyBindingsForActiveElement = lumine.keymaps.findKeyBindings({
      target: this.activeElement,
    });
    this.commands = lumine.commands
      .findCommands({ target: this.activeElement })
      .filter((command) => this.showHiddenCommands === !!command.hiddenInCommandPalette);
    this.needsUpdate = true;
  }

  listProps() {
    return {
      items: this.commands,
      recentIds: this.recentlyUsed,
    };
  }

  // Swaps the open palette between the visible commands and the ones packages
  // hide from it, keeping the commands of the originally focused element.
  toggleHiddenCommands() {
    if (!this.selectListView.isVisible()) return;
    this.showHiddenCommands = !this.showHiddenCommands;
    this.refreshCommands();
    this.needsUpdate = false;
    this.selectListView.update(this.listProps());
  }

  // Swaps the open palette between rows that carry their description and the
  // names alone. The command set is unchanged — only the strings the filter
  // matches on are — so this recomputes the candidates without going back to
  // the registry the way `toggleHiddenCommands` has to.
  toggleDescriptions() {
    if (!this.selectListView.isVisible()) return;
    this.showDescriptions = !this.showDescriptions;
    this.needsUpdate = false;
    this.selectListView.update(this.listProps());
  }

  // The description is part of the filter key, so moving this flag leaves the
  // candidates stale. `showHiddenCommands` gets that service from
  // `refreshCommands`, which `willShow` calls when it sees that flag move;
  // nothing recomputes a list for a change that is only about rendering, so the
  // reset marks the list itself. Without this a palette reopened after asking
  // for the descriptions keeps matching them while no longer showing them.
  setShowDescriptions(showDescriptions) {
    if (this.showDescriptions === showDescriptions) return;
    this.showDescriptions = showDescriptions;
    this.needsUpdate = true;
  }

  toggle() {
    this.showHiddenCommands = false;
    this.setShowDescriptions(false);
    return this.selectListView.toggle();
  }

  show(showHiddenCommands = false) {
    this.showHiddenCommands = showHiddenCommands;
    this.setShowDescriptions(false);
    return this.selectListView.show();
  }

  hide() {
    return this.selectListView.hide();
  }

  clearRecent() {
    if (this.recentlyUsed.length === 0) return;

    this.recentlyUsed.length = 0;
    this.needsUpdate = true;

    if (this.selectListView.isVisible?.()) {
      this.selectListView.update(this.listProps());
    }
  }
}

module.exports = CommandPalette;
