package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"yandock/internal/auth"
	"yandock/internal/server"
	"yandock/internal/session"
	"yandock/internal/webassets"
)

var version = "dev"

func main() {
	if err := run(); err != nil {
		slog.Error("服务停止", "error", err)
		os.Exit(1)
	}
}

func run() error {
	listen := flag.String("listen", "127.0.0.1:8080", "HTTP 监听地址")
	program := flag.String("program", "", "服务端可执行程序（默认使用 SHELL，最后回退到 sh）")
	dir := flag.String("dir", ".", "终端工作目录")
	showVersion := flag.Bool("v", false, "显示版本号并退出")
	flag.Parse()
	if *showVersion {
		fmt.Printf("YanDock %s\n", version)
		return nil
	}
	token := os.Getenv("YANDOCK_TOKEN")
	if err := validateToken(token); err != nil {
		return err
	}
	// Do not pass YanDock's access secret on to the terminal process.
	if err := os.Unsetenv("YANDOCK_TOKEN"); err != nil {
		return err
	}
	if *program == "" {
		*program = os.Getenv("SHELL")
		if *program == "" {
			*program = "sh"
		}
	}
	path, err := exec.LookPath(*program)
	if err != nil {
		return errors.New("找不到可执行程序，请使用 --program 配置绝对路径并检查 PATH")
	}
	workingDir, err := filepath.Abs(*dir)
	if err != nil {
		return err
	}
	info, err := os.Stat(workingDir)
	if err != nil || !info.IsDir() {
		return errors.New("工作目录不存在或不是目录")
	}
	m := session.NewManager(path, flag.Args(), workingDir)
	defer m.Close()
	srv := &http.Server{
		Addr:              *listen,
		Handler:           server.New(auth.New(token), m, webassets.FS()),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    16 * 1024,
	}
	listener, err := net.Listen("tcp", *listen)
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	serveDone := make(chan error, 1)
	go func() { serveDone <- srv.Serve(listener) }()
	if addr, ok := listener.Addr().(*net.TCPAddr); ok && !addr.IP.IsLoopback() {
		slog.Warn("HTTP 监听非回环地址：凭据和终端内容未加密，请限制访问来源并使用 HTTPS 反向代理保护远程访问")
	}
	slog.Info("YanDock 已启动", "listen", listener.Addr().String())
	select {
	case err := <-serveDone:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
		m.Close() // Also closes terminal streams; Shutdown alone does not own WebSockets.
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return srv.Shutdown(shutdownCtx)
	}
}
