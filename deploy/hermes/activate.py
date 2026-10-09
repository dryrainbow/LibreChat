#!/usr/bin/env python3
"""Verify a browser release, atomically select it, and restore on failed health."""
import fcntl
import hashlib
import json
import os
import pathlib
import re
import subprocess
import sys
import tarfile
import time
import urllib.error
import urllib.request

IMAGE_DIGEST = "sha256:0dba606ca84b6fdf313718d11e4fbf6874baf0122269676d83db3987377151e2"


def compose(root):
    subprocess.run([
        "docker", "compose", "-p", "librechat", "--env-file", str(root / "runtime/app.env"),
        "-f", str(root / "runtime/compose.yaml"), "up", "-d", "--force-recreate", "app",
    ], check=True)


def healthy():
    for _ in range(30):
        try:
            with urllib.request.urlopen("http://127.0.0.1:3080/readyz", timeout=3) as response:
                if response.status == 200:
                    return True
        except (urllib.error.URLError, TimeoutError):
            pass
        time.sleep(2)
    return False


def select(root, target):
    temporary = root / "current.next"
    temporary.unlink(missing_ok=True)
    temporary.symlink_to(target, target_is_directory=True)
    os.replace(temporary, root / "current")


def main():
    if len(sys.argv) != 3:
        raise SystemExit("Usage: activate.py ARCHIVE MANIFEST")
    os.umask(0o077)
    root = pathlib.Path.home() / ".local/share/librechat"
    archive, manifest_path = (pathlib.Path(x).resolve() for x in sys.argv[1:])
    manifest = json.loads(manifest_path.read_text())
    release = manifest["release"]
    if not re.fullmatch(r"v[0-9a-z.-]+", release):
        raise SystemExit("Invalid release ID.")
    if manifest["runtime_image_digest"] != IMAGE_DIGEST:
        raise SystemExit("Runtime image change needs a separate ARM64 deployment.")
    if archive.name != manifest["archive"]:
        raise SystemExit("Manifest archive name mismatch.")
    with archive.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    checksum = pathlib.Path(str(archive) + ".sha256").read_text().split()
    if checksum != [digest, archive.name] or digest != manifest["archive_sha256"]:
        raise SystemExit("Archive checksum mismatch.")
    for name in ("compose.yaml", "app.env", "librechat.yaml"):
        if not (root / "runtime" / name).is_file():
            raise SystemExit(f"Missing private runtime/{name}; initialize production separately.")
    lock = (root / "deploy.lock").open("w")
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    current = root / "current"
    if not current.is_symlink():
        raise SystemExit("current must be an existing release symlink.")
    previous = current.resolve(strict=True)
    releases = root / "releases"
    target = releases / release / "librechat"
    if not previous.is_relative_to(releases.resolve()):
        raise SystemExit("Current release is outside releases/.")
    if target.parent.exists():
        raise SystemExit("Release ID already exists; package a new commit.")
    target.parent.mkdir(parents=True, mode=0o700)
    with tarfile.open(archive, "r:gz") as tar:
        members = tar.getmembers()
        for member in members:
            path = pathlib.PurePosixPath(member.name)
            if path.is_absolute() or ".." in path.parts or path.parts[0] != "librechat":
                raise SystemExit("Archive path is outside librechat/.")
            if member.issym() or member.islnk() or not (member.isfile() or member.isdir()):
                raise SystemExit("Archive links/devices are unsupported.")
            if any(p in {".git", "node_modules", ".secrets", "runtime"} for p in path.parts):
                raise SystemExit("Archive contains excluded runtime material.")
        tar.extractall(target.parent, members=members, filter="data")
    index = target / "client/dist/index.html"
    if not index.is_file():
        raise SystemExit("Release has no browser entry point.")
    (target.parent / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    try:
        select(root, target)
        compose(root)
        if not healthy():
            raise RuntimeError("App health failed after release selection.")
        # The API must serve the newly mounted bundle, not a stale Docker mount.
        with urllib.request.urlopen("http://127.0.0.1:3080/", timeout=10) as response:
            html = response.read().decode()
        scripts = re.findall(r'src="([^"]+\.js)"', index.read_text())
        if not scripts or any(script not in html for script in scripts):
            raise RuntimeError("Served browser bundle does not match this release.")
    except Exception:
        select(root, previous)
        compose(root)
        restored = healthy()
        print(json.dumps({"release": release, "rolled_back_to": str(previous), "rollback_healthy": restored}))
        raise
    print(json.dumps({"release": release, "current": str(target), "health": "ok"}))


if __name__ == "__main__":
    main()
