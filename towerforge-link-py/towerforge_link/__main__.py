"""CLI entry point for `towerforge-link-py` (`python3 -m towerforge_link`)."""

from __future__ import annotations

import argparse
import json
import sys
from typing import Sequence

from . import __version__
from . import exporter, http_server, usb_owner
from .adb_finder import AdbError, find_adb
from .adb_runner import TIMEOUT_STATUS, run_adb


def build_parser() -> argparse.ArgumentParser:
    """Construct the CLI argument parser for `towerforge-link`."""
    parser = argparse.ArgumentParser(
        prog="towerforge-link",
        description="Hardened macOS & Linux companion for TowerForge Link.",
    )
    parser.add_argument(
        "--version",
        action="version",
        version=f"%(prog)s {__version__}",
    )
    parser.add_argument(
        "--adb-path",
        dest="adb_path",
        default=None,
        help="Explicit path to a trusted system adb binary (overrides TOWERFORGE_ADB_PATH).",
    )

    subparsers = parser.add_subparsers(dest="command")

    doctor_parser = subparsers.add_parser(
        "doctor",
        help="Verify system adb binary discovery, permissions, and connected devices.",
    )
    doctor_parser.add_argument(
        "--json",
        action="store_true",
        help="Emit diagnostic output as JSON.",
    )

    status_parser = subparsers.add_parser(
        "status",
        help="Verify system adb binary discovery, permissions, and connected devices (alias for doctor).",
    )
    status_parser.add_argument(
        "--json",
        action="store_true",
        help="Emit diagnostic output as JSON.",
    )

    serve_parser = subparsers.add_parser(
        "serve",
        help="Run the local loopback HTTP server on 127.0.0.1:47821.",
    )
    serve_parser.add_argument(
        "--bind",
        default="127.0.0.1",
        help="Bind address (default: 127.0.0.1).",
    )
    serve_parser.add_argument(
        "--port",
        type=int,
        default=47821,
        help="Bind TCP port (default: 47821).",
    )
    serve_parser.add_argument(
        "--allow-non-loopback-debug",
        action="store_true",
        help="Allow binding to a non-loopback address for container/remote debugging.",
    )

    pull_parser = subparsers.add_parser(
        "pull",
        help="Pull tool_export.json or optional playerInfo.dat save backup via CLI.",
    )
    pull_parser.add_argument(
        "--serial",
        default=None,
        help="Optional target device serial.",
    )
    pull_parser.add_argument(
        "--source",
        default=None,
        help="Optional discovered source identifier (e.g. adb:<serial>, waydroid:local).",
    )
    pull_parser.add_argument(
        "--pull-save",
        action="store_true",
        help="Pull playerInfo.dat backup into --output-dir.",
    )
    pull_parser.add_argument(
        "--output-dir",
        default=".",
        help="Destination directory for pulled artifacts.",
    )

    udev_parser = subparsers.add_parser(
        "udev-rules",
        help="Print hardened Linux systemd uaccess udev rules (51-android-adb-uaccess.rules) and installation steps.",
    )
    udev_parser.add_argument(
        "--rule-only",
        action="store_true",
        help="Print only the raw udev rule without installation instructions.",
    )

    return parser


def _cmd_doctor(adb_path_arg: str | None, as_json: bool) -> int:
    """Execute the `doctor` subcommand to validate ADB discovery and version."""
    try:
        resolved_adb = find_adb(explicit_path=adb_path_arg)
        version_res = run_adb(resolved_adb, ["version"], timeout=TIMEOUT_STATUS)
        devices_res = run_adb(resolved_adb, ["devices", "-l"], timeout=TIMEOUT_STATUS)
        payload = {
            "ok": True,
            "adb_path": resolved_adb,
            "version_output": version_res.stdout.strip(),
            "devices_output": devices_res.stdout.strip(),
        }
        if as_json:
            print(json.dumps(payload, indent=2))
        else:
            print(f"ADB binary: {resolved_adb}")
            print(version_res.stdout.strip())
            print(devices_res.stdout.strip())
        return 0
    except AdbError as exc:
        if as_json:
            print(json.dumps({"ok": False, "error": str(exc)}, indent=2))
        else:
            print(f"Error: {exc}", file=sys.stderr)
        return 1


def main(argv: Sequence[str] | None = None) -> int:
    """Main CLI dispatcher for `towerforge-link`."""
    parser = build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)

    command = args.command or "serve"
    if command in {"doctor", "status"}:
        return _cmd_doctor(args.adb_path, getattr(args, "json", False))

    if command == "serve":
        serve_fn = globals().get("serve_forever")
        if __package__:
            http_mod = sys.modules.get(f"{__package__}.http_server") or globals().get("http_server")
            if http_mod is not None:
                serve_fn = getattr(http_mod, "serve_forever", serve_fn)
        if not callable(serve_fn):
            print("HTTP server module is not yet registered.", file=sys.stderr)
            return 1
        return int(
            serve_fn(
                bind=getattr(args, "bind", "127.0.0.1"),
                port=int(getattr(args, "port", 47821)),
                adb_path=args.adb_path,
                allow_non_loopback_debug=bool(getattr(args, "allow_non_loopback_debug", False)),
            )
            or 0
        )

    if command == "pull":
        cli_pull = globals().get("run_cli_pull")
        if __package__:
            exp_mod = sys.modules.get(f"{__package__}.exporter") or globals().get("exporter")
            if exp_mod is not None:
                cli_pull = getattr(exp_mod, "run_cli_pull", cli_pull)
        if not callable(cli_pull):
            print("Exporter module is not yet registered.", file=sys.stderr)
            return 1
        return int(
            cli_pull(
                adb_path=args.adb_path,
                serial=args.serial,
                source=getattr(args, "source", None),
                pull_save=args.pull_save,
                output_dir=args.output_dir,
            )
            or 0
        )

    if command == "udev-rules":
        udev_fn = globals().get("print_udev_rules")
        if __package__:
            usb_mod = sys.modules.get(f"{__package__}.usb_owner") or globals().get("usb_owner")
            if usb_mod is not None:
                udev_fn = getattr(usb_mod, "print_udev_rules", udev_fn)
        if callable(udev_fn):
            return int(udev_fn(rule_only=getattr(args, "rule_only", False)) or 0)
        return 0

    parser.print_help()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
