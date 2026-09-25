const { CompositeDisposable } = require("lumine");

module.exports = {
  provideBackgroundTips() {
    return {
      packageName: "command-palette",
      tips: [
        "Everything Lumine can do is in the Command Palette. See it by using {{ 'command-palette:toggle' | keystroke }}",
      ],
    };
  },

  activate(state) {
    // Building the select-list host allocates a modal surface and query
    // editor.  Keep the activation facade lightweight and construct that UI
    // only when one of the palette commands is actually used.
    this.list = null;
    this.recentlyUsed = Array.isArray(state?.recentlyUsed)
      ? state.recentlyUsed.filter((command) => typeof command === "string")
      : [];
    this.disposables = new CompositeDisposable(
      lumine.commands.add("lumine-workspace", {
        "command-palette:toggle": () => this.ensureList().toggle(),
        "command-palette:show-hidden-commands": {
          description: "Open the palette showing only the commands packages hide.",
          didDispatch: () => this.ensureList().show(true),
        },
        "command-palette:clear-recent": {
          description: "Forget the recently used commands kept at the top.",
          didDispatch: () => this.ensureList().selectList.clearRecentItems(),
        },
      }),
    );
  },

  ensureList() {
    if (!this.list) {
      const CommandPalette = require("./list");
      this.list = new CommandPalette(this.recentlyUsed);
    }
    return this.list;
  },

  serialize() {
    return {
      recentlyUsed: this.list ? this.list.selectList.getRecentItemIds() : this.recentlyUsed,
    };
  },

  async deactivate() {
    this.disposables?.dispose();
    this.disposables = null;
    const list = this.list;
    this.list = null;
    if (list) await list.destroy();
  },
};
