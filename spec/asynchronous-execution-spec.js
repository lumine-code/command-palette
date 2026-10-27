describe("command palette asynchronous execution", () => {
  let main, palette, selectList, target, otherTarget, registrations, deferreds, operations;
  const firstName = "palette-async:first";
  const secondName = "palette-async:second";

  beforeEach(async () => {
    jasmine.useRealClock();
    jasmine.attachToDOM(lumine.workspace.getElement());
    registrations = [];
    deferreds = [];
    operations = [];
    main = (await lumine.packages.activatePackage("command-palette")).mainModule;
    palette = main.ensureList();
    selectList = palette.selectList;
    await selectList.clearRecentItems();
    target = document.createElement("button");
    otherTarget = document.createElement("button");
    lumine.workspace.getElement().append(target, otherTarget);
  });

  afterEach(async () => {
    for (const deferred of deferreds) deferred.resolve();
    await Promise.allSettled(operations);
    await flushMicrotasks();
    await lumine.packages.deactivatePackage("command-palette");
    for (const registration of registrations) registration.dispose();
    target.remove();
    otherTarget.remove();
  });

  function deferred() {
    let resolve, reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    const result = { promise, resolve, reject };
    deferreds.push(result);
    return result;
  }

  function register(name, handler) {
    const spy = jasmine.createSpy(name).and.callFake(handler);
    registrations.push(lumine.commands.add("lumine-workspace", name, spy));
    return spy;
  }

  async function show(name = firstName) {
    target.focus();
    await palette.show();
    await selectList.setQuery("palette async");
    await selectList.selectItemById(name);
  }

  function confirm() {
    const operation = Promise.resolve(selectList.confirmSelection());
    // Keep cleanup able to observe a failed assertion's unfinished selection.
    operation.catch(() => {});
    operations.push(operation);
    return operation;
  }

  async function waitForRecents(ids) {
    await conditionPromise(
      () => JSON.stringify(main.globalState.get("recentCommands", [])) === JSON.stringify(ids),
      "the accepted commands to be saved in recent history",
    );
  }

  function expectNotification(errors, message) {
    expect(errors).toHaveBeenCalledTimes(1);
    const [title, options] = errors.calls.mostRecent().args;
    expect(`${title} ${options?.detail ?? ""} ${options?.description ?? ""}`).toContain(message);
  }

  it("closes on dispatch and permits another command before the first completes", async () => {
    const completion = deferred();
    const first = register(firstName, () => completion.promise);
    const second = register(secondName, () => {});
    await show();
    const firstSelection = confirm();

    await conditionPromise(() => !palette.selectListHost.isVisible(), "the palette to close");
    expect((await firstSelection).status).toBe("success");
    expect(first).toHaveBeenCalledTimes(1);
    await waitForRecents([firstName]);

    await show(secondName);
    expect((await confirm()).status).toBe("success");
    expect(second).toHaveBeenCalledTimes(1);
    expect(second.calls.mostRecent().args[0].target).toBe(target);
    expect(palette.selectListHost.isVisible()).toBe(false);
    await waitForRecents([secondName, firstName]);
  });

  it("permits further dispatches during a history save and preserves both accepted commands", async () => {
    const history = deferred();
    const mutate = main.globalState.mutate.bind(main.globalState);
    const saves = spyOn(main.globalState, "mutate").and.callFake((...args) => {
      const operation = history.promise.then(() => mutate(...args));
      operations.push(operation);
      return operation;
    });
    const first = register(firstName, () => {});
    const second = register(secondName, () => {});
    await show();
    const firstSelection = confirm();

    await conditionPromise(() => !palette.selectListHost.isVisible(), "the palette to close");
    expect((await firstSelection).status).toBe("success");
    expect(first).toHaveBeenCalledTimes(1);
    expect(saves).toHaveBeenCalledTimes(1);
    expect(main.globalState.get("recentCommands", [])).toEqual([]);

    await show(secondName);
    expect((await confirm()).status).toBe("success");
    expect(second).toHaveBeenCalledTimes(1);
    expect(palette.selectListHost.isVisible()).toBe(false);
    expect(saves).toHaveBeenCalledTimes(2);
    history.resolve();
    await waitForRecents([secondName, firstName]);
  });

  it("reports a late command failure without disturbing a reopened palette or its history", async () => {
    const completion = deferred();
    const errors = spyOn(lumine.notifications, "addError");
    register(firstName, () => completion.promise);
    register(secondName, () => {});
    await show();
    await confirm();
    await waitForRecents([firstName]);
    await show(secondName);
    const query = selectList.getQuery();
    const selectedId = selectList.getSelectedItemId();

    completion.reject(new Error("The asynchronous operation failed."));
    await conditionPromise(() => errors.calls.any(), "the command failure notification");
    await flushMicrotasks();

    expectNotification(errors, "The asynchronous operation failed.");
    expect(palette.selectListHost.isVisible()).toBe(true);
    expect(selectList.getStatus()).toBeNull();
    expect(selectList.getQuery()).toBe(query);
    expect(selectList.getSelectedItemId()).toBe(selectedId);
    expect(main.globalState.get("recentCommands")).toEqual([firstName]);
  });

  it("reports a late history failure outside the reopened palette", async () => {
    const history = deferred();
    const errors = spyOn(lumine.notifications, "addError");
    spyOn(main.globalState, "mutate").and.returnValue(history.promise);
    register(firstName, () => {});
    register(secondName, () => {});
    await show();
    await confirm();
    await show(secondName);
    const query = selectList.getQuery();
    const selectedId = selectList.getSelectedItemId();

    history.reject(new Error("Recent history could not be saved."));
    await conditionPromise(() => errors.calls.any(), "the history failure notification");
    await flushMicrotasks();

    expectNotification(errors, "Recent history could not be saved.");
    expect(palette.selectListHost.isVisible()).toBe(true);
    expect(selectList.getStatus()).toBeNull();
    expect(selectList.getQuery()).toBe(query);
    expect(selectList.getSelectedItemId()).toBe(selectedId);
  });

  it("keeps F12 context while permitting other commands and repeated dispatches during execution", async () => {
    const completion = deferred();
    const first = register(firstName, () => completion.promise);
    const second = register(secondName, () => otherTarget.focus());
    await show();
    await selectList.runAction("select-list:toggle-keep-open");
    const query = selectList.getQuery();
    const firstSelection = confirm();
    let accepted = false;
    firstSelection.then(() => (accepted = true));

    await conditionPromise(() => accepted, "F12 dispatch acceptance without command completion");
    expect((await firstSelection).status).toBe("success");
    expect(palette.selectListHost.isVisible()).toBe(true);
    expect(selectList.getSelectedItemId()).toBe(firstName);
    await selectList.selectItemById(secondName);
    expect((await confirm()).status).toBe("success");
    expect(second).toHaveBeenCalledTimes(1);
    expect(selectList.getSelectedItemId()).toBe(secondName);
    await selectList.selectItemById(firstName);
    expect((await confirm()).status).toBe("success");

    expect(first).toHaveBeenCalledTimes(2);
    expect(first.calls.allArgs().map(([event]) => event.target)).toEqual([target, target]);
    expect(second.calls.mostRecent().args[0].target).toBe(target);
    expect(palette.activeElement).toBe(target);
    expect(palette.selectListHost.isVisible()).toBe(true);
    expect(selectList.isKeepOpen()).toBe(true);
    expect(selectList.getQuery()).toBe(query);
    expect(selectList.getSelectedItemId()).toBe(firstName);
    expect(selectList.getStatus()).toBeNull();
    await waitForRecents([firstName, secondName]);
  });

  it("keeps F12 open when a detached command later moves focus", async () => {
    spyOn(document, "hasFocus").and.returnValue(true);
    const completion = deferred();
    let movedFocus = false;
    register(firstName, async () => {
      await completion.promise;
      otherTarget.focus();
      movedFocus = true;
    });
    await show();
    await selectList.runAction("select-list:toggle-keep-open");
    await confirm();
    await waitForRecents([firstName]);

    completion.resolve();
    await conditionPromise(() => movedFocus);
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);

    expect(palette.selectListHost.isVisible()).toBe(true);
    expect(selectList.isKeepOpen()).toBe(true);
    expect(selectList.getQueryEditor().getElement().contains(document.activeElement)).toBe(true);
  });

  it("reports a synchronous command error through notifications instead of list status", async () => {
    const errors = spyOn(lumine.notifications, "addError");
    register(firstName, () => {
      throw new Error("The synchronous operation failed.");
    });
    await show();
    const selection = confirm();

    await conditionPromise(() => errors.calls.any(), "the synchronous failure notification");
    await selection;
    await flushMicrotasks();

    expectNotification(errors, "The synchronous operation failed.");
    expect(palette.selectListHost.isVisible()).toBe(false);
    expect(selectList.getStatus()).toBeNull();
    expect(selectList.getRecentItemIds()).toEqual([]);
    expect(main.globalState.get("recentCommands", [])).toEqual([]);
  });

  it("keeps an accepted aborted operation in history without reporting an error", async () => {
    const completion = deferred();
    const errors = spyOn(lumine.notifications, "addError");
    register(firstName, () => completion.promise);
    await show();
    expect((await confirm()).status).toBe("success");
    await waitForRecents([firstName]);
    const error = new Error("The operation was cancelled.");
    error.name = "AbortError";

    completion.reject(error);
    await flushMicrotasks();

    expect(errors).not.toHaveBeenCalled();
    expect(selectList.getStatus()).toBeNull();
    expect(main.globalState.get("recentCommands")).toEqual([firstName]);
  });

  it("does not write history or access the list after a command synchronously destroys it", async () => {
    const completion = deferred();
    const errors = spyOn(lumine.notifications, "addError");
    const save = spyOn(main.globalState, "mutate").and.callThrough();
    register(firstName, () => {
      operations.push(palette.destroy());
      return completion.promise;
    });
    await show();

    await confirm();
    completion.resolve();
    await Promise.allSettled(operations);
    await flushMicrotasks();

    expect(selectList.isDestroyed()).toBe(true);
    expect(save).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    expect(main.globalState.get("recentCommands", [])).toEqual([]);
  });
});
