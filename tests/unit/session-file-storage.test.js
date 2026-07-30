const {
  saveSession,
  supportsDirectoryPicker,
  writeFile,
} = require("../../web/js/session-file-storage.js");

function directoryHandle() {
  const files = new Map();
  return {
    name: "raw",
    files,
    async queryPermission() {
      return "granted";
    },
    async getFileHandle(name) {
      return {
        async createWritable() {
          return {
            async write(contents) {
              files.set(name, contents);
            },
            async close() {},
          };
        },
      };
    },
  };
}

describe("session file storage", () => {
  it("detects directory picker support", () => {
    expect(supportsDirectoryPicker({ showDirectoryPicker() {} })).toBe(true);
    expect(supportsDirectoryPicker({})).toBe(false);
  });

  it("writes a file through a directory handle", async () => {
    const handle = directoryHandle();
    await writeFile(handle, "sample.json", "{}");
    expect(handle.files.get("sample.json")).toBe("{}");
  });

  it("saves matching JSON and WebM session files", async () => {
    const handle = directoryHandle();
    const video = new Blob(["video"]);
    const result = await saveSession(
      handle,
      {
        testId: "curl-normal-01",
        capture: { video: { filename: "curl-normal-01.webm" } },
      },
      video
    );
    expect(result).toEqual({
      jsonFilename: "curl-normal-01.json",
      videoFilename: "curl-normal-01.webm",
    });
    expect(handle.files.has("curl-normal-01.json")).toBe(true);
    expect(handle.files.get("curl-normal-01.webm")).toBe(video);
  });
});
