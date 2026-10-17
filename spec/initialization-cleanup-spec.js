describe("Command Palette initialization cleanup", () => {
  beforeEach(async () => {
    if (lumine.packages.isPackageLoaded("command-palette"))
      await lumine.packages.unloadPackage("command-palette", { serialize: false });
  });

  afterEach(async () => {
    if (lumine.packages.isPackageLoaded("command-palette"))
      await lumine.packages.unloadPackage("command-palette", { serialize: false });
  });

  it("unloads before activation has created its window lists", async () => {
    const pack = lumine.packages.loadPackage("command-palette");
    pack.initializeForExternalUse("initial package bootstrap");
    const context = pack.lifecycleContext;
    expect(pack.mainInitialized).toBe(true);
    expect(pack.mainActivated).toBe(false);
    await expectAsync(
      lumine.packages.unloadPackage("command-palette", { serialize: false }),
    ).toBeResolved();
    expect(context.subscriptions.disposed).toBe(true);
    expect(lumine.packages.isPackageLoaded("command-palette")).toBe(false);
  });
});
