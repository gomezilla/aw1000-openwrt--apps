# luci-app-wan-usage

LuCI application for tracking wired WAN or cellular data usage, billing-period allowances, history, and SMS alerts on HikariWrt/AW1000.

## Package contents

- `Makefile` — OpenWrt package metadata and install rules.
- `files/etc/` — default configuration and service startup files.
- `files/usr/` — sampler, RPC backend, and device selection helper.
- `files/www/` — LuCI view and stylesheet.

## Build

Copy this directory into an OpenWrt build tree under `package/`, select `luci-app-wan-usage` in `make menuconfig`, then build it with:

```sh
make package/luci-app-wan-usage/compile V=s
```

The installable `.ipk` is a build artifact. Keep source changes here and publish each finished package as a GitHub Release asset.
