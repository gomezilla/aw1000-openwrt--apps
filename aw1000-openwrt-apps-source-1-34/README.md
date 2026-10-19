# AW1000 OpenWrt apps

Source packages and release builds for HikariWrt / AW1000.

## Source

OpenWrt package source is organized one package per directory at the repository root. The WAN usage tracker is in [`luci-app-wan-usage/`](luci-app-wan-usage/), following the usual OpenWrt package layout: a `Makefile` plus its `files/` payload.

## Build

Copy a package directory into an OpenWrt build tree under `package/`, select it in `make menuconfig`, then run `make package/<package-name>/compile V=s`.

## Releases

Publish built `.ipk` files as GitHub Release assets. Keep editable source and installable binaries separate so the repository remains easy to browse and changes can be reviewed.
