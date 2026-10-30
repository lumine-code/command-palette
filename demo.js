// Authentic package usage. Run with lumine/script/demo.js; fixtures stay in demo/.
module.exports = {
  version: 1,
  dependencies: [],
  viewport: { width: 1100, height: 720 },
  async before() {},
  async prepare(context) {
    const { state, open } = context;
    state.editor = await open("signal.js");
  },
  scenes: [
    {
      id: "scene-1",
      file: "demo.png",
      caption: "Search the editor command palette.",
      timeout: 60000,
      async run(context) {
        const { lumine, state, command } = context;
        await command("command-palette:toggle", lumine.views.getView(state.editor));
        state.palette = lumine.packages.getActivePackage("command-palette").mainModule.list;
        await state.palette.selectList.setQuery("split");
      },
      ready(context) {
        const { state } = context;
        return (
          state.palette.selectListHost.isVisible() &&
          state.palette.selectList.getQuery() === "split" &&
          state.palette.selectList.getFilteredItems().length > 0
        );
      },
    },
    {
      id: "keep-open",
      file: "demo-keep-open.png",
      caption: "Run repeated commands while the accented palette stays open.",
      async run({ lumine, state, command, waitFor }) {
        await state.palette.hide();
        state.editor.element.focus();
        await command("command-palette:toggle", state.editor.element);
        const list = state.palette.selectList;
        await list.setQuery("toggle soft wrap");
        const item = list.getItems().find(({ name }) => name === "editor:toggle-soft-wrap");
        if (!item) throw new Error("The editor's soft-wrap command is unavailable.");
        await list.selectItem(item);
        const target = list.getQueryEditor().getElement();
        const key = new KeyboardEvent("keydown", {
          key: "F12",
          code: "F12",
          bubbles: true,
          cancelable: true,
        });
        Object.defineProperty(key, "target", { value: target });
        lumine.keymaps.handleKeyboardEvent(key);
        await waitFor(() => list.isKeepOpen() && !list.isActionPending(), "keep-open action");
        const initiallyWrapped = state.editor.isSoftWrapped();
        const runToggle = async (expected, label) => {
          await waitFor(
            () => !list.isFiltering() && !list.isActionPending(),
            label + " matches ready",
          );
          const current = list.getItems().find(({ name }) => name === "editor:toggle-soft-wrap");
          if (!current) throw new Error("The editor's soft-wrap command is unavailable.");
          await list.selectItem(current);
          await list.confirmSelection();
          await waitFor(() => state.editor.isSoftWrapped() === expected, label + " completed");
        };
        await runToggle(!initiallyWrapped, "First soft-wrap command");
        await runToggle(initiallyWrapped, "Second soft-wrap command");
        await list.setQuery("");
      },
      ready({ state }) {
        const list = state.palette.selectList;
        return (
          state.palette.selectListHost.isVisible() &&
          list.isKeepOpen() &&
          list.getRecentItemIds()[0] === "editor:toggle-soft-wrap" &&
          list.getQuery() === ""
        );
      },
    },
  ],
  async cleanup() {},
};
