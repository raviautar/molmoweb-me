#!/usr/bin/env python3
"""Smoke test for the MolmoWeb model server.

Sends an included screenshot of the Ai2 careers page to a running /predict
endpoint and prints the model's response.

Usage:
    python scripts/test_server.py
    python scripts/test_server.py --endpoint http://myhost:8002
"""
import argparse
import base64
from pathlib import Path

import requests

import config

IMAGE_PATH = Path(__file__).resolve().parent.parent / "assets" / "test_screenshot.png"


def _parse_args() -> argparse.Namespace:
    # Step 1: Parse the optional endpoint override while keeping the shared config default.
    parser = argparse.ArgumentParser(description="Smoke test the MolmoWeb model server.")
    parser.add_argument("--endpoint", default=config.get_default_model_endpoint())
    return parser.parse_args()


def main():
    # Step 1: Parse the CLI arguments before building the request payload.
    args = _parse_args()

    # Step 2: Stop early when the bundled smoke-test screenshot is missing.
    if not IMAGE_PATH.exists():
        print(f"Error: {IMAGE_PATH} not found.")
        raise SystemExit(1)

    # Step 3: Encode the bundled screenshot once for the predict request.
    image_b64 = base64.b64encode(IMAGE_PATH.read_bytes()).decode("utf-8")

    # Step 4: Build the predict URL from the configured endpoint.
    url = f"{args.endpoint.rstrip('/')}{config.MODEL_SERVICE_PREDICT_PATH}"
    print(f"Endpoint: {url}")
    print(f"Image:    {IMAGE_PATH}")
    print(f"Prompt:   {config.TEST_SERVER_PROMPT}")
    print()

    # Step 5: Call the model server and report the response or connection failure.
    try:
        resp = requests.post(
            url,
            json={"prompt": config.TEST_SERVER_PROMPT, "image_base64": image_b64},
            timeout=config.PREDICT_REQUEST_TIMEOUT_SECONDS,
        )
        resp.raise_for_status()
    except requests.ConnectionError:
        print("Error: Could not connect to the model server.")
        print(f"Make sure the server is running at {args.endpoint}")
        raise SystemExit(1)

    # Step 6: Print the JSON response payload for quick inspection.
    print("Model response:")
    print(resp.json())


if __name__ == "__main__":
    main()
