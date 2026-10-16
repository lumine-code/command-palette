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

  activate({ globalState }) {
    // Building the select-list host allocates a modal surface and query
    // editor.  Keep the activation facade lightweight and construct that UI
    // only when one of the palette commands is actually used.
    this.list = null;
    this.listsByWindow = new Map();
    this.globalState = globalState;
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
      const load = () => recentCommands(this.globalState.get("recentCommands", []));
      const list = new CommandPalette(load(), window, {
        load,
        save: (ids) => this.globalState.update("recentCommands", recentCommands(ids)),
        onDidChange: (callback) =>
          this.globalState.onDidChange("recentCommands", ({ newValue }) =>
            callback(recentCommands(newValue)),
          ),
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

  async deactivate() {
    this.disposables?.dispose();
    this.disposables = null;
    const records = [...this.listsByWindow.values()];
    this.listsByWindow.clear();
    this.list = null;
    for (const { subscription } of records) subscription.dispose();
    await Promise.all(records.map(({ list }) => list.destroy()));
    this.globalState = null;
  },
};

function recentCommands(ids) {
  return [
    ...new Set((Array.isArray(ids) ? ids : []).filter((command) => typeof command === "string")),
  ].slice(0, lumine.config.get("command-palette.recentCount"));
}
