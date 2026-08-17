const { CompositeDisposable } = require("lumine");
const CommandPalette = require("./list");

module.exports = {
  activate(state) {
    this.list = new CommandPalette(state?.recentlyUsed);
    this.disposables = new CompositeDisposable(
      lumine.commands.add("lumine-workspace", {
        "command-palette:toggle": () => this.list.toggle(),
        "command-palette:show-hidden-commands": {
          description: "Open the palette showing only the commands packages hide.",
          didDispatch: () => this.list.show(true),
        },
        "command-palette:clear-recent": {
          description: "Forget the recently used commands kept at the top.",
          didDispatch: () => this.list.clearRecent(),
        },
      }),
    );
  },

  serialize() {
    return { recentlyUsed: this.list.recentlyUsed };
  },

  async deactivate() {
    this.disposables.dispose();
    await this.list.destroy();
  },
};
