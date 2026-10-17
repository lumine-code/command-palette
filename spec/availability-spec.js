describe("command palette availability", () => {
  let main, palette, target, registrations, enabled, handler;
  const name = "palette-availability:conditional-operation";

  beforeEach(async () => {
    jasmine.useRealClock();
    jasmine.attachToDOM(lumine.workspace.getElement());
    main = (await lumine.packages.activatePackage("command-palette")).mainModule;
    palette = main.ensureList();
    target = document.createElement("button");
    lumine.workspace.getElement().appendChild(target);
    enabled = false;
    handler = jasmine.createSpy("conditional operation");
    registrations = [
      lumine.commands.add("lumine-workspace", name, {
        displayName: "Conditional Palette Operation",
        isAvailable: () => enabled,
        didDispatch: handler,
      }),
      lumine.commands.add("lumine-text-editor:not([mini])", "palette-availability:other-scope", {
        didDispatch() {},
      }),
    ];
    target.focus();
    await palette.show();
  });

  afterEach(async () => {
    await lumine.packages.deactivatePackage("command-palette");
    for (const registration of registrations) registration.dispose();
    target.remove();
  });

  const command = () => palette.selectList.getItems().find((item) => item.name === name);
  const row = () => palette.selectList.getElement().querySelector(`[data-event-name="${name}"]`);

  it("keeps disabled scoped commands searchable and grey without introducing a global catalogue", async () => {
    expect(command()).toBeDefined();
    expect(command().enabled).toBe(false);
    expect(
      palette.selectList
        .getItems()
        .some((item) => item.name === "palette-availability:other-scope"),
    ).toBe(false);
    await palette.selectList.setQuery("Conditional Palette Operation");
    expect(palette.selectList.getFilteredItems().some((item) => item.name === name)).toBe(true);
    expect(row().classList.contains("disabled")).toBe(true);
    expect(row().getAttribute("aria-disabled")).toBe("true");
  });

  it("leaves disabled confirmation silent, keeps the palette open and records no recent command", async () => {
    await palette.selectList.selectItem(command());
    const result = await palette.selectList.confirmSelection();

    expect(result.status).toBe("disabled");
    expect(handler).not.toHaveBeenCalled();
    expect(palette.selectListHost.isVisible()).toBe(true);
    expect(palette.selectList.getRecentItemIds()).toEqual([]);
    expect(palette.selectList.getStatus()).toBeNull();
  });

  it("keeps the Run action disabled and guards direct execution too", async () => {
    await palette.selectList.selectItem(command());
    const action = palette.selectList
      .getAvailableActions()
      .find((item) => item.command === "command-palette:run-selected-command");
    expect(action.enabled).toBe(false);
    expect(action.disabledReason).toBeNull();
    expect(palette.runSelectedCommand(command())).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it("keeps clicking a disabled row and confirming its Run action silent", async () => {
    await palette.selectList.setQuery("Conditional Palette Operation");
    const confirm = spyOn(palette.selectList, "confirmSelection").and.callThrough();
    row().click();
    expect(confirm).not.toHaveBeenCalled();
    expect(lumine.commands.canDispatch(palette.selectList.getElement(), "core:confirm")).toBe(
      false,
    );
    expect(palette.selectListHost.isVisible()).toBe(true);
    expect(palette.selectList.getStatus()).toBeNull();
    await palette.selectListHost.showActions();
    const action = await palette.selectList.getActionAvailability(
      "command-palette:run-selected-command",
    );
    expect(action.status).toBe("disabled");
    expect(handler).not.toHaveBeenCalled();
    expect(palette.selectList.getRecentItemIds()).toEqual([]);
  });

  it("refreshes invalidated availability while preserving the original command target", async () => {
    await palette.selectList.setQuery("Conditional Palette Operation");
    enabled = true;
    lumine.commands.invalidateAvailability();
    await flushMicrotasks();
    expect(command()?.enabled).toBe(true);
    await lumine.views.getNextUpdatePromise();

    expect(palette.activeElement).toBe(target);
    expect(palette.selectList.getQuery()).toBe("Conditional Palette Operation");
    expect(row().getAttribute("aria-disabled")).toBeNull();
    await palette.selectList.selectItem(command());
    await palette.selectList.confirmSelection();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.calls.mostRecent().args[0].target).toBe(target);
    expect(palette.selectList.getRecentItemIds()[0]).toBe(name);
    expect(palette.selectListHost.isVisible()).toBe(false);
  });

  it("rechecks live conditions before confirming an item that was enabled at loading", async () => {
    enabled = true;
    await palette.selectList.reload();
    const item = command();
    expect(item.enabled).toBe(true);
    await palette.selectList.selectItem(item);
    enabled = false;

    const result = await palette.selectList.confirmSelection();

    expect(result.status).toBe("disabled");
    expect(handler).not.toHaveBeenCalled();
    expect(palette.selectListHost.isVisible()).toBe(true);
    expect(palette.selectList.getRecentItemIds()).toEqual([]);
    expect(palette.selectList.getStatus()).toBeNull();
  });

  it("refuses an otherwise enabled command when its saved target was removed", async () => {
    enabled = true;
    await palette.selectList.reload();
    await palette.selectList.selectItem(command());
    target.remove();

    const result = await palette.selectList.confirmSelection();

    expect(result.status).toBe("disabled");
    expect(handler).not.toHaveBeenCalled();
    expect(palette.selectListHost.isVisible()).toBe(true);
    expect(palette.selectList.getRecentItemIds()).toEqual([]);
  });

  it("greys saved-target rows after their opener is detached", async () => {
    registrations.push(
      lumine.commands.add("button", name, { isAvailable: () => enabled, didDispatch: handler }),
    );
    enabled = true;
    await palette.selectList.reload();
    expect(command().enabled).toBe(true);
    target.remove();
    lumine.commands.invalidateAvailability();
    await flushMicrotasks();
    await palette.selectList.reload();
    expect(command().enabled).toBe(false);
    expect(row().getAttribute("aria-disabled")).toBe("true");
    expect(palette.isCommandEnabled(command())).toBe(false);
  });

  it("does not close or record the command when availability changes at Run dispatch", async () => {
    enabled = true;
    await palette.selectList.reload();
    await palette.selectList.selectItem(command());
    const run = spyOn(palette, "runSelectedCommand").and.callThrough();
    registrations.push(
      lumine.commands.onWillDispatch((event) => {
        if (
          event.type === "command-palette:run-selected-command" &&
          event.detail?.dialog === palette.selectList
        )
          enabled = false;
      }),
    );

    const result = await palette.selectList.confirmSelection();

    expect(result.status).toBe("disabled");
    expect(run).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    expect(palette.selectListHost.isVisible()).toBe(true);
    expect(palette.selectList.getRecentItemIds()).toEqual([]);
    expect(palette.selectList.getStatus()).toBeNull();
  });

  it("does not close or record the command when its actual dispatch declines", async () => {
    enabled = true;
    await palette.selectList.reload();
    await palette.selectList.selectItem(command());
    registrations.push(
      lumine.commands.onWillDispatch((event) => {
        if (event.type === name) enabled = false;
      }),
    );

    const result = await palette.selectList.confirmSelection();

    expect(result.status).toBe("aborted");
    expect(handler).not.toHaveBeenCalled();
    expect(palette.selectListHost.isVisible()).toBe(true);
    expect(palette.selectList.getRecentItemIds()).toEqual([]);
    expect(palette.selectList.getStatus()).toBeNull();
  });
  it("ignores local palette state changes while observing the saved opener subtree", async () => {
    await flushMicrotasks();
    const presentations = spyOn(lumine.commands, "getCommandPresentations").and.callThrough();
    lumine.commands.invalidateAvailability({ target: palette.selectList.getElement() });
    await flushMicrotasks();
    expect(presentations).not.toHaveBeenCalled();
    lumine.commands.invalidateAvailability({ target });
    await flushMicrotasks();
    expect(presentations).toHaveBeenCalledTimes(1);
  });
});
