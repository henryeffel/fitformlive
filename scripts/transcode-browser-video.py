from __future__ import annotations

import argparse
from pathlib import Path

import cv2


def transcode(source: Path, destination: Path) -> None:
    capture = cv2.VideoCapture(str(source))
    if not capture.isOpened():
        raise ValueError(f"cannot open {source}")
    fps = float(capture.get(cv2.CAP_PROP_FPS))
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    expected_frames = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    destination.parent.mkdir(parents=True, exist_ok=True)
    writer = cv2.VideoWriter(
        str(destination),
        cv2.VideoWriter_fourcc(*"VP80"),
        fps,
        (width, height),
    )
    if not writer.isOpened():
        capture.release()
        raise ValueError("OpenCV build cannot encode VP8 WebM")

    written = 0
    try:
        while True:
            ok, frame = capture.read()
            if not ok:
                break
            writer.write(frame)
            written += 1
    finally:
        writer.release()
        capture.release()

    if written != expected_frames:
        raise ValueError(
            f"{source.name}: wrote {written}/{expected_frames} frames"
        )
    print(
        f"{source.name} -> {destination.name}: "
        f"{written} frames, {fps:.3f}fps, {width}x{height}",
        flush=True,
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-directory", required=True)
    parser.add_argument("videos", nargs="+")
    args = parser.parse_args()
    output_directory = Path(args.output_directory).resolve()
    for item in args.videos:
        source = Path(item).resolve()
        transcode(
            source,
            output_directory / f"{source.stem}.browser.webm",
        )


if __name__ == "__main__":
    main()
