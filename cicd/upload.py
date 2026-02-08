#!/usr/bin/env python3
"""上传 Obsidian 插件 zip 到 OSS（官方 oss2 SDK 方式）。"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from urllib.parse import quote


DEFAULT_ZIP_PATH = "dist/obsidian-publish-everywhere.zip"
DEFAULT_BUCKET = "fine-build"
DEFAULT_OBJECT_KEY = "test/obsidian-publish-everywhere.zip"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Upload plugin zip to OSS")
    parser.add_argument(
        "--file",
        default=DEFAULT_ZIP_PATH,
        help=f"Local zip file path (default: {DEFAULT_ZIP_PATH})",
    )
    parser.add_argument(
        "--object-key",
        default=DEFAULT_OBJECT_KEY,
        help=f"OSS object key (default: {DEFAULT_OBJECT_KEY})",
    )
    return parser.parse_args()


def require_env(name: str, aliases: tuple[str, ...] = ()) -> str:
    candidates = (name,) + aliases
    for var_name in candidates:
        value = os.getenv(var_name, "").strip()
        if value:
            return value
    all_names = ", ".join(candidates)
    raise RuntimeError(f"Missing required env var: {all_names}")


def normalize_endpoint(raw_endpoint: str) -> str:
    endpoint = raw_endpoint.strip()
    if endpoint.startswith("http://") or endpoint.startswith("https://"):
        return endpoint.rstrip("/")
    return f"https://{endpoint.strip('/') }"


def build_public_url(endpoint: str, bucket: str, object_key: str) -> str:
    host = endpoint.replace("https://", "").replace("http://", "")
    encoded_key = quote(object_key)
    return f"https://{bucket}.{host}/{encoded_key}"


def upload_with_oss2(local_file: Path, endpoint: str, bucket_name: str, object_key: str) -> None:
    try:
        import oss2
    except ModuleNotFoundError as error:
        raise RuntimeError("Python package 'oss2' not installed, run: pip3 install oss2") from error

    access_key_id = require_env("FINE_OSS_ACCESS_KEY_ID", aliases=("FINE_OSS_ID",))
    access_key_secret = require_env("FINE_OSS_ACCESS_KEY_SECRET", aliases=("FINE_OSS_SECRET",))
    security_token = os.getenv("FINE_OSS_SECURITY_TOKEN", "").strip()

    auth = oss2.Auth(access_key_id, access_key_secret)
    if security_token:
        auth = oss2.StsAuth(access_key_id, access_key_secret, security_token)

    bucket = oss2.Bucket(auth, endpoint, bucket_name)
    result = bucket.put_object_from_file(object_key, str(local_file))
    if result.status < 200 or result.status >= 300:
        raise RuntimeError(f"OSS upload failed, status={result.status}")


def main() -> int:
    try:
        args = parse_args()
        local_file = Path(args.file)
        if not local_file.is_file():
            raise RuntimeError(f"File not found: {local_file}")

        endpoint = normalize_endpoint(require_env("FINE_OSS_ENDPOINT"))
        bucket_name = os.getenv("FINE_OSS_BUCKET", DEFAULT_BUCKET).strip() or DEFAULT_BUCKET
        object_key = args.object_key.strip("/")
        if not object_key:
            raise RuntimeError("object key must not be empty")

        upload_with_oss2(local_file, endpoint, bucket_name, object_key)

        download_url = build_public_url(endpoint, bucket_name, object_key)
        print(f"Uploaded: {local_file}")
        print(f"OSS Path: oss://{bucket_name}/{object_key}")
        print(f"URL: {download_url}")
        print(f"下载地址: {download_url}")
        return 0
    except Exception as error:
        print(f"upload failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
