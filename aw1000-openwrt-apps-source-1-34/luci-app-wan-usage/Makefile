include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-wan-usage
PKG_VERSION:=1
PKG_RELEASE:=34
PKG_LICENSE:=GPL-2.0-only

include $(INCLUDE_DIR)/package.mk

define Package/luci-app-wan-usage
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=WAN and cellular data usage tracker
  DEPENDS:=+luci-base +rpcd +sms-tool
endef

define Package/luci-app-wan-usage/description
  Tracks monthly traffic on a selected WAN or cellular network device and
  displays allowance and warning information in LuCI.
endef

define Package/luci-app-wan-usage/conffiles
/etc/config/wan_usage
endef

define Package/luci-app-wan-usage/install
	$(INSTALL_DIR) $(1)/etc/config $(1)/etc/uci-defaults $(1)/etc/init.d
	$(INSTALL_CONF) ./files/etc/config/wan_usage $(1)/etc/config/
	$(INSTALL_BIN) ./files/etc/uci-defaults/50-wan-usage $(1)/etc/uci-defaults/
	$(INSTALL_BIN) ./files/etc/init.d/wan-usage-tracker $(1)/etc/init.d/
	$(INSTALL_DIR) $(1)/usr/sbin $(1)/usr/libexec/rpcd $(1)/usr/share/luci/menu.d $(1)/usr/share/rpcd/acl.d
	$(INSTALL_BIN) ./files/usr/sbin/wan-usage-sampler $(1)/usr/sbin/
	$(INSTALL_BIN) ./files/usr/libexec/rpcd/luci.wan-usage $(1)/usr/libexec/rpcd/
	$(INSTALL_BIN) ./files/usr/libexec/wan-usage-device $(1)/usr/libexec/
	$(INSTALL_DATA) ./files/usr/share/luci/menu.d/luci-app-wan-usage.json $(1)/usr/share/luci/menu.d/
	$(INSTALL_DATA) ./files/usr/share/rpcd/acl.d/luci-app-wan-usage.json $(1)/usr/share/rpcd/acl.d/
	$(INSTALL_DIR) $(1)/www/luci-static/resources/view/wan-usage $(1)/www/luci-static/resources/wan-usage
	$(INSTALL_DATA) ./files/www/luci-static/resources/view/wan-usage/index.js $(1)/www/luci-static/resources/view/wan-usage/
	$(INSTALL_DATA) ./files/www/luci-static/resources/wan-usage/style.css $(1)/www/luci-static/resources/wan-usage/
endef

define Package/luci-app-wan-usage/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	rm -f /tmp/luci-indexcache* /tmp/luci-modulecache/* 2>/dev/null
	/etc/init.d/wan-usage-tracker enable
	[ "$(uci -q get wan_usage.main.interface)" != "464-wan6_4" ] || { uci set wan_usage.main.interface=auto; uci commit wan_usage; }
	/etc/init.d/wan-usage-tracker restart
	/etc/init.d/rpcd reload
}
exit 0
endef

$(eval $(call BuildPackage,luci-app-wan-usage))
