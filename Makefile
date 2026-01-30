.PHONY: package build install

PLUGIN_ID ?= obsidian-publish-everywhere
VAULT ?= /Users/anner/notes/Work
DIST_DIR ?= dist

build:
	npm run build

package: build
	rm -rf $(DIST_DIR)/*
	mkdir -p $(DIST_DIR)
	cp main.js manifest.json $(DIST_DIR)/
	if [ -f styles.css ]; then cp styles.css $(DIST_DIR)/; fi

install: package
	mkdir -p "$(VAULT)/.obsidian/plugins/$(PLUGIN_ID)"
	cp -f "$(DIST_DIR)/main.js" "$(VAULT)/.obsidian/plugins/$(PLUGIN_ID)/main.js"
	cp -f "$(DIST_DIR)/manifest.json" "$(VAULT)/.obsidian/plugins/$(PLUGIN_ID)/manifest.json"
	if [ -f "$(DIST_DIR)/styles.css" ]; then cp -f "$(DIST_DIR)/styles.css" "$(VAULT)/.obsidian/plugins/$(PLUGIN_ID)/styles.css"; fi
	@echo "Installed to $(VAULT)/.obsidian/plugins/$(PLUGIN_ID) (data.json kept)"
