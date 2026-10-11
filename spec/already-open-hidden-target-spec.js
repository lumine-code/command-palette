beforeEach(() => {
  for (const method of ["openExternal", "openPath", "showItemInFolder", "openApplication"])
    spyOn(lumine.shell, method).and.resolveTo();
  spyOn(lumine.application, "openWindow").and.resolveTo();
});

describe("Public hidden-command requests in an open palette", () => {
  let editor, main, palette, registration;
  const name = "command-palette-audit:hidden-insert";

  beforeEach(async () => {
    jasmine.useRealClock();
    jasmine.attachToDOM(lumine.workspace.getElement());
    if (lumine.packages.isPackageLoaded("command-palette"))
      await lumine.packages.unloadPackage("command-palette");
    main = (await lumine.packages.activatePackage("command-palette")).mainModule;
    editor = await lumine.workspace.open();
    editor.setText("base");
    editor.setCursorBufferPosition([0, 4]);
    editor.getElement().focus();
    registration = lumine.commands.add(editor.getElement(), name, {
      description: "Insert an owned marker into the initiating editor.",
      hiddenInCommandPalette: true,
      didDispatch: () => editor.insertText(" OWNED"),
    });
    palette = main.ensureList();
  });

  afterEach(async () => {
    registration?.dispose();
    if (lumine.packages.isPackageLoaded("command-palette"))
      await lumine.packages.unloadPackage("command-palette");
    editor?.destroy();
    await lumine.fileWatchClient.settlePendingTeardown();
    editor = main = palette = registration = null;
  });

  async function showHidden() {
    await lumine.commands.dispatch(
      lumine.workspace.getElement(),
      "command-palette:show-hidden-commands",
    );
  }

  async function confirmHidden() {
    const item = palette.selectList.getItems().find((command) => command.name === name);
    expect(item).toBeDefined();
    if (item) {
      await palette.selectList.selectItem(item);
      await palette.selectList.confirmSelection();
    }
    expect(editor.getText()).toBe("base OWNED");
  }

  it("keeps the initiating editor when the menu switches an already-open palette", async () => {
    await lumine.commands.dispatch(lumine.workspace.getElement(), "command-palette:toggle");
    const target = palette.activeElement;
    expect(editor.getElement().contains(target)).toBe(true);
    expect(palette.selectListHost.isVisible()).toBe(true);
    expect(palette.selectList.getQueryEditor().getElement().contains(document.activeElement)).toBe(
      true,
    );
    await showHidden();
    expect(palette.activeElement).toBe(target);
    await confirmHidden();
  });

  it("opens hidden commands directly and runs them on the focused editor", async () => {
    await showHidden();
    expect(editor.getElement().contains(palette.activeElement)).toBe(true);
    await confirmHidden();
  });
});
