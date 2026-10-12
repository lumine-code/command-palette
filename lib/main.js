const { CompositeDisposable, Emitter } = require("lumine");

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
    this.listsByWindow = new Map();
    this.recentEvents = new Emitter();
    this.recentlyUsed = Array.isArray(state?.recentlyUsed)
      ? state.recentlyUsed.filter((command) => typeof command === "string")
      : [];
    this.disposables = new CompositeDisposable(
      lumine.commands.add("lumine-workspace", {
        "command-palette:toggle": (event) => this.ensureList(event.context?.window).toggle(),
        "command-palette:show-hidden-commands": {
          description: "Open the palette showing only the commands packages hide.",
          didDispatch: (event) => this.ensureList(event.context?.window).show(true),
        },
        "command-palette:clear-recent": {
          description: "Forget the recently used commands kept at the top.",
          didDispatch: () => this.ensureList().selectList.clearRecentItems(),
        },
      }),
    );
  },

  ensureList(window = lumine.workspace.getMainWindow()) {
    let record = this.listsByWindow.get(window);
    if (!record) {
      const CommandPalette = require("./list");
      const list = new CommandPalette(this.recentlyUsed, window, {
        load: () => this.recentlyUsed,
        save: (ids) => {
          this.recentlyUsed = ids;
          this.recentEvents.emit("did-change", ids);
        },
        onDidChange: (callback) => this.recentEvents.on("did-change", callback),
      });
      const subscription = window.onWillDestroy(() => {
        this.listsByWindow.delete(window);
        if (this.list === list) this.list = null;
        subscription.dispose();
        void list.destroy();
      });
      record = { list, subscription };
      this.listsByWindow.set(window, record);
      if (window.isMain()) this.list = list;
    }
    return record.list;
  },

  serialize() {
    return {
      recentlyUsed: this.recentlyUsed,
    };
  },

  async deactivate() {
    this.disposables?.dispose();
    this.disposables = null;
    const records = [...this.listsByWindow.values()];
    this.listsByWindow.clear();
    this.list = null;
    for (const { subscription } of records) subscription.dispose();
    await Promise.all(records.map(({ list }) => list.destroy()));
    this.recentEvents.dispose();
  },
};
