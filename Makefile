.PHONY: deps py-deps package build install upload

PLUGIN_ID ?= obsidian-publish-everywhere
VAULT ?= /Users/anner/notes/Work
DIST_DIR ?= dist
PYTHON ?= python3

deps:
	@if [ ! -d node_modules ]; then \
		echo "node_modules not found, installing dependencies..."; \
		if [ -f package-lock.json ]; then npm ci; else npm install; fi; \
	else \
		echo "Dependencies already installed, skip."; \
	fi

py-deps:
	@$(PYTHON) -c "import oss2" >/dev/null 2>&1 || { \
		echo "Python dependency oss2 not found, installing..."; \
		$(PYTHON) -m pip install -r cicd/requirements.txt; \
	}

build: deps
	npm run build

package: build
	rm -rf $(DIST_DIR)/*
	mkdir -p $(DIST_DIR)
	cp main.js manifest.json $(DIST_DIR)/
	if [ -f styles.css ]; then cp styles.css $(DIST_DIR)/; fi
	# Create an installable zip (contains a top-level $(PLUGIN_ID)/ folder)
	tmp_dir="$$(mktemp -d)"; \
	mkdir -p "$$tmp_dir/$(PLUGIN_ID)"; \
	cp "$(DIST_DIR)/main.js" "$(DIST_DIR)/manifest.json" "$$tmp_dir/$(PLUGIN_ID)/"; \
	if [ -f "$(DIST_DIR)/styles.css" ]; then cp "$(DIST_DIR)/styles.css" "$$tmp_dir/$(PLUGIN_ID)/"; fi; \
	( cd "$$tmp_dir" && zip -r -q "$(abspath $(DIST_DIR))/$(PLUGIN_ID).zip" "$(PLUGIN_ID)" ); \
	rm -rf "$$tmp_dir"

install: package
	vault_path="$(VAULT)"; \
	if [ ! -d "$$vault_path" ]; then \
		fallback_path="$$(printf '%s' "$$vault_path" | sed 's#/notes/#/笔记/#')"; \
		if [ "$$fallback_path" != "$$vault_path" ] && [ -d "$$fallback_path" ]; then \
			echo "Vault path fallback: $$vault_path -> $$fallback_path"; \
			vault_path="$$fallback_path"; \
		fi; \
	fi; \
	mkdir -p "$$vault_path/.obsidian/plugins/$(PLUGIN_ID)"; \
	cp -f "$(DIST_DIR)/main.js" "$$vault_path/.obsidian/plugins/$(PLUGIN_ID)/main.js"; \
	cp -f "$(DIST_DIR)/manifest.json" "$$vault_path/.obsidian/plugins/$(PLUGIN_ID)/manifest.json"; \
	if [ -f "$(DIST_DIR)/styles.css" ]; then cp -f "$(DIST_DIR)/styles.css" "$$vault_path/.obsidian/plugins/$(PLUGIN_ID)/styles.css"; fi; \
	echo "Installed to $$vault_path/.obsidian/plugins/$(PLUGIN_ID) (data.json kept)"

upload: py-deps package
	python3 cicd/upload.py --file "$(DIST_DIR)/$(PLUGIN_ID).zip"
