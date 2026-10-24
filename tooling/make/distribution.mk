# Distribution packaging — XCFG-D05
#
#   make package PRODUCT=desktop FLAVOR=geek [TARGET=dmg]
#   make package PRODUCT=mobile  FLAVOR=xx   TARGET=android-apk REGION=cn
#
# Unknown products/flavors/labels fail closed in tooling/distribution.

PRODUCT ?=
FLAVOR ?=
TARGET ?=
CHANNEL ?=
REGION ?=
VERSION ?=
LABELS ?=

.PHONY: package package-dry-run

package:
	@node tooling/distribution/package.mjs \
		--product "$(PRODUCT)" \
		--flavor "$(FLAVOR)" \
		$(if $(TARGET),--target "$(TARGET)") \
		$(if $(CHANNEL),--channel "$(CHANNEL)") \
		$(if $(REGION),--region "$(REGION)") \
		$(if $(VERSION),--version "$(VERSION)") \
		$(if $(LABELS),--labels "$(LABELS)")

package-dry-run:
	@node tooling/distribution/package.mjs \
		--product "$(PRODUCT)" \
		--flavor "$(FLAVOR)" \
		--dry-run \
		$(if $(TARGET),--target "$(TARGET)") \
		$(if $(CHANNEL),--channel "$(CHANNEL)") \
		$(if $(REGION),--region "$(REGION)") \
		$(if $(VERSION),--version "$(VERSION)") \
		$(if $(LABELS),--labels "$(LABELS)")
