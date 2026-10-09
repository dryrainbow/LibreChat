#!/usr/bin/env python3
"""Archive committed source and browser bundles without runtime credentials."""
import hashlib
import json
import pathlib
import subprocess
import sys
import tarfile

BASE = "e8f3be08623663d4ad7f7241e693c94469b63bb0"
IMAGE_DIGEST = "sha256:0dba606ca84b6fdf313718d11e4fbf6874baf0122269676d83db3987377151e2"
DIST_ROOTS = (
    "client/dist", "packages/data-provider/dist", "packages/data-schemas/dist",
    "packages/api/dist", "packages/client/dist",
)
BACKEND_ROOTS = ("api/", "packages/api/", "packages/data-schemas/", "packages/data-provider/")
BACKEND_FILES = {"package.json", "package-lock.json", "Dockerfile", "Dockerfile.multi"}


def output(*args):
    return subprocess.check_output(args, text=True).strip()


def safe_path(name):
    path = pathlib.PurePosixPath(name)
    return not (
        path.is_absolute() or ".." in path.parts
        or any(p in {".git", "node_modules", ".secrets", "runtime"} for p in path.parts)
        or any((p == ".env" or p.startswith(".env.")) and not p.endswith(".example")
               for p in path.parts)
        or path.name in {"app.env", "mongo-uri", "mongo-uri-docker"}
        or path.name.endswith((".key", ".pem"))
    )


def main():
    repo = pathlib.Path(__file__).resolve().parents[2]
    if output("git", "-C", str(repo), "status", "--porcelain", "--untracked-files=normal"):
        raise SystemExit("Commit or remove pending changes before packaging.")
    commit = output("git", "-C", str(repo), "rev-parse", "HEAD")
    changed = output("git", "-C", str(repo), "diff", "--name-only", BASE, commit).splitlines()
    backend = [p for p in changed if p.startswith(BACKEND_ROOTS) or p in BACKEND_FILES]
    if backend:
        raise SystemExit("Backend/shared contract changes require a new ARM64 image: " + ", ".join(backend))
    tracked = subprocess.check_output(
        ["git", "-C", str(repo), "ls-files", "-z"], text=True).split("\0")
    names = {name for name in tracked if name and safe_path(name)}
    for dist in DIST_ROOTS:
        root = repo / dist
        if not root.is_dir() or not any(root.iterdir()):
            raise SystemExit(f"Missing built bundle: {dist}")
        for file in root.rglob("*"):
            if file.is_symlink():
                raise SystemExit(f"Bundle symlink is unsupported: {file}")
            if file.is_file():
                name = file.relative_to(repo).as_posix()
                if not safe_path(name):
                    raise SystemExit(f"Unsafe bundle path: {name}")
                names.add(name)
    if not (repo / "client/dist/index.html").is_file():
        raise SystemExit("Missing browser entry point.")
    dest = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else repo.parent / "artifacts").resolve()
    dest.mkdir(parents=True, exist_ok=True, mode=0o700)
    version = json.loads((repo / "package.json").read_text())["version"].lstrip("v")
    release = f"v{version}-{commit[:12]}"
    archive = dest / f"librechat-{release}-source-dist.tar.gz"
    if archive.exists():
        raise SystemExit(f"Artifact exists; choose a new ARTIFACT_DIR: {archive}")
    with tarfile.open(archive, "w:gz") as tar:
        for name in sorted(names):
            file = repo / name
            if file.is_symlink() and not file.resolve().is_relative_to(repo):
                raise SystemExit(f"Source symlink escapes repository: {name}")
            tar.add(file, arcname=f"librechat/{name}", recursive=False)
    archive.chmod(0o600)
    digest = hashlib.file_digest(archive.open("rb"), "sha256").hexdigest()
    checksum = pathlib.Path(str(archive) + ".sha256")
    checksum.write_text(f"{digest}  {archive.name}\n")
    checksum.chmod(0o600)
    manifest = dest / f"librechat-{release}-manifest.json"
    manifest.write_text(json.dumps({
        "release": release,
        "commit": commit,
        "branch": output("git", "-C", str(repo), "branch", "--show-current"),
        "runtime_base_commit": BASE,
        "runtime_image_digest": IMAGE_DIGEST,
        "node": output("node", "--version"),
        "npm": output("npm", "--version"),
        "archive": archive.name,
        "archive_sha256": digest,
        "archive_bytes": archive.stat().st_size,
        "archive_members": len(names),
        "dist_roots": DIST_ROOTS,
        "changed_since_runtime": changed,
        "deployment_scope": "client/dist only",
        "excluded": [".git", "node_modules", "runtime", "private environment files", "keys"],
    }, indent=2) + "\n")
    manifest.chmod(0o600)
    print(json.dumps({"archive": str(archive), "manifest": str(manifest), "sha256": digest}))


if __name__ == "__main__":
    main()
