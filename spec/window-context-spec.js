describe("window-local command palettes", () => {
  let module, registrations;
  beforeEach(async () => {
    jasmine.useRealClock();
    jasmine.attachToDOM(lumine.workspace.getElement());
    module = (await lumine.packages.activatePackage("command-palette")).mainModule;
    registrations = [];
  });
  afterEach(async () => {
    for (const registration of registrations) registration.dispose();
    await lumine.packages.deactivatePackage("command-palette");
    await lumine.workspace.discardEditorWindows();
  });
  it("keeps different commands recorded concurrently by two palettes", async () => {
    const names = ["command-palette-spec:first", "command-palette-spec:second"];
    for (const name of names)
      registrations.push(lumine.commands.add("lumine-workspace", name, () => {}));
    await module.globalState.update("recentCommands", []);
    const extra = await lumine.workspace.openEditorWindow({ show: false });
    const local = module.ensureList();
    const remote = module.ensureList(extra);
    await local.show();
    await remote.show();
    await Promise.all([
      local.selectList.recordRecentItem(
        local.selectList.getItems().find((item) => item.name === names[0]),
      ),
      remote.selectList.recordRecentItem(
        remote.selectList.getItems().find((item) => item.name === names[1]),
      ),
    ]);
    expect(module.globalState.get("recentCommands")).toEqual(names.slice().reverse());
    expect(local.selectList.getRecentItemIds()).toEqual(names.slice().reverse());
    expect(remote.selectList.getRecentItemIds()).toEqual(names.slice().reverse());
    await local.selectList.removeRecentItem(names[0]);
    expect(module.globalState.get("recentCommands")).toEqual([names[1]]);
    await remote.selectList.clearRecentItems();
    expect(module.globalState.get("recentCommands")).toEqual([]);
  });
  it("opens concurrent local palettes and runs commands on their original targets", async () => {
    const workspace = lumine.workspace;
    const main = workspace.getMainWindow();
    const editor = await workspace.open();
    const extra = await workspace.openEditorWindow({ show: false });
    const other = workspace.buildTextEditor();
    extra.getEditorContainer().getActivePane().activateItem(other, { activatePane: true });
    const name = "command-palette-spec:local-insert";
    for (const target of [editor, other])
      registrations.push(
        lumine.commands.add(target.getElement(), name, () => target.insertText("local")),
      );
    editor.getElement().focus();
    await lumine.commands.dispatch(editor.getElement(), "command-palette:toggle");
    other.getElement().focus();
    await lumine.commands.dispatch(other.getElement(), "command-palette:toggle");
    const local = module.ensureList(main),
      remote = module.ensureList(extra);
    expect(local.selectListHost.isVisible()).toBe(true);
    expect(remote.selectListHost.isVisible()).toBe(true);
    expect(remote.selectList.getElement().ownerDocument).toBe(extra.getDocument());
    for (const palette of [local, remote]) {
      const command = palette.selectList.getItems().find((item) => item.name === name);
      expect(command).toBeDefined();
      await palette.selectList.selectItem(command);
      await palette.selectList.confirmSelection();
    }
    expect(editor.getText()).toBe("local");
    expect(other.getText()).toBe("local");
    expect(local.selectList.getRecentItemIds()).toEqual([name]);
    expect(remote.selectList.getRecentItemIds()).toEqual([name]);
    expect(module.globalState.get("recentCommands")).toEqual([name]);
    const recentlyUsed = ["command-palette:toggle", name];
    await module.globalState.update("recentCommands", recentlyUsed);
    await lumine.views.getNextUpdatePromise();
    expect(local.selectList.getRecentItemIds()).toEqual(recentlyUsed);
    expect(remote.selectList.getRecentItemIds()).toEqual(recentlyUsed);
    expect(module.globalState.get("recentCommands")).toEqual(recentlyUsed);
    await lumine.commands.dispatch(extra.getElement(), "command-palette:clear-recent");
    expect(local.selectList.getRecentItemIds()).toEqual([]);
    expect(remote.selectList.getRecentItemIds()).toEqual([]);
    await workspace.closeEditorWindow(extra);
    expect(module.listsByWindow.has(extra)).toBe(false);
  });
});
