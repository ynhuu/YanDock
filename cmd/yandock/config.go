package main

import "errors"

// validateToken only requires a non-empty credential. YanDock does not impose
// password strength; use a strong random value for any reachable deployment.
func validateToken(token string) error {
	if token == "" {
		return errors.New("请通过 YANDOCK_TOKEN 设置访问凭据")
	}
	return nil
}
