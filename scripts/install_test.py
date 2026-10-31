"""Installer regression tests with a fake launchd and fake HTTPS downloads.

No real service is installed. Run: python3 -m unittest discover -s scripts -p '*_test.py'
"""

import hashlib
import os
from pathlib import Path
import pty
import select
import signal
import tempfile
import time
import unittest
import zipfile


SCRIPT = Path(__file__).with_name("install.sh").resolve()


class InstallerTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="yandock-test-", dir=os.environ.get("TMPDIR"))
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.home = self.root / "home"
        self.home.mkdir()
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.env = dict(os.environ, HOME=str(self.home), PATH=f"{self.bin}:/usr/bin:/bin", SHELL="/bin/sh")
        self.env.pop("SUDO_USER", None)
        self.script = self.root / "install.sh"
        self.script.write_text(SCRIPT.read_text().replace("/usr/local/bin", str(self.root / "usr/local/bin")))
        self.command("id", 'case "$1" in -u) echo 501;; -un) echo tester;; esac')
        self.command("uname", 'case "$1" in -s) echo Darwin;; -m) echo arm64;; esac')
        self.command("launchctl", """
case "$1" in
  bootstrap)
    if [ "${TEST_BOOTSTRAP_FAIL:-}" = 1 ]; then
      printf 'Bootstrap failed: 5: Input/output error\\n' >&2
      exit 5
    fi
    ;;
  print)
    printf 'path = %s\\n' "$HOME/Library/LaunchAgents/io.yandock.user.plist"
    ;;
esac
printf 'state = running\\n'
""")
        self.command("plutil", "exit 0")
        self.command("sudo", "exit 99")
        self.command("install", """
mode=755 directory=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o|-g) shift 2;;
    -m) mode=$2; shift 2;;
    -d) directory=true; shift;;
    *) break;;
  esac
done
if [ "$directory" = true ]; then mkdir -p "$1"; chmod "$mode" "$1"
else /usr/bin/install -m "$mode" "$@"; fi
""")
        self.command("curl", """
out= url=
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) out=$2; shift 2;;
    https://*|http://*) url=$1; shift;;
    *) shift;;
  esac
done
case "$url" in
  */SHA256SUMS) printf '%s  %s\\n' "$TEST_HASH" "$TEST_ASSET" > "$out";;
  https://*) cp "$TEST_ARCHIVE" "$out";;
  */api/sessions) printf 401;;
  *) printf 200;;
esac
""")
        self.configure_archive("yandock-darwin-arm64.zip")

    def configure_archive(self, asset, member=None):
        archive_path = self.root / asset
        with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_STORED) as archive:
            archive.writestr(member or asset.removesuffix(".zip"), b"fixture binary")
        self.env["TEST_ASSET"] = asset
        self.env["TEST_ARCHIVE"] = str(archive_path)
        self.env["TEST_HASH"] = hashlib.sha256(archive_path.read_bytes()).hexdigest()

    def command(self, name, body):
        path = self.bin / name
        path.write_text("#!/bin/sh\nset -eu\n" + body + "\n")
        path.chmod(0o700)

    def run_installer(self, args, replies):
        pid, fd = pty.fork()
        if pid == 0:
            os.execve("/bin/sh", ["sh", str(self.script), *args], self.env)
        output = b""
        deadline = time.monotonic() + 15
        try:
            for prompt, reply in replies:
                while prompt.encode() not in output:
                    if time.monotonic() >= deadline:
                        self.fail(f"Timed out waiting for {prompt}: {output!r}")
                    if select.select([fd], [], [], 0.1)[0]:
                        output += os.read(fd, 65536)
                output = output.split(prompt.encode(), 1)[1]
                os.write(fd, reply.encode() + b"\n")
            while True:
                done, status = os.waitpid(pid, os.WNOHANG)
                if done:
                    return os.waitstatus_to_exitcode(status)
                if time.monotonic() >= deadline:
                    self.fail("Installer did not exit")
                if select.select([fd], [], [], 0.1)[0]:
                    try:
                        output += os.read(fd, 65536)
                    except OSError:
                        pass
        finally:
            os.close(fd)
            try:
                os.kill(pid, signal.SIGKILL)
                os.waitpid(pid, 0)
            except ProcessLookupError:
                pass

    def test_install_and_uninstall_preserve_project_and_quote_settings(self):
        bin_dir = self.root / "usr/local/bin"
        self.script = self.root / "install.sh"
        self.script.write_text(SCRIPT.read_text().replace("/usr/local/bin", str(bin_dir)))
        self.command("sudo", 'if [ "$1" = -v ]; then exit 0; fi\nexec "$@"')
        work = self.root / "project 'quoted' $HOME"
        work.mkdir()
        project_file = work / "keep.txt"
        project_file.write_text("keep")
        code = self.run_installer(["install"], [
            ("监听 IP 地址", "192.168.1.50"), ("监听端口", "8081"), ("终端工作目录", str(work)),
            ("访问密码：", "test-password"), ("确认密码：", "test-password"),
            ("确认安装并立即启用自启动？", "y"),
        ])
        self.assertEqual(code, 0)
        base = self.home / ".local/share/yandock"
        binary = bin_dir / "yandock"
        config = self.home / ".config/yandock"
        self.assertEqual(binary.read_bytes(), b"fixture binary")
        self.assertEqual(binary.stat().st_mode & 0o777, 0o755)
        self.assertEqual((config / "password").read_text(), "test-password")
        self.assertEqual((config / "password").stat().st_mode & 0o777, 0o600)
        self.assertEqual(config.stat().st_mode & 0o777, 0o700)
        self.assertFalse((base / "password").exists())
        settings = (config / "settings").read_text()
        self.assertNotIn("test-password", settings)
        self.assertIn(f"binary='{binary}'", settings)
        self.assertIn("listen='192.168.1.50:8081'", settings)
        import subprocess
        result = subprocess.check_output([
            "/bin/sh", "-c", '. "$1"; printf "%s" "$work"', "sh", str(config / "settings")
        ], env=self.env, text=True)
        self.assertEqual(result, str(work.resolve()))
        self.assertTrue((self.home / "Library/LaunchAgents/io.yandock.user.plist").exists())
        code = self.run_installer(["uninstall"], [("[y/N]：", "y")])
        self.assertEqual(code, 0)
        self.assertFalse(base.exists())
        self.assertFalse(binary.exists())
        self.assertFalse(config.exists())
        self.assertEqual(project_file.read_text(), "keep")

        code = self.run_installer(["install"], [
            ("监听 IP 地址", "::1"), ("监听端口", "8081"), ("终端工作目录", str(work)),
            ("访问密码：", "test-password"), ("确认密码：", "test-password"),
            ("确认安装并立即启用自启动？", "y"),
        ])
        self.assertEqual(code, 0)
        self.assertIn("listen='[::1]:8081'", (config / "settings").read_text())
        self.assertEqual(self.run_installer(["uninstall"], [("[y/N]：", "y")]), 0)

    def test_bad_checksum_does_not_install(self):
        self.env["TEST_HASH"] = "0" * 64
        self.assertNotEqual(self.run_installer(["install", "--repo", "example/YanDock"], []), 0)
        self.assertFalse((self.home / ".local/share/yandock").exists())

    def test_install_handles_already_loaded_launchagent(self):
        bin_dir = self.root / "usr/local/bin"
        self.script = self.root / "install.sh"
        self.script.write_text(SCRIPT.read_text().replace("/usr/local/bin", str(bin_dir)))
        self.command("sudo", '[ "$1" != -v ] || exit 0\nexec "$@"')
        self.env["TEST_BOOTSTRAP_FAIL"] = "1"
        code = self.run_installer(["install", "--repo", "example/YanDock"], [
            ("监听 IP 地址", ""), ("监听端口", ""), ("终端工作目录", ""),
            ("访问密码：", "test-password"), ("确认密码：", "test-password"),
            ("确认安装并立即启用自启动？", "y"),
        ])
        self.assertEqual(code, 0)
        self.assertIn("listen='0.0.0.0:8080'", (self.home / ".config/yandock/settings").read_text())
        self.assertTrue((self.home / "Library/LaunchAgents/io.yandock.user.plist").exists())
        self.assertEqual(self.run_installer(["uninstall"], [("[y/N]：", "y")]), 0)

    def test_zip_missing_platform_binary_does_not_install(self):
        self.configure_archive("yandock-darwin-arm64.zip", member="unexpected-name")
        self.assertNotEqual(self.run_installer(["install", "--repo", "example/YanDock"], []), 0)
        self.assertFalse((self.home / ".local/share/yandock").exists())

    def test_root_reaches_confirmation_without_sudo(self):
        self.command("id", 'case "$1" in -u) echo 0;; -un) echo root;; esac')
        code = self.run_installer(["install", "--repo", "example/YanDock"], [
            ("监听 IP 地址", ""), ("监听端口", ""), ("终端工作目录", ""),
            ("访问密码：", "test-password"), ("确认密码：", "test-password"),
            ("警告：服务和所有新终端将以 root 运行", ""),
            ("确认安装并立即启用自启动？", "n"),
        ])
        self.assertNotEqual(code, 0)
        self.assertFalse((self.home / ".local/share/yandock").exists())

    def test_invalid_port_does_not_write_installation(self):
        code = self.run_installer(["install", "--repo", "example/YanDock"], [
            ("监听 IP 地址", ""), ("监听端口", "70000"),
        ])
        self.assertNotEqual(code, 0)
        self.assertFalse((self.home / ".local/share/yandock").exists())

    def test_invalid_bind_address_does_not_write_installation(self):
        code = self.run_installer(["install", "--repo", "example/YanDock"], [
            ("监听 IP 地址", "example.com"),
        ])
        self.assertNotEqual(code, 0)
        self.assertFalse((self.home / ".local/share/yandock").exists())

    def test_declining_confirmation_preserves_home(self):
        code = self.run_installer(["install", "--repo", "example/YanDock", "--version", "v0.1.0"], [
            ("监听 IP 地址", ""), ("监听端口", ""), ("终端工作目录", ""),
            ("访问密码：", "test-password"), ("确认密码：", "test-password"),
            ("确认安装并立即启用自启动？", "n"),
        ])
        self.assertNotEqual(code, 0)
        self.assertFalse((self.home / ".local/share/yandock").exists())

    def test_linux_single_instance_paths_and_uninstall(self):
        self.check_linux_installation("systemd")

    def test_openrc_system_paths_and_uninstall(self):
        self.check_linux_installation("openrc")

    def check_linux_installation(self, manager):
        # Redirect system paths in a test copy, never touch the host /etc or /run.
        etc = self.root / "etc"
        run = self.root / "run"
        (etc / "systemd/system").mkdir(parents=True)
        (etc / "init.d").mkdir()
        if manager == "systemd":
            (run / "systemd/system").mkdir(parents=True)
        else:
            (run / "openrc").mkdir(parents=True)
            self.command("rc-service", "exit 0")
            self.command("rc-update", "echo yandock")
        self.script = self.root / "install.sh"
        self.script.write_text(SCRIPT.read_text().replace("/etc/", f"{etc}/").replace("/run/", f"{run}/").replace("/usr/local/", f"{self.root}/usr/local/"))
        self.command("uname", 'case "$1" in -s) echo Linux;; -m) echo aarch64;; esac')
        self.command("systemctl", "exit 0")
        self.command("sudo", '[ "$1" != -v ] || exit 0\nexec "$@"')
        # Ownership is checked separately on real platforms; a sandbox cannot chown.
        self.command("install", """
mode=755 directory=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o|-g) shift 2;;
    -m) mode=$2; shift 2;;
    -d) directory=true; shift;;
    *) break;;
  esac
done
if [ "$directory" = true ]; then mkdir -p "$1"; chmod "$mode" "$1"
else /usr/bin/install -m "$mode" "$@"; fi
""")
        self.configure_archive("yandock-linux-arm64.zip")
        code = self.run_installer(["install", "--repo", "example/YanDock"], [
            ("监听 IP 地址", ""), ("监听端口", ""), ("终端工作目录", ""),
            ("访问密码：", "test-password"), ("确认密码：", "test-password"),
            ("确认安装并立即启用自启动？", "y"),
        ])
        self.assertEqual(code, 0)
        config = etc / "yandock"
        self.assertEqual((config / "password").read_text(), "test-password")
        self.assertEqual(config.stat().st_mode & 0o777, 0o700)
        self.assertEqual((config / "password").stat().st_mode & 0o777, 0o600)
        binary = self.root / "usr/local/bin/yandock"
        self.assertEqual(binary.read_bytes(), b"fixture binary")
        self.assertEqual(binary.stat().st_mode & 0o777, 0o755)
        base = self.root / "usr/local/libexec/yandock"
        self.assertEqual((base / "run").stat().st_mode & 0o777, 0o755)
        self.assertTrue((base / "installed").exists())
        self.assertFalse((self.home / ".env").exists())
        unit = etc / ("systemd/system/yandock.service" if manager == "systemd" else "init.d/yandock")
        self.assertIn(f"/run {config}", unit.read_text())
        self.assertIn(str(base / "run"), unit.read_text())
        self.assertFalse((self.home / ".local/share/yandock/password").exists())
        self.assertNotEqual(self.run_installer(["install"], []), 0)
        self.assertEqual(binary.read_bytes(), b"fixture binary")
        self.assertEqual(self.run_installer(["uninstall"], [("[y/N]：", "y")]), 0)
        self.assertFalse(config.exists())
        self.assertFalse(binary.exists())
        self.assertFalse(unit.exists())
        self.assertFalse(base.exists())
        self.assertTrue(binary.parent.exists())

        old_base = self.home / ".local/share/yandock"
        old_base.mkdir(parents=True)
        (old_base / "installed").write_text(manager)
        self.assertNotEqual(self.run_installer(["install"], []), 0)
        self.assertEqual((old_base / "installed").read_text(), manager)
        self.assertFalse(base.exists())
        self.assertFalse(binary.exists())


if __name__ == "__main__":
    unittest.main()
