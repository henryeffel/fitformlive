const {
  selectMimeType,
  createSessionRecorder,
} = require("../../web/js/video-session-recorder.js");

class FakeMediaRecorder {
  static isTypeSupported(type) {
    return type.includes("vp8") || type === "video/webm";
  }

  constructor(stream, options) {
    this.stream = stream;
    this.mimeType = options.mimeType;
    this.state = "inactive";
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type, payload = {}) {
    for (const listener of this.listeners.get(type) || []) listener(payload);
  }

  start() {
    this.state = "recording";
  }

  stop() {
    this.emit("dataavailable", {
      data: new Blob(["video"], { type: this.mimeType }),
    });
    this.state = "inactive";
    this.emit("stop");
  }
}

describe("video session recorder", () => {
  it("selects the first supported WebM codec", () => {
    expect(selectMimeType(FakeMediaRecorder)).toBe("video/webm;codecs=vp8");
  });

  it("returns a video blob and synchronized chunk metadata", async () => {
    let now = 1000;
    const session = createSessionRecorder(
      { id: "stream" },
      {
        MediaRecorderClass: FakeMediaRecorder,
        startedAtMs: 1000,
        clock: () => now,
      }
    );
    session.start();
    now = 1800;
    const result = await session.stop();

    expect(result.blob.size).toBe(5);
    expect(result.metadata).toMatchObject({
      filenameExtension: "webm",
      startedAtOffsetMs: 0,
      durationMs: 800,
    });
    expect(result.metadata.chunkTimeline).toEqual([
      { timestampMs: 800, sizeBytes: 5 },
    ]);
  });
});
