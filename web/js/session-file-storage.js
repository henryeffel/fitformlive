(function attachSessionFileStorage(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.FitFormSessionFileStorage = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createApi() {
  function supportsDirectoryPicker(scope = globalThis) {
    return typeof scope?.showDirectoryPicker === "function";
  }

  async function chooseDirectory(scope = globalThis) {
    if (!supportsDirectoryPicker(scope)) {
      throw new Error("이 브라우저는 폴더 직접 저장을 지원하지 않습니다.");
    }
    return scope.showDirectoryPicker({
      id: "fitform-recordings",
      mode: "readwrite",
      startIn: "documents",
    });
  }

  async function ensureWritePermission(directoryHandle) {
    if (!directoryHandle) throw new Error("저장 폴더가 선택되지 않았습니다.");
    const options = { mode: "readwrite" };
    if (
      typeof directoryHandle.queryPermission !== "function" ||
      (await directoryHandle.queryPermission(options)) === "granted"
    ) {
      return true;
    }
    if (
      typeof directoryHandle.requestPermission === "function" &&
      (await directoryHandle.requestPermission(options)) === "granted"
    ) {
      return true;
    }
    throw new Error("선택한 폴더의 쓰기 권한이 없습니다.");
  }

  async function writeFile(directoryHandle, filename, contents) {
    await ensureWritePermission(directoryHandle);
    const fileHandle = await directoryHandle.getFileHandle(filename, {
      create: true,
    });
    const writable = await fileHandle.createWritable();
    try {
      await writable.write(contents);
      await writable.close();
    } catch (error) {
      await writable.abort?.();
      throw error;
    }
  }

  async function saveSession(directoryHandle, fixture, videoBlob) {
    if (!fixture?.testId || !videoBlob) {
      throw new Error("완료된 세션 JSON과 영상이 필요합니다.");
    }
    const jsonFilename = `${fixture.testId}.json`;
    const videoFilename =
      fixture.capture?.video?.filename || `${fixture.testId}.webm`;
    await writeFile(
      directoryHandle,
      jsonFilename,
      JSON.stringify(fixture, null, 2)
    );
    await writeFile(directoryHandle, videoFilename, videoBlob);
    return { jsonFilename, videoFilename };
  }

  return {
    chooseDirectory,
    ensureWritePermission,
    saveSession,
    supportsDirectoryPicker,
    writeFile,
  };
});
