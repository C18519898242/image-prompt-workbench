from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence
from getpass import getpass

from app.auth import hash_password


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("hash-password", help="generate an Argon2id password hash")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command != "hash-password":
        return 2

    password = getpass("Password: ")
    confirmation = getpass("Confirm password: ")
    if not password:
        print("password must not be empty", file=sys.stderr)
        return 1
    if password != confirmation:
        print("passwords do not match", file=sys.stderr)
        return 1

    print(hash_password(password))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
