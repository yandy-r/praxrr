# Build and locally install the example Praxrr plugin.
#
#   make build    compile main.go to plugin.wasm with a pinned TinyGo image
#   make install  build, then copy this plugin into PLUGINS_DIR
#   make clean    remove the built artifact
#
# The built plugin.wasm is a build artifact: it is git-ignored and never
# committed. Override the install target with, e.g.:
#
#   make install PLUGINS_DIR=/path/to/praxrr/dist/dev/plugins

PLUGINS_DIR ?= ./plugins
PLUGIN_ID := dev.praxrr.examples.sync-preview-observer

.PHONY: build install clean

build:
	./build.sh

install: build
	mkdir -p "$(PLUGINS_DIR)/$(PLUGIN_ID)"
	cp praxrr.plugin.json plugin.wasm "$(PLUGINS_DIR)/$(PLUGIN_ID)/"

clean:
	rm -f plugin.wasm
