(function attachVideoSessionRecorder(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.FitFormVideoSessionRecorder = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createApi() {
  const MIME_CANDIDATES = Object.freeze([
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ]);

  function selectMimeType(MediaRecorderClass) {
    if (!MediaRecorderClass) return null;
    if (typeof MediaRecorderClass.isTypeSupported !== "function") {
      return "video/webm";
    }
    return MIME_CANDIDATES.find((type) =>
      MediaRecorderClass.isTypeSupported(type)
    ) || null;
  }

  function createSessionRecorder(stream, options = {}) {
    const MediaRecorderClass = options.MediaRecorderClass || globalThis.MediaRecorder;
    if (!MediaRecorderClass) {
      throw new Error("이 브라우저는 MediaRecorder를 지원하지 않습니다.");
    }
    if (!stream) throw new Error("카메라 stream이 필요합니다.");

    const mimeType = selectMimeType(MediaRecorderClass);
    const recorder = new MediaRecorderClass(
      stream,
      mimeType ? { mimeType, videoBitsPerSecond: options.videoBitsPerSecond || 2_500_000 } : {}
    );
    const chunks = [];
    const chunkTimeline = [];
    const clock = options.clock || (() => performance.now());
    const startedAtMs = options.startedAtMs ?? clock();
    let stopResolver;
    let stopRejecter;

    recorder.addEventListener("dataavailable", (event) => {
      if (event.data?.size > 0) {
        chunks.push(event.data);
        chunkTimeline.push({
          timestampMs: Math.max(0, clock() - startedAtMs),
          sizeBytes: event.data.size,
        });
      }
    });
    recorder.addEventListener("error", (event) => {
      stopRejecter?.(event.error || new Error("영상 기록에 실패했습니다."));
    });

    function start() {
      recorder.start(options.timesliceMs || 1000);
    }

    function stop() {
      if (recorder.state === "inactive") {
        return Promise.reject(new Error("영상 recorder가 실행 중이 아닙니다."));
      }
      return new Promise((resolve, reject) => {
        stopResolver = resolve;
        stopRejecter = reject;
        recorder.addEventListener(
          "stop",
          () => {
            const actualMimeType = recorder.mimeType || mimeType || "video/webm";
            stopResolver({
              blob: new Blob(chunks, { type: actualMimeType }),
              metadata: {
                filenameExtension: "webm",
                mimeType: actualMimeType,
                startedAtOffsetMs: 0,
                durationMs: Math.max(0, clock() - startedAtMs),
                chunkTimeline,
              },
            });
          },
          { once: true }
        );
        recorder.stop();
      });
    }

    return {
      recorder,
      startedAtMs,
      start,
      stop,
    };
  }

  return {
    MIME_CANDIDATES,
    createSessionRecorder,
    selectMimeType,
  };
});
