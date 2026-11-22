"""Create the App Service ZIP from the compiled dashboard and a production install."""

import re
import sys
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


ROOT = Path(__file__).resolve().parents[1]
DATASETS = ("01_paysim_style", "02_credit_card_style", "03_ieee_cis_style")
SECRET_FILE = re.compile(r"^\.env(?:\..*)?$|^\.(?:npmrc|pypirc|netrc)$|\.(?:key|pem|pfx|p12)$", re.I)
PRIVATE_KEY = re.compile(rb"-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----\s+[A-Za-z0-9+/=]{32,}")


def add(archive, source, name):
    if source.is_symlink() or not source.is_file() or SECRET_FILE.search(source.name):
        raise ValueError(f"Unexpected release input: {name}")
    content = source.read_bytes()
    if PRIVATE_KEY.search(content):
        raise ValueError(f"Private key material detected in {name}")
    info = ZipInfo(name)
    info.create_system = 3
    info.external_attr = 0o100644 << 16
    archive.writestr(info, content, compress_type=ZIP_DEFLATED, compresslevel=1)


def package(modules, destination):
    if not (modules / "express" / "package.json").is_file():
        raise ValueError("Expected a hoisted production dependency installation")
    with ZipFile(destination, "x", compression=ZIP_DEFLATED, compresslevel=1) as archive:
        inputs = ["package.json", "dist/index.js", "dist/public/index.html", "data/reputation/domains.json"]
        for dataset in DATASETS:
            for filename in ("train_80.xlsx", "test_20.xlsx", "metadata.json"):
                inputs.append(f"datasets/{dataset}/{filename}")
        for asset in sorted((ROOT / "dist/public/assets").iterdir()):
            if not re.fullmatch(r"[\w.-]+-[\w-]{8}\.(?:css|js)", asset.name):
                raise ValueError(f"Review new frontend asset before packaging: {asset.name}")
            inputs.append(asset.relative_to(ROOT).as_posix())
        for name in inputs:
            add(archive, ROOT / name, name)
        for source in sorted(modules.rglob("*")):
            relative = source.relative_to(modules)
            if any(part in (".bin", ".pnpm") for part in relative.parts):
                continue  # Package manager tools and metadata in a hoisted install.
            if relative.name in (".modules.yaml", ".pnpm-workspace-state.json"):
                continue
            if source.is_symlink() or not source.is_dir():
                add(archive, source, "node_modules/" + relative.as_posix())


if __name__ == "__main__":
    package(Path(sys.argv[1]), Path(sys.argv[2]))
