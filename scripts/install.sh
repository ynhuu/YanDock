#!/bin/sh
# Interactive installer; can run via sh or bash stdin. Requires a controlling terminal.
set -eu
umask 077

die() { printf '%s\n' "错误：$*" >&2; exit 1; }
say() { printf '%s\n' "$*"; }
usage() {
  cat <<'EOF'
用法：sh scripts/install.sh install [--version vX.Y.Z] [--repo owner/repo]
      sh scripts/install.sh uninstall
      sh scripts/install.sh --help

默认从 ynhuu/YanDock 下载 latest Release；版本参数使用完整 tag，可选 --repo 覆盖仓库。
服务以调用脚本的用户运行（允许 root），sudo 调用时使用 SUDO_USER。
Linux 安装/卸载系统服务需 sudo；macOS 二进制安装到 /usr/local/bin 需管理员授权，LaunchAgent 在用户登录后自启动。
Release 必须包含 yandock-<系统>-<架构>.zip 和 SHA256SUMS。
EOF
}

action=${1:---help}
case "$action" in --help|-h) usage; exit 0;; install|uninstall) shift;; *) usage; exit 1;; esac
repo=ynhuu/YanDock version=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --repo) [ "$#" -ge 2 ] || die '--repo 缺少参数'; repo=$2; shift 2;;
    --version) [ "$#" -ge 2 ] || die '--version 缺少参数'; version=$2; shift 2;;
    *) die "未知参数：$1";;
  esac
done

user=$(id -un)
if [ "$(id -u)" = 0 ]; then
  if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != root ]; then
    # Drop privileges before downloading or creating any user-owned files.
    set -- "$action"
    [ -z "$repo" ] || set -- "$@" --repo "$repo"
    [ -z "$version" ] || set -- "$@" --version "$version"
    exec sudo -H -u "$SUDO_USER" /bin/sh "$0" "$@"
  fi
fi
uid=$(id -u)
case "$user" in *[!a-zA-Z0-9_.-]*) die '当前用户名包含服务配置不支持的字符';; esac
home=$HOME
case "$home" in /*) ;; *) die 'HOME 必须为绝对路径';; esac
# Service-manager syntax differs; keep managed paths deliberately conservative.
case "$home" in *[!a-zA-Z0-9_./-]*) die '当前脚本要求用户 HOME 路径只含英文字母、数字、_、.、/、-';; esac
base=$home/.local/share/yandock
service=yandock
os=$(uname -s)
case "$os" in
  Darwin)
    manager=launchd; unit=$home/Library/LaunchAgents/io.yandock.user.plist
    bin_dir=/usr/local/bin; binary=$bin_dir/yandock;;
  Linux)
    if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
      manager=systemd; unit=/etc/systemd/system/$service.service
    elif command -v rc-service >/dev/null 2>&1 && [ -d /run/openrc ]; then
      manager=openrc; unit=/etc/init.d/$service
    else die '只支持正在运行的 systemd 或 OpenRC'; fi
    base=/usr/local/libexec/yandock
    bin_dir=/usr/local/bin; binary=$bin_dir/yandock;;
  *) die "不支持的系统：$os";;
esac
case "$os" in
  Darwin) config=$home/.config/yandock;;
  Linux) config=/etc/yandock;;
esac

[ -r /dev/tty ] && [ -w /dev/tty ] || die '需要交互终端才能完成安装'
ask() { printf '%s' "$1" > /dev/tty; IFS= read -r answer < /dev/tty || die '输入已取消'; }
confirm() { ask "$1 [y/N]："; case "$answer" in y|Y) ;; *) die '已取消';; esac; }
priv() {
  if [ "$uid" = 0 ]; then
    [ "${1:-}" != -v ] || return 0
    "$@"
  else
    command -v sudo >/dev/null 2>&1 || die '需要 sudo 执行系统目录或服务管理操作'
    sudo "$@"
  fi
}
tmp= tty_state=
cleanup() {
  if [ -n "$tty_state" ]; then stty "$tty_state" < /dev/tty; fi
  if [ -n "$tmp" ]; then rm -f "$tmp/archive.zip" "$tmp/binary" "$tmp/SHA256SUMS" "$tmp/unit" "$tmp/password" "$tmp/settings" "$tmp/run" "$tmp/installed" "$tmp/launchctl-error" "$tmp/launchctl-state" "$tmp/launchctl-kickstart-error"; rmdir "$tmp" 2>/dev/null || :; fi
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

if [ "$action" = uninstall ]; then
  [ -f "$base/installed" ] && [ ! -L "$base" ] || die '未找到此用户的安装记录'
  confirm "卸载 $user 的 YanDock？将停止服务、结束其终端会话并删除安装配置（包含密码），不删除工作目录"
  if [ "$os" = Darwin ]; then priv -v; fi
  case "$manager" in
    launchd)
      if launchctl print "gui/$uid/io.yandock.user" >/dev/null 2>&1; then launchctl bootout "gui/$uid" "$unit"; fi
      rm -f "$unit";;
    systemd)
      if [ -e "$unit" ]; then
        priv systemctl disable --now "$service.service"
        priv rm -f "$unit"
      fi
      priv systemctl daemon-reload;;
    openrc)
      if [ -e "$unit" ]; then
        if priv rc-service "$service" status >/dev/null 2>&1; then priv rc-service "$service" stop; fi
        if priv rc-update show default | grep -q "$service"; then priv rc-update del "$service" default; fi
        priv rm -f "$unit"
      fi;;
  esac
  if [ "$os" = Linux ]; then
    priv rm -f "$config/settings" "$config/password"
    priv rmdir "$config" 2>/dev/null || say "配置目录中如有其他文件则保留：$config"
  else
    rm -f "$config/settings" "$config/password"
    rmdir "$config" 2>/dev/null || say "配置目录中如有其他文件则保留：$config"
  fi
  # Explicit files only: never recursively delete a home/project directory.
  if [ -e "$binary" ] || [ -L "$binary" ]; then
    priv rm -f "$binary"
  fi
  if [ "$os" = Linux ]; then
    priv rm -f "$base/run" "$base/installed"
    priv rmdir "$base" 2>/dev/null || say "保留目录中的其他文件：$base"
  else
    rm -f "$base/yandock" "$base/run" "$base/settings" "$base/password" "$base/installed"
    rmdir "$base" 2>/dev/null || say "保留目录中的其他文件：$base"
  fi
  say '已卸载；项目文件与 CLI 数据未修改。'
  exit 0
fi

printf '%s\n' "$repo" | grep -Eq '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' || die '请用 --repo 指定 owner/repo'
if [ -n "$version" ]; then
  printf '%s\n' "$version" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9_.-]*$' || die '版本 tag 含不支持的字符'
fi
[ ! -e "$base" ] && [ ! -L "$base" ] || die "安装目录已存在：${base}；为避免覆盖配置，请先卸载"
if [ "$os" = Linux ]; then
  [ ! -e "$home/.local/share/yandock/installed" ] || die '发现旧版用户目录安装，请先使用旧版安装脚本卸载，再安装新版'
  [ ! -L /usr/local/libexec ] || die '启动脚本父目录不可为符号链接：/usr/local/libexec'
fi
[ ! -L "$bin_dir" ] || die "程序目录不可为符号链接：$bin_dir"
[ ! -e "$bin_dir" ] || [ -d "$bin_dir" ] || die "程序目录不是目录：$bin_dir"
[ ! -e "$binary" ] && [ ! -L "$binary" ] || die "程序路径已存在：${binary}；为避免覆盖其他程序，请先移走它"
[ ! -e "$unit" ] && [ ! -L "$unit" ] || die "服务文件已存在：$unit"
if [ "$os" = Linux ]; then
  if [ -e "$config" ] || [ -L "$config" ]; then
    die "配置目录已存在：${config}；Linux 安装器仅管理一个实例，请由原安装用户卸载"
  fi
else
  [ ! -e "$config" ] && [ ! -L "$config" ] || die "配置目录已存在：$config"
fi
command -v curl >/dev/null 2>&1 || die '请先安装 curl 及 CA 证书'
command -v unzip >/dev/null 2>&1 || die '请先安装 unzip'
case "$(uname -m)" in
  x86_64|amd64) arch=amd64;; arm64|aarch64) arch=arm64;;
  armv7l) arch=armv7;; *) die '不支持的 CPU 架构';;
esac
case "$os" in Darwin) platform=darwin;; Linux) platform=linux;; esac
asset=yandock-$platform-$arch.zip
binary_entry=yandock-$platform-$arch
if [ -n "$version" ]; then
  url=https://github.com/$repo/releases/download/$version
else url=https://github.com/$repo/releases/latest/download; fi
tmp=$(mktemp -d "${TMPDIR:-/tmp}/yandock-install.XXXXXXXX")
fetch() { curl --fail --location --silent --show-error --proto '=https' --proto-redir '=https' --connect-timeout 15 --max-time 300 "$1" -o "$2"; }
say "下载 $repo 的 $asset 与 SHA256SUMS…"
fetch "$url/$asset" "$tmp/archive.zip"
fetch "$url/SHA256SUMS" "$tmp/SHA256SUMS"
expected=$(awk -v name="$asset" '$2 == name || $2 == "*" name { print $1 }' "$tmp/SHA256SUMS")
[ "${#expected}" = 64 ] || die '校验和清单缺少该资产或包含重复项'
case "$expected" in *[!0-9a-fA-F]*) die '校验和格式错误';; esac
if command -v sha256sum >/dev/null 2>&1; then
  actual=$(sha256sum "$tmp/archive.zip" | awk '{print $1}')
elif command -v shasum >/dev/null 2>&1; then
  actual=$(shasum -a 256 "$tmp/archive.zip" | awk '{print $1}')
else die '需要 sha256sum 或 shasum'; fi
[ "$(printf '%s' "$expected" | tr A-F a-f)" = "$actual" ] || die 'SHA-256 校验失败'
unzip -p "$tmp/archive.zip" "$binary_entry" > "$tmp/binary" || die 'ZIP 中缺少目标二进制或文件损坏'
[ -s "$tmp/binary" ] || die 'ZIP 中的目标二进制为空'

ask '监听 IP 地址 [0.0.0.0；支持 IPv4/IPv6，IPv6 不加方括号]：'; address=${answer:-0.0.0.0}
case "$address" in
  *:*)
    case "$address" in *[!A-Fa-f0-9:%._-]*) die '请输入有效格式的 IPv6 地址（不要加方括号或端口）';; esac
    ;;
  *)
    case "$address" in *[!0-9.]* ) die '请输入 IPv4 地址（不支持主机名）';; esac
    printf '%s\n' "$address" | awk -F. 'NF != 4 { exit 1 } { for (i = 1; i <= 4; i++) if ($i !~ /^(0|[1-9][0-9]*)$/ || $i > 255) exit 1; exit 0 }' || die 'IPv4 地址格式无效'
    ;;
esac
ask '监听端口 [8080]：'; port=${answer:-8080}
case "$port" in ''|*[!0-9]*|0*) die '端口应为 1024–65535 的整数';; esac
[ "${#port}" -le 5 ] && [ "$port" -ge 1024 ] && [ "$port" -le 65535 ] || die '端口范围为 1024–65535'
case "$address" in *:*) listen="[$address]:$port";; *) listen="$address:$port";; esac
case "$address" in
  0.0.0.0) probe_host=127.0.0.1;;
  ::) probe_host='[::1]';;
  *:*) probe_host="[$(printf '%s' "$address" | sed 's/%/%25/g')]";;
  *) probe_host=$address;;
esac
probe_url=http://$probe_host:$port
ask "终端工作目录 [$home]："; work=${answer:-$home}
[ -d "$work" ] || die '工作目录不存在'
work=$(cd "$work" && pwd -P)
program=${SHELL:-/bin/sh}
[ -x "$program" ] || die '登录 Shell 不可执行，请设置 SHELL 为有效的绝对路径'
case "$program" in /*) ;; *) die 'SHELL 必须是绝对路径';; esac
say '请输入访问密码（不回显；建议使用密码管理器生成的随机长密码）。'
tty_state=$(stty -g < /dev/tty)
stty -echo < /dev/tty
ask '访问密码：'; password=$answer
printf '\n' > /dev/tty
ask '确认密码：'; repeat=$answer
printf '\n' > /dev/tty
stty "$tty_state" < /dev/tty; tty_state=
[ -n "$password" ] && [ "$password" = "$repeat" ] || die '密码为空或两次输入不一致'
unset repeat answer
case "$address" in 127.*|::1|::1%*) ;; *) say '警告：将允许远程连接。HTTP 不加密，远程部署须配置 HTTPS/WSS 反向代理；脚本不修改防火墙。';; esac
say "用户：${user}；监听：${listen}；目录：${work}；服务管理：${manager}"
[ "$uid" != 0 ] || say '警告：服务和所有新终端将以 root 运行，具有完整系统权限。请确认访问凭据与网络部署安全。'
[ "$manager" != launchd ] || say 'macOS 为当前用户登录后启动，不是无人登录时启动。'
[ "$manager" != launchd ] || say 'macOS 二进制将安装到 /usr/local/bin，需要管理员授权；LaunchAgent 和服务仍以当前用户运行。'
confirm '确认安装并立即启用自启动？'
priv -v

# Quote arbitrary settings as literal POSIX shell strings (never eval input).
quote() { printf "'"; printf '%s' "$1" | sed "s/'/'\\\\''/g"; printf "'"; }
# Create the marker first so interrupted installations can be uninstalled.
if [ "$os" = Linux ]; then
  priv install -d -m 755 "$base"
  printf '%s\n' "$manager" > "$tmp/installed"
  priv install -m 644 "$tmp/installed" "$base/installed"
else
  mkdir -p "$base"
  chmod 700 "$base"
  printf '%s\n' "$manager" > "$base/installed"
fi
if [ ! -d "$bin_dir" ]; then priv install -d -m 755 "$bin_dir"; fi
priv install -m 755 "$tmp/binary" "$binary"
printf '%s' "$password" > "$tmp/password"; unset password
{
  printf 'work='; quote "$work"; printf '\nprogram='; quote "$program"
  printf '\nbinary='; quote "$binary"
  printf '\nlisten='; quote "$listen"
  printf '\nHOME='; quote "$home"
  printf '\nSHELL='; quote "$program"
  printf '\nPATH='; quote "$PATH"; printf '\nexport HOME SHELL PATH\n'
} > "$tmp/settings"
if [ "$os" = Linux ]; then
  priv install -d -m 700 -o "$uid" -g "$(id -g)" "$config"
  priv install -m 600 -o "$uid" -g "$(id -g)" "$tmp/password" "$config/password"
  priv install -m 600 -o "$uid" -g "$(id -g)" "$tmp/settings" "$config/settings"
else
  mkdir -p "$config"
  chmod 700 "$config"
  cp "$tmp/password" "$config/password"
  cp "$tmp/settings" "$config/settings"
fi
cat > "$tmp/run" <<'EOF'
#!/bin/sh
set -eu
base=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
config=${1:-$base}
. "$config/settings"
YANDOCK_TOKEN=$(cat "$config/password")
export YANDOCK_TOKEN
cd "$work"
exec "$binary" --listen "$listen" --dir "$work" --program "$program"
EOF
if [ "$os" = Linux ]; then
  priv install -m 755 "$tmp/run" "$base/run"
else
  cp "$tmp/run" "$base/run"
  chmod 700 "$base/run"
fi
case "$manager" in
  launchd)
    mkdir -p "$home/Library/LaunchAgents"
    cat > "$tmp/unit" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>io.yandock.user</string>
<key>ProgramArguments</key><array><string>/bin/sh</string><string>$base/run</string><string>$config</string></array>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>10</integer>
</dict></plist>
EOF
    plutil -lint "$tmp/unit" >/dev/null
    cp "$tmp/unit" "$unit"
    launchctl_target="gui/$uid/io.yandock.user"
    if ! launchctl bootstrap "gui/$uid" "$unit" 2>"$tmp/launchctl-error"; then
      # Recent macOS versions may load a new LaunchAgent as soon as its plist
      # appears in ~/Library/LaunchAgents. In that case bootstrap returns EIO
      # even though the requested job is already loaded. Only recover when the
      # loaded job points at the plist we just installed; never take over a
      # different service using the same label.
      if launchctl print "$launchctl_target" > "$tmp/launchctl-state" 2>/dev/null && grep -Fq "path = $unit" "$tmp/launchctl-state"; then
        launchctl kickstart -k "$launchctl_target" 2>"$tmp/launchctl-kickstart-error" || {
          cat "$tmp/launchctl-kickstart-error" >&2
          die 'LaunchAgent 已载入但无法重新启动；配置已保留，可查看 launchctl 状态或执行 uninstall'
        }
      else
        cat "$tmp/launchctl-error" >&2
        die 'LaunchAgent 启用失败；请检查 launchctl 状态，配置已保留，可执行 uninstall'
      fi
    fi
    launchctl print "$launchctl_target" >/dev/null;;
  systemd)
    cat > "$tmp/unit" <<EOF
[Unit]
Description=YanDock for $user
After=network.target
[Service]
Type=simple
User=$user
ExecStart=/bin/sh $base/run $config
Restart=on-failure
RestartSec=3
UMask=0077
KillMode=control-group
[Install]
WantedBy=multi-user.target
EOF
    priv install -m 644 "$tmp/unit" "$unit"
    priv systemctl daemon-reload
    priv systemctl enable --now "$service.service"
    priv systemctl is-active --quiet "$service.service";;
  openrc)
    cat > "$tmp/unit" <<EOF
#!/sbin/openrc-run
description="YanDock for $user"
command="/bin/sh"
command_args="$base/run $config"
command_user="$user"
supervisor="supervise-daemon"
pidfile="/run/$service.pid"
respawn_delay=3
depend() { need net; }
EOF
    priv install -m 755 "$tmp/unit" "$unit"
    priv rc-update add "$service" default
    priv rc-service "$service" start
    priv rc-service "$service" status;;
esac
# Observe HTTP readiness, not a fixed startup sleep. No credentials sent.
ready=false
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  running=false
  case "$manager" in
    launchd)
      if launchctl print "gui/$uid/io.yandock.user" 2>/dev/null | grep -q 'state = running'; then running=true; fi;;
    systemd)
      if priv systemctl is-active --quiet "$service.service"; then running=true; fi;;
    openrc)
      if priv rc-service "$service" status >/dev/null 2>&1; then running=true; fi;;
  esac
  home_code=$(curl --noproxy '*' --silent --output /dev/null --write-out '%{http_code}' --max-time 2 "$probe_url/" || :)
  api_code=$(curl --noproxy '*' --silent --output /dev/null --write-out '%{http_code}' --max-time 2 "$probe_url/api/sessions" || :)
  if [ "$running" = true ] && [ "$home_code" = 200 ] && [ "$api_code" = 401 ]; then ready=true; break; fi
  sleep 1
done
[ "$ready" = true ] || die '服务未通过首页/鉴权就绪检查；配置已保留，可查看服务状态或执行 uninstall'
say "已安装并启用自启动。访问：$probe_url"
say "凭据与配置仅安装用户及管理员可读，位于：$config"
say '卸载：sh scripts/install.sh uninstall（使用同一安装用户）'
