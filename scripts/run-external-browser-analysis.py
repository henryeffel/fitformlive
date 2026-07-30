from __future__ import annotations

import argparse
import asyncio
import json
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path
from typing import Any

import websockets


class CdpPage:
    def __init__(self, websocket_url: str) -> None:
        self.websocket_url = websocket_url
        self.websocket: Any = None
        self.next_id = 0

    async def __aenter__(self) -> "CdpPage":
        self.websocket = await websockets.connect(
            self.websocket_url,
            max_size=32 * 1024 * 1024,
        )
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.websocket.close()

    async def command(
        self,
        method: str,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        self.next_id += 1
        command_id = self.next_id
        await self.websocket.send(
            json.dumps(
                {
                    "id": command_id,
                    "method": method,
                    "params": params or {},
                }
            )
        )
        while True:
            message = json.loads(await self.websocket.recv())
            if message.get("id") != command_id:
                continue
            if "error" in message:
                raise RuntimeError(f"{method}: {message['error']}")
            return message.get("result") or {}

    async def evaluate(self, expression: str) -> Any:
        result = await self.command(
            "Runtime.evaluate",
            {
                "expression": expression,
                "returnByValue": True,
                "awaitPromise": True,
            },
        )
        value = result["result"]
        if value.get("subtype") == "error":
            raise RuntimeError(value.get("description") or expression)
        return value.get("value")


def free_port() -> int:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def wait_json(url: str, timeout_seconds: float = 20) -> Any:
    deadline = time.monotonic() + timeout_seconds
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                return json.load(response)
        except Exception as error:
            last_error = error
            time.sleep(0.2)
    raise RuntimeError(f"timed out waiting for {url}: {last_error}")


async def analyze(
    page: CdpPage,
    *,
    page_url: str,
    video_path: Path,
    output_directory: Path,
) -> Path:
    await page.command("Page.navigate", {"url": page_url})
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if await page.evaluate("document.readyState") == "complete":
            break
        await asyncio.sleep(0.2)
    else:
        raise RuntimeError("analysis page did not finish loading")

    document = await page.command("DOM.getDocument")
    file_node = await page.command(
        "DOM.querySelector",
        {
            "nodeId": document["root"]["nodeId"],
            "selector": "#file",
        },
    )
    await page.command(
        "DOM.setFileInputFiles",
        {
            "nodeId": file_node["nodeId"],
            "files": [str(video_path.resolve())],
        },
    )
    await page.evaluate(
        "document.querySelector('#file').dispatchEvent("
        "new Event('change', { bubbles: true }))"
    )

    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        enabled = await page.evaluate(
            "!document.querySelector('#run').disabled"
        )
        if enabled:
            break
        await asyncio.sleep(0.2)
    else:
        diagnostic = await page.evaluate(
            "JSON.stringify({"
            "files: document.querySelector('#file').files.length,"
            "name: document.querySelector('#file').files[0]?.name,"
            "readyState: document.querySelector('#video').readyState,"
            "videoError: document.querySelector('#video').error?.message,"
            "metadata: document.querySelector('#metadata').textContent"
            "})"
        )
        raise RuntimeError(
            f"{video_path.name}: run button was not enabled: {diagnostic}"
        )

    await page.evaluate("document.querySelector('#run').click()")
    print(f"started {video_path.name}", flush=True)
    deadline = time.monotonic() + 20 * 60
    last_status = ""
    while time.monotonic() < deadline:
        status = str(
            await page.evaluate(
                "document.querySelector('#status').textContent"
            )
        )
        if status != last_status and (
            "%" in status or "완료" in status or "실패" in status
        ):
            print(f"{video_path.name}: {status}", flush=True)
            last_status = status
        download_enabled = await page.evaluate(
            "!document.querySelector('#download').disabled"
        )
        if download_enabled:
            break
        if "실패" in status:
            raise RuntimeError(f"{video_path.name}: {status}")
        await asyncio.sleep(1)
    else:
        raise RuntimeError(f"{video_path.name}: analysis timed out")

    await page.command(
        "Page.setDownloadBehavior",
        {
            "behavior": "allow",
            "downloadPath": str(output_directory.resolve()),
        },
    )
    expected = output_directory / (
        f"{video_path.stem}.external-analysis.json"
    )
    if expected.exists():
        expected.unlink()
    await page.evaluate("document.querySelector('#download').click()")
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if expected.exists() and not expected.with_suffix(
            expected.suffix + ".crdownload"
        ).exists():
            print(f"saved {expected}", flush=True)
            return expected
        await asyncio.sleep(0.2)
    raise RuntimeError(f"{video_path.name}: result download timed out")


async def run(args: argparse.Namespace) -> None:
    project = Path(args.project).resolve()
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    videos = [Path(item).resolve() for item in args.videos]
    chrome = Path(args.chrome).resolve()
    if not chrome.exists():
        raise FileNotFoundError(chrome)

    http_port = free_port()
    debug_port = free_port()
    profile = Path(tempfile.mkdtemp(prefix="fitform-cdp-"))
    server = subprocess.Popen(
        [
            shutil.which("python") or "python",
            "-m",
            "http.server",
            str(http_port),
            "--bind",
            "127.0.0.1",
        ],
        cwd=project,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    browser = subprocess.Popen(
        [
            str(chrome),
            "--headless=new",
            "--no-sandbox",
            "--disable-gpu",
            "--no-first-run",
            "--no-default-browser-check",
            "--remote-allow-origins=*",
            "--remote-debugging-address=127.0.0.1",
            f"--remote-debugging-port={debug_port}",
            f"--user-data-dir={profile}",
            "about:blank",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        targets = wait_json(f"http://127.0.0.1:{debug_port}/json/list")
        page_target = next(
            target for target in targets if target.get("type") == "page"
        )
        page_url = (
            f"http://127.0.0.1:{http_port}/web/external-video.html"
        )
        async with CdpPage(page_target["webSocketDebuggerUrl"]) as page:
            for video in videos:
                await analyze(
                    page,
                    page_url=page_url,
                    video_path=video,
                    output_directory=output,
                )
    finally:
        browser.terminate()
        server.terminate()
        browser.wait(timeout=10)
        server.wait(timeout=10)
        shutil.rmtree(profile, ignore_errors=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--chrome", required=True)
    parser.add_argument("videos", nargs="+")
    asyncio.run(run(parser.parse_args()))


if __name__ == "__main__":
    main()
