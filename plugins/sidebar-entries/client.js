window.__ModuleLoader__.load({
	id: "dsh-sidebar-entries",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _deepseek_ai_dsh_client_store = require("@deepseek-ai/dsh-client-store");
		let _deepseek_ai_dsh_client_ui_slots = require("@deepseek-ai/dsh-client-ui-slots");
		let react_jsx_runtime = require("react/jsx-runtime");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react = require("react");
		const NO_PANELS = [];


		//#region lib/types/client/entrySettings.js
		/** localStorage key holding the user's sidebar entry order and hidden (unpinned) ids. */
		const ENTRY_PREFS_KEY = "dsh.sidebar.entryPrefs.v1";
		/** Read the persisted entry preferences; unreadable storage degrades to empty values. */
		function readEntryPrefs() {
			try {
				const raw = window.localStorage.getItem(ENTRY_PREFS_KEY);
				if (raw === null) return {
					order: [],
					unpinned: []
				};
				const parsed = JSON.parse(raw);
				const strings = (value) => Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
				return {
					order: strings(parsed?.order),
					unpinned: strings(parsed?.unpinned).filter((id) => id !== "plugins")
				};
			} catch (error) {
				return {
					order: [],
					unpinned: []
				};
			}
		}
		/** Merge one patch into the persisted entry preferences. */
		function writeEntryPrefs(patch) {
			const current = readEntryPrefs();
			const next = {
				order: patch.order ?? current.order,
				unpinned: patch.unpinned ?? current.unpinned
			};
			try {
				window.localStorage.setItem(ENTRY_PREFS_KEY, JSON.stringify(next));
			} catch (error) {
				/* Blocked or full storage keeps the in-memory preference. */
			}
		}
		/** Persisted panel order: stored rank first, registration order after. */
		function createEntryOrder() {
			const store = (0, _deepseek_ai_dsh_client_store.createSnapshotStore)(readEntryPrefs().order);
			return {
				order: {
					getSnapshot: () => store.getSnapshot(),
					subscribe: (listener) => store.subscribe(listener)
				},
				setOrder: (ids) => {
					const current = store.getSnapshot();
					if (ids.length === current.length && ids.every((id, index) => id === current[index])) return;
					store.set(ids);
					writeEntryPrefs({ order: ids });
				}
			};
		}
		/** Sort panels by the stored order; ids outside it keep registration order at the end. */
		function applyEntryOrder(panels, order) {
			if (order.length === 0) return panels;
			const rank = new Map(order.map((id, index) => [id, index]));
			return [...panels].sort((a, b) => {
				const left = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
				const right = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
				return left - right;
			});
		}
		/** Styles for the entry settings row, dialog, and its list. */
		const entrySettingsCss = ".dsh-entry-settings-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px;max-height:min(52vh,440px);overflow-y:auto}.dsh-entry-settings-item{align-items:center;gap:6px;padding:5px 8px;border-radius:var(--dsw-radius-md,8px);display:flex}.dsh-entry-settings-item:hover{background:var(--dsw-alias-interactive-bg-hover)}.dsh-entry-settings-glyph{flex:none;width:18px;color:var(--dsw-alias-label-secondary);display:inline-flex;align-items:center;justify-content:center}.dsh-entry-settings-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px}.dsh-entry-settings-itemHidden .dsh-entry-settings-name{color:var(--dsw-alias-label-secondary);text-decoration:line-through}.dsh-entry-settings-move{border:none;background:0 0;color:var(--dsw-alias-label-secondary);cursor:pointer;width:24px;height:24px;border-radius:var(--dsw-radius-sm,6px);display:inline-flex;align-items:center;justify-content:center;flex:none;padding:0}.dsh-entry-settings-move:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}.dsh-entry-settings-move:disabled{opacity:.3;cursor:default}.dsh-entry-settings-toggle{flex:none;width:15px;height:15px;margin:0 2px 0 4px;accent-color:var(--dsw-alias-state-business-primary,#4d6bfe);cursor:pointer}.dsh-entry-settings-toggle:disabled{opacity:.45;cursor:default}.dsh-entry-settings-footer{display:flex;justify-content:space-between;align-items:center;gap:8px}.dsh-entry-settings-button{border:.5px solid var(--dsw-alias-border-l3,#d8d8d8);background:0 0;color:var(--dsw-alias-label-primary);border-radius:var(--dsw-radius-md,8px);padding:6px 14px;font-size:13px;cursor:pointer}.dsh-entry-settings-button:hover{background:var(--dsw-alias-interactive-bg-hover)}";
		if (typeof document !== "undefined" && document.querySelector("style[data-entry-settings]") === null) {
			const tag = document.createElement("style");
			tag.dataset.entrySettings = "";
			tag.textContent = entrySettingsCss;
			document.head.appendChild(tag);
		}
		/** Settings launcher row at the end of the global panel list. */
		function PanelSettingsRow({ wide, label, onClick }) {
			return (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
				label,
				delayMs: 500,
				disabled: wide,
				children: (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: SidebarRoot_module_css_default.panelRow,
					"aria-label": label,
					"aria-haspopup": "dialog",
					onClick,
					children: [(0, react_jsx_runtime.jsx)("span", {
						className: SidebarRoot_module_css_default.panelGlyph,
						"aria-hidden": "true",
						children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconSettingsOutlineRegular, { size: wide ? 16 : 18 })
					}), wide && (0, react_jsx_runtime.jsx)("span", {
						className: clsx(SidebarRoot_module_css_default.panelTitle, SidebarRoot_module_css_default.wide),
						children: label
					})]
				})
			});
		}
		/** One row of the settings dialog: icon, label, order controls, and a list toggle. */
		function EntrySettingsItem({ id, label, index, last, hidden, locked, onMove, onPinnedChange, renderSlot, t }) {
			return (0, react_jsx_runtime.jsxs)("li", {
				className: clsx("dsh-entry-settings-item", hidden && "dsh-entry-settings-itemHidden"),
				children: [
					(0, react_jsx_runtime.jsx)("span", {
						className: "dsh-entry-settings-glyph",
						"aria-hidden": "true",
						children: renderSlot("sidebar.panellist", {
							size: 16,
							active: false
						}, { only: id })
					}),
					(0, react_jsx_runtime.jsx)("span", {
						className: "dsh-entry-settings-name",
						children: label
					}),
					(0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "dsh-entry-settings-move",
						"aria-label": t("entries.moveUp"),
						title: t("entries.moveUp"),
						disabled: index === 0,
						onClick: () => {
							onMove(id, -1);
						},
						children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronUpOutlineRegular, { size: 14 })
					}),
					(0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "dsh-entry-settings-move",
						"aria-label": t("entries.moveDown"),
						title: t("entries.moveDown"),
						disabled: last,
						onClick: () => {
							onMove(id, 1);
						},
						children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineRegular, { size: 14 })
					}),
					(0, react_jsx_runtime.jsx)("input", {
						type: "checkbox",
						className: "dsh-entry-settings-toggle",
						"aria-label": t("entries.show") + ": " + label,
						title: t("entries.show"),
						checked: !hidden,
						disabled: locked,
						onChange: (event) => {
							onPinnedChange(id, event.target.checked);
						}
					})
				]
			});
		}
		/** Dialog that reorders the global panels and chooses which ones the list shows. */
		function EntrySettingsDialog({ open, onClose, entries, unpinned, onOrder, onPinnedChange, onReset, renderSlot, t }) {
			const order = entries.map((entry) => entry.id);
			const move = (id, delta) => {
				const from = order.indexOf(id);
				const to = from + delta;
				if (from < 0 || to < 0 || to >= order.length) return;
				const next = [...order];
				const moved = next.splice(from, 1)[0];
				next.splice(to, 0, moved);
				onOrder(next);
			};
			return (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open,
				onClose,
				title: t("entries.title"),
				closeLabel: t("entries.close"),
				description: t("entries.description"),
				footer: (0, react_jsx_runtime.jsxs)("div", {
					className: "dsh-entry-settings-footer",
					children: [(0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "dsh-entry-settings-button",
						onClick: onReset,
						children: t("entries.reset")
					}), (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "dsh-entry-settings-button",
						onClick: onClose,
						children: t("entries.close")
					})]
				}),
				children: (0, react_jsx_runtime.jsx)("ul", {
					className: "dsh-entry-settings-list",
					children: entries.map((entry, index) => (0, react_jsx_runtime.jsx)(EntrySettingsItem, {
						id: entry.id,
						label: entry.label,
						index,
						last: index === entries.length - 1,
						hidden: unpinned.includes(entry.id),
						locked: entry.id === "plugins",
						onMove: move,
						onPinnedChange,
						renderSlot,
						t
					}, entry.id))
				})
			});
		}
		//#endregion

		/**
		* Create the in-memory panel pin list; the snapshot keeps its reference until the list changes.
		* @returns Unpinned panel ids and the pin mutation.
		*/
		function createPanelPins() {
			const store = (0, _deepseek_ai_dsh_client_store.createSnapshotStore)({ unpinned: readEntryPrefs().unpinned });
			return {
				unpinned: {
					getSnapshot: () => store.getSnapshot().unpinned,
					subscribe: (listener) => store.subscribe(listener)
				},
				setPinned: (id, pinned) => {
					const current = store.getSnapshot().unpinned;
					if (id === "plugins" || pinned !== current.includes(id)) return;
					const next = pinned ? current.filter((entry) => entry !== id) : [...current, id];
					store.set({ unpinned: next });
					writeEntryPrefs({ unpinned: next });
				}
			};
		}
		//#endregion
		//#region \0dsh-css:/Users/deepseek/dsh-ci/runner/_work/deepseek-harness/deepseek-harness/packages/client/ui-sidebar/src/client/HeaderLeadingControls.module.css.mjs
		const css$1 = ".xoYuoq_controls{align-items:center;gap:8px;display:flex}.xoYuoq_iconButton{border-radius:var(--dsw-radius-sm);width:28px;height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}@media (hover:hover){.xoYuoq_iconButton:hover{background:var(--dsw-alias-interactive-bg-hover)}}";
		const tagId$1 = "@deepseek-ai/dsh-client-ui-sidebar/HeaderLeadingControls.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$1) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-sidebar-entries";
			tag.dataset.pluginCss = tagId$1;
			tag.textContent = css$1;
			document.head.appendChild(tag);
		}
		var HeaderLeadingControls_module_css_default = {
			"controls": "xoYuoq_controls",
			"iconButton": "xoYuoq_iconButton"
		};
		//#endregion
		//#region lib/types/client/HeaderLeadingControls.js
		/** Window-chrome controls for the fully hidden sidebar (frame shell.leading seat). */
		/**
		* Sidebar-open and New Session controls in the frame's window-chrome seat.
		* On macOS desktop a collapsed sidebar hides entirely (no rail), taking both
		* controls off screen; this occupant puts them back beside the traffic
		* lights. The frame mounts the seat only in that state and owns its
		* placement, so the occupant renders unconditionally.
		* @param props - Injected sidebar actions, the global access Hook, and the sidebar locale seat.
		* @returns the sidebar toggle, plus the New Session control while the access snapshot allows `session/create`.
		*/
		function HeaderLeadingControls({ toggleSidebar, startSession, trackEntryClick, useRemoteAccess, useShortcuts, t }) {
			const canStartSession = useRemoteAccess("session/create");
			const shortcut = useShortcuts((rows) => rows.find((row) => row.id === "sidebar.left.toggle"));
			const newShortcut = useShortcuts((rows) => rows.find((row) => row.id === "session.new"));
			return (0, react_jsx_runtime.jsxs)("div", {
				className: HeaderLeadingControls_module_css_default.controls,
				children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
					label: t("toggle.open"),
					shortcutKeys: shortcut?.keys,
					delayMs: 500,
					children: (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: HeaderLeadingControls_module_css_default.iconButton,
						"aria-label": t("toggle.open"),
						"aria-keyshortcuts": shortcut?.aria,
						onClick: () => {
							toggleSidebar();
						},
						children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPanelLeftOutlineRegular, { size: 16 })
					})
				}), canStartSession && (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
					label: t("session.new.label"),
					shortcutKeys: newShortcut?.keys,
					delayMs: 500,
					children: (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: HeaderLeadingControls_module_css_default.iconButton,
						"aria-label": t("session.new.label"),
						"aria-keyshortcuts": newShortcut?.aria,
						onClick: () => {
							trackEntryClick({
								menu_name: "new_session",
								position: "titlebar"
							});
							startSession();
						},
						children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconNewChatOutlineRegular, { size: 16 })
					})
				})]
			});
		}
		//#endregion
		//#region ../../../node_modules/.pnpm/clsx@2.1.1/node_modules/clsx/dist/clsx.mjs
		function r(e) {
			var t, f, n = "";
			if ("string" == typeof e || "number" == typeof e) n += e;
			else if ("object" == typeof e) if (Array.isArray(e)) {
				var o = e.length;
				for (t = 0; t < o; t++) e[t] && (f = r(e[t])) && (n && (n += " "), n += f);
			} else for (f in e) e[f] && (n && (n += " "), n += f);
			return n;
		}
		function clsx() {
			for (var e, t, f = 0, n = "", o = arguments.length; f < o; f++) (e = arguments[f]) && (t = r(e)) && (n && (n += " "), n += t);
			return n;
		}
		//#endregion
		//#region \0dsh-css:/Users/deepseek/dsh-ci/runner/_work/deepseek-harness/deepseek-harness/packages/client/ui-sidebar/src/client/SidebarRoot.module.css.mjs
		const css = ".kB3qhq_root{--dsh-sidebar-inline-padding:8px;--dsh-sidebar-row-padding:12px;--dsh-sidebar-label-gap:6px;--dsh-sidebar-paint-inset:3px;height:100%;padding:6px var(--dsh-sidebar-inline-padding);box-sizing:border-box;background:var(--dsw-specific-sidebar-fill);color:var(--dsw-alias-label-primary);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);flex-direction:column;font-size:14px;display:flex}[data-platform=darwin] .kB3qhq_root{background:0 0}.kB3qhq_root.kB3qhq_collapsed{padding:18px 10px 6px}[data-windows-titlebar] .kB3qhq_root .kB3qhq_logoRow{height:40px;margin:0;padding:0}[data-windows-titlebar] .kB3qhq_toggle{top:calc((var(--dsh-windows-titlebar-height) - 28px) / 2);z-index:30;-webkit-app-region:no-drag;position:fixed;left:12px}[data-windows-titlebar] .kB3qhq_root.kB3qhq_collapsed .kB3qhq_logoRow{height:0}[data-windows-titlebar] .kB3qhq_root:not(.kB3qhq_collapsed) .kB3qhq_brand{padding-left:8px}[data-windows-titlebar] .kB3qhq_brandIdentity{transform:translateY(1px)}[data-windows-titlebar] .kB3qhq_brandMark{transform:translate(1px)}[data-windows-titlebar] .kB3qhq_brandName{font-weight:400}[data-windows-titlebar] .kB3qhq_root.kB3qhq_collapsed{padding:0}[data-windows-titlebar] .kB3qhq_root:not(.kB3qhq_collapsed) .kB3qhq_newSession{margin-top:6px}[data-windows-titlebar] .kB3qhq_collapsed .kB3qhq_panelList,[data-windows-titlebar] .kB3qhq_collapsed .kB3qhq_regionArea,[data-windows-titlebar] .kB3qhq_collapsed .kB3qhq_footArea{display:none}html[data-windows-titlebar]:has([data-sidebar-collapsed=true]){--dsh-windows-menu-start:84px}[data-windows-titlebar] .kB3qhq_collapsed .kB3qhq_newSession{top:calc((var(--dsh-windows-titlebar-height) - 28px) / 2);z-index:30;-webkit-app-region:no-drag;border:none;margin:0;padding:0;position:fixed;left:48px}[data-windows-titlebar] .kB3qhq_railIn .kB3qhq_iconButton,[data-windows-titlebar] .kB3qhq_railIn .kB3qhq_newSession{animation:none}[data-windows-titlebar] .kB3qhq_collapsed .kB3qhq_toggle,[data-windows-titlebar] .kB3qhq_collapsed .kB3qhq_newSession{border-radius:var(--dsw-radius-sm);width:28px;height:28px;color:var(--dsw-alias-label-secondary)}[data-windows-titlebar] .kB3qhq_collapsed .kB3qhq_toggle .kB3qhq_panelIcon{display:inline}.kB3qhq_root.kB3qhq_quietBars{--dsh-scrollbar-thumb:transparent;--dsh-scrollbar-thumb-hover:transparent}.kB3qhq_fading>*{opacity:0;transition:opacity .15s var(--ds-ease-in-out)}.kB3qhq_wide{animation:kB3qhq_wide-in .2s var(--ds-ease-in-out)}@keyframes kB3qhq_wide-in{0%{opacity:0}}.kB3qhq_railIn .kB3qhq_iconButton,.kB3qhq_railIn .kB3qhq_newSession,.kB3qhq_railIn .kB3qhq_panelList,.kB3qhq_railIn .kB3qhq_regionArea{animation:kB3qhq_rail-in .15s var(--ds-ease-in-out) backwards}.kB3qhq_railIn .kB3qhq_footArea{animation:kB3qhq_rail-fade-in .15s var(--ds-ease-in-out) backwards}@keyframes kB3qhq_rail-in{0%{opacity:0;transform:translate(49px)}}@keyframes kB3qhq_rail-fade-in{0%{opacity:0}}.kB3qhq_topStrip{box-sizing:border-box;height:52px;margin:-6px calc(-1 * var(--dsh-sidebar-inline-padding)) 0;flex:none;justify-content:flex-end;align-items:center;padding:0 12px 2px;display:flex}html[data-platform=darwin]:not([data-fullscreen]) .kB3qhq_root:not(.kB3qhq_collapsed)>.kB3qhq_topStrip>.kB3qhq_toggle{transform:translate(4px)}[data-fullscreen] .kB3qhq_topStrip{justify-content:flex-start}.kB3qhq_topStrip+.kB3qhq_logoRow{margin-top:-12px}.kB3qhq_logoRow{box-sizing:border-box;flex:none;justify-content:flex-end;align-items:center;gap:8px;height:60px;margin-bottom:0;padding:8px 0 8px 8px;display:flex;overflow:hidden}.kB3qhq_collapsed .kB3qhq_logoRow{justify-content:flex-start;height:36px;margin-bottom:12px;padding:0;overflow:visible}.kB3qhq_brand{min-width:0;color:inherit;cursor:pointer;background:0 0;border:none;flex:1;align-items:center;padding:0;display:inline-flex;overflow:hidden}[data-platform=darwin] .kB3qhq_brand{cursor:default}.kB3qhq_brandIdentity{align-items:center;gap:5px;min-width:0;height:24px;display:inline-flex}.kB3qhq_brandMark{flex:none;justify-content:center;align-items:center;display:inline-flex}.kB3qhq_brandName{letter-spacing:.04em;align-items:center;gap:6px;min-width:0;height:24px;font-size:18px;font-weight:600;line-height:24px;display:inline-flex}.kB3qhq_fallbackBrandName{letter-spacing:0;white-space:nowrap;font-size:17px}.kB3qhq_localBuildBrand{white-space:nowrap;flex-direction:column;flex:none;justify-content:center;align-items:flex-start;gap:1px;height:24px;display:inline-flex}.kB3qhq_copyVersion{cursor:pointer;-webkit-app-region:no-drag;display:inline-flex}.kB3qhq_localBuildTitle{letter-spacing:0;font-size:12px;line-height:13px}.kB3qhq_iconButton{border-radius:var(--dsw-radius-sm);cursor:pointer;width:28px;height:28px;color:var(--dsw-alias-label-secondary);background:0 0;border:none;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex;position:relative}@media (hover:hover){.kB3qhq_iconButton:hover{background-color:var(--dsw-alias-interactive-bg-hover)}}.kB3qhq_iconButton.kB3qhq_toggle:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}.kB3qhq_collapsed .kB3qhq_iconButton{border-radius:var(--dsw-radius-md);width:36px;height:36px}.kB3qhq_collapsed .kB3qhq_toggle .kB3qhq_panelIcon{display:none}@media (hover:hover){.kB3qhq_collapsed .kB3qhq_toggle:hover .kB3qhq_panelIcon{display:inline}.kB3qhq_collapsed .kB3qhq_toggle:hover .kB3qhq_railMark{display:none}}.kB3qhq_railMark{justify-content:center;align-items:center;display:inline-flex}.kB3qhq_collapsed .kB3qhq_iconButton{color:var(--dsw-alias-label-primary)}.kB3qhq_buildVersion{height:10px;color:var(--dsw-alias-label-primary-inverted);background:var(--dsw-alias-label-primary);font-family:var(--ds-font-family-code);white-space:nowrap;border-radius:2px;flex:none;align-items:center;padding:0 3px;font-size:6px;font-weight:500;line-height:10px;display:inline-flex}.kB3qhq_newSession{height:38px;margin:0 calc(var(--dsh-sidebar-paint-inset) + 1px) 10px;box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-primary);cursor:pointer;flex:none;justify-content:center;align-items:center;gap:0;padding:8px 12px;font-size:14px;font-weight:500;line-height:22px;display:flex;position:relative;overflow:hidden;container-type:inline-size}@media (hover:hover){.kB3qhq_newSession:hover{background:var(--dsw-alias-button-floating-hover)}}[data-platform=darwin] .kB3qhq_newSession{background:#ffffff8c}@media (hover:hover){[data-platform=darwin] .kB3qhq_newSession:hover{background:#ffffff4d}}[data-platform=darwin] [data-ds-dark-theme] .kB3qhq_newSession{background:#ffffff26}@media (hover:hover){[data-platform=darwin] [data-ds-dark-theme] .kB3qhq_newSession:hover{background:#fff3}}.kB3qhq_collapsed .kB3qhq_newSession{background:0 0;border-color:#0000;align-self:flex-start;gap:0;width:36px;height:36px;margin:0 0 12px;padding:0}@media (hover:hover){.kB3qhq_collapsed .kB3qhq_newSession:hover{background-color:var(--dsw-alias-interactive-bg-hover)}}.kB3qhq_newSessionLabel{white-space:nowrap;max-width:200px;overflow:hidden}.kB3qhq_collapsed .kB3qhq_newSessionLabel{max-width:0}.kB3qhq_newSessionLabelMask{flex:1;min-width:0}.kB3qhq_newSession:focus-visible .kB3qhq_newSessionLabelMask:has(+.kB3qhq_newSessionShortcut){overflow:hidden;mask-image:linear-gradient(90deg,#000 calc(100% - 16px),#0000)}@media (hover:hover){.kB3qhq_newSession:hover .kB3qhq_newSessionLabelMask:has(+.kB3qhq_newSessionShortcut){overflow:hidden;mask-image:linear-gradient(90deg,#000 calc(100% - 16px),#0000)}}.kB3qhq_newSessionContent{justify-content:center;align-items:center;gap:6px;width:100cqw;display:flex}.kB3qhq_newSessionContent>svg{flex:none}.kB3qhq_newSessionShortcut{opacity:0;pointer-events:none;flex:none;font-weight:400;display:inline-flex}.kB3qhq_newSession:focus-visible .kB3qhq_newSessionShortcut{opacity:1}@media (hover:hover){.kB3qhq_newSession:hover .kB3qhq_newSessionShortcut{opacity:1}}.kB3qhq_panelList{flex-direction:column;flex:none;gap:2px;margin-bottom:8px;display:flex}.kB3qhq_panelRow{align-items:center;gap:var(--dsh-sidebar-label-gap);min-height:36px;padding:7px calc(var(--dsh-sidebar-row-padding) - var(--dsh-sidebar-paint-inset));box-sizing:border-box;border:none;border-inline:var(--dsh-sidebar-paint-inset) solid transparent;border-radius:var(--dsw-radius-md);color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer;background:padding-box padding-box;margin:0;line-height:22px;display:flex}@media (hover:hover){.kB3qhq_panelRow:hover{background-color:var(--dsw-alias-interactive-bg-hover)}}.kB3qhq_panelRow.kB3qhq_panelActive{background-color:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.kB3qhq_panelRow:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}.kB3qhq_moreAnchor{flex-direction:column;display:flex}.kB3qhq_panelRow[aria-expanded=true]{background-color:var(--dsw-alias-interactive-bg-hover)}.kB3qhq_moreMenu{width:288px;max-width:calc(100vw - 24px)}.kB3qhq_panelGlyph{flex:none;justify-content:center;align-items:center;display:inline-flex}.kB3qhq_panelTitle{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}.kB3qhq_collapsed .kB3qhq_panelList{gap:12px;margin-bottom:12px}.kB3qhq_collapsed .kB3qhq_panelRow{width:36px;height:36px;color:var(--dsw-alias-label-primary);background-clip:border-box;border-inline:0;justify-content:center;margin:0;padding:0}.kB3qhq_regionArea{min-height:0;margin-left:-4px;margin-right:calc(-1 * var(--dsh-sidebar-inline-padding));flex-direction:column;flex:1;padding-left:4px;display:flex;overflow:hidden}.kB3qhq_collapsed .kB3qhq_regionArea{margin-left:0;margin-right:0;padding-left:0}.kB3qhq_footArea{flex-direction:column;flex:none;display:flex}.kB3qhq_settingsArea,.kB3qhq_footerActions{flex:none;width:100%;min-width:0}.kB3qhq_footerActions{display:flex}.kB3qhq_collapsed .kB3qhq_footArea{align-items:center}.kB3qhq_collapsed .kB3qhq_settingsArea,.kB3qhq_collapsed .kB3qhq_footerActions{justify-content:center;width:auto;display:flex}@media (prefers-reduced-motion:reduce){.kB3qhq_wide,.kB3qhq_fading>*,.kB3qhq_railIn .kB3qhq_iconButton,.kB3qhq_railIn .kB3qhq_newSession,.kB3qhq_railIn .kB3qhq_panelList,.kB3qhq_railIn .kB3qhq_footArea,.kB3qhq_railIn .kB3qhq_regionArea{transition:none;animation:none}}";
		const tagId = "@deepseek-ai/dsh-client-ui-sidebar/SidebarRoot.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-sidebar-entries";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var SidebarRoot_module_css_default = {
			"brand": "kB3qhq_brand",
			"brandIdentity": "kB3qhq_brandIdentity",
			"brandMark": "kB3qhq_brandMark",
			"brandName": "kB3qhq_brandName",
			"buildVersion": "kB3qhq_buildVersion",
			"collapsed": "kB3qhq_collapsed",
			"copyVersion": "kB3qhq_copyVersion",
			"fading": "kB3qhq_fading",
			"fallbackBrandName": "kB3qhq_fallbackBrandName",
			"footArea": "kB3qhq_footArea",
			"footerActions": "kB3qhq_footerActions",
			"iconButton": "kB3qhq_iconButton",
			"localBuildBrand": "kB3qhq_localBuildBrand",
			"localBuildTitle": "kB3qhq_localBuildTitle",
			"logoRow": "kB3qhq_logoRow",
			"moreAnchor": "kB3qhq_moreAnchor",
			"moreMenu": "kB3qhq_moreMenu",
			"newSession": "kB3qhq_newSession",
			"newSessionContent": "kB3qhq_newSessionContent",
			"newSessionLabel": "kB3qhq_newSessionLabel",
			"newSessionLabelMask": "kB3qhq_newSessionLabelMask",
			"newSessionShortcut": "kB3qhq_newSessionShortcut",
			"panelActive": "kB3qhq_panelActive",
			"panelGlyph": "kB3qhq_panelGlyph",
			"panelIcon": "kB3qhq_panelIcon",
			"panelList": "kB3qhq_panelList",
			"panelRow": "kB3qhq_panelRow",
			"panelTitle": "kB3qhq_panelTitle",
			"quietBars": "kB3qhq_quietBars",
			"rail-fade-in": "kB3qhq_rail-fade-in",
			"rail-in": "kB3qhq_rail-in",
			"railIn": "kB3qhq_railIn",
			"railMark": "kB3qhq_railMark",
			"regionArea": "kB3qhq_regionArea",
			"root": "kB3qhq_root",
			"settingsArea": "kB3qhq_settingsArea",
			"toggle": "kB3qhq_toggle",
			"topStrip": "kB3qhq_topStrip",
			"wide": "kB3qhq_wide",
			"wide-in": "kB3qhq_wide-in"
		};
		//#endregion
		//#region lib/types/client/SidebarRoot.js
		/**
		* Sidebar shell: column geometry and global panel navigation.
		* Collapse is a slide plus crossfade:
		* content freezes at its expanded width (inline style) and fades out in place
		* while the sliding column (AppFrame grid tracks) clips it — nothing reflows
		* mid-slide. At settle the wide-only content unmounts and the upper
		* controls enter the 56px rail from the same horizontal offset (one icon each,
		* same top-down order) on one fade that ends with the slide. The bottom-pinned
		* settings control only fades. The workspace/session browsing region between
		* global panel rows and the foot is the `sidebar.workspaces` registrant's,
		* and the foot holds `sidebar.settings` plus `sidebar.footer.action`; the shell
		* hands them the wide flag (plus an expand request callback for the browser).
		*
		* The column also owns whether the scroll regions nested in it draw a
		* scrollbar at all: the shell tracks the pointer and rebinds ui-theme's
		* scrollbar indirection away while it is elsewhere, so a list the user is not
		* pointing at carries no bar.
		*/
		/** Wide-content unmount delay; matches the 150ms wide-content fade-out. */
		const COLLAPSE_SETTLE_MS = 150;
		/**
		* How long the column's scrollbars stay drawn after the pointer leaves it.
		* The bar is a pointer affordance here, and hiding it on the leave event
		* itself makes it blink out while the pointer is only crossing the column's
		* edge — on the way to the conversation, or around a portalled menu.
		*/
		const SCROLLBAR_LINGER_MS = 2e3;
		/** Format complete-build metadata for the local brand badge. */
		function localBuildVersion() {
			return `0.2.1-rc.4-df71bd3` + ({}.DSH_CLIENT_GIT_DIRTY === "true" ? "-dirty" : "");
		}
		/** Analytics category of an official panel; other panels are never reported. */
		function officialEntry(id) {
			if (id === "plugins") return "plugin";
			return id === "schedules" ? "cron" : void 0;
		}
		/** Each panel row subscribes only to its own selection state. */
		function PanelRow({ id, label, wide, usePanelInfo, selectPanel, trackEntryClick, renderSlot }) {
			const active = usePanelInfo((info) => info.activePanelId === id);
			return (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
				label,
				delayMs: 500,
				disabled: wide,
				children: (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: clsx(SidebarRoot_module_css_default.panelRow, active && SidebarRoot_module_css_default.panelActive),
					"aria-label": label,
					"aria-current": active ? "page" : void 0,
					onClick: () => {
						const entry = officialEntry(id);
						if (entry !== void 0) trackEntryClick({
							menu_name: entry,
							position: "sidebar"
						});
						selectPanel(id);
					},
					children: [(0, react_jsx_runtime.jsx)("span", {
						className: SidebarRoot_module_css_default.panelGlyph,
						"aria-hidden": "true",
						children: renderSlot("sidebar.panellist", {
							size: wide ? 16 : 18,
							active
						}, { only: id })
					}), wide && (0, react_jsx_runtime.jsx)("span", {
						className: clsx(SidebarRoot_module_css_default.panelTitle, SidebarRoot_module_css_default.wide),
						children: label
					})]
				})
			});
		}
		/** The panel list's More launcher: a panel-row button whose menu rows come from `sidebar.panellist.actions`. */
		function PanelMoreMenu({ wide, label, entries, onOpen, onPinnedChange, trackEntryClick, renderSlot }) {
			const [open, setOpen] = (0, react.useState)(false);
			const onDismiss = () => {
				setOpen(false);
			};
			return (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, {
				open,
				onClose: onDismiss,
				portal: true,
				autoFocus: true,
				className: SidebarRoot_module_css_default.moreAnchor,
				listClassName: SidebarRoot_module_css_default.moreMenu,
				anchor: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
					label,
					delayMs: 500,
					disabled: wide,
					children: (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: SidebarRoot_module_css_default.panelRow,
						"aria-label": label,
						"aria-haspopup": "menu",
						"aria-expanded": open,
						onClick: () => {
							trackEntryClick({
								menu_name: "more",
								position: "sidebar"
							});
							setOpen((value) => !value);
						},
						children: [(0, react_jsx_runtime.jsx)("span", {
							className: SidebarRoot_module_css_default.panelGlyph,
							"aria-hidden": "true",
							children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconAppsAddOutlineRegular, { size: wide ? 16 : 18 })
						}), wide && (0, react_jsx_runtime.jsx)("span", {
							className: clsx(SidebarRoot_module_css_default.panelTitle, SidebarRoot_module_css_default.wide),
							children: label
						})]
					})
				}),
				children: renderSlot("sidebar.panellist.actions", {
					entries,
					onOpen,
					onPinnedChange,
					onDismiss
				})
			});
		}
		/**
		* Render the sidebar column shell.
		* @param props - composed slot props (runtime share + injected callbacks, contract/slots.ts).
		* @returns the sidebar element tree.
		*/
		function SidebarRoot({ collapsed, width, startSession, toggleSidebar, selectPanel, setPinned, setOrder, trackEntryClick, useRemoteAccess, usePanels, useEntryPins, useEntryOrder, useEntryActions, useShortcuts, usePanelInfo, t, renderSlot }) {
			const panels = usePanels((snapshot) => snapshot);
			const unpinned = useEntryPins((ids) => ids);
			const entryOrder = useEntryOrder((ids) => ids);
			const [entriesOpen, setEntriesOpen] = (0, react.useState)(false);
			const orderedPanels = applyEntryOrder(panels, entryOrder);
			const activePanelId = usePanelInfo((info) => info.activePanelId);
			const hasEntryActions = useEntryActions((registered) => registered);
			const shortcut = useShortcuts((rows) => rows.find((row) => row.id === "sidebar.left.toggle"));
			const newShortcut = useShortcuts((rows) => rows.find((row) => row.id === "session.new"));
			const canStartSession = useRemoteAccess("session/create");
			const toggleLabel = collapsed ? t("toggle.open") : t("toggle.collapse");
			const [settled, setSettled] = (0, react.useState)(collapsed);
			(0, react.useEffect)(() => {
				if (!collapsed) {
					setSettled(false);
					return;
				}
				const timer = window.setTimeout(() => {
					setSettled(true);
				}, COLLAPSE_SETTLE_MS);
				return () => {
					window.clearTimeout(timer);
				};
			}, [collapsed]);
			const windowsTitlebar = document.documentElement.hasAttribute("data-windows-titlebar");
			const wide = windowsTitlebar ? !collapsed : !collapsed || !settled;
			const openNewSession = () => {
				trackEntryClick({
					menu_name: "new_session",
					position: windowsTitlebar && collapsed ? "titlebar" : "sidebar"
				});
				startSession();
			};
			const captionTooltipSide = windowsTitlebar ? "bottom" : "right";
			const lastWideWidth = (0, react.useRef)(width);
			if (!collapsed) lastWideWidth.current = width;
			const everWide = (0, react.useRef)(!collapsed);
			if (!collapsed) everWide.current = true;
			const column = (0, react.useRef)(null);
			const [pointerInside, setPointerInside] = (0, react.useState)(false);
			const lingerTimer = (0, react.useRef)(void 0);
			const armLinger = () => {
				if (lingerTimer.current !== void 0) return;
				lingerTimer.current = window.setTimeout(() => {
					lingerTimer.current = void 0;
					setPointerInside(false);
				}, SCROLLBAR_LINGER_MS);
			};
			const cancelLinger = () => {
				window.clearTimeout(lingerTimer.current);
				lingerTimer.current = void 0;
			};
			(0, react.useEffect)(() => {
				if (!pointerInside) return;
				const onMove = (event) => {
					const rect = column.current?.getBoundingClientRect();
					/* v8 ignore next -- the listener only exists while the column is mounted and revealed. */
					if (rect === void 0) return;
					if (event.clientX >= rect.left && event.clientX < rect.right && event.clientY >= rect.top && event.clientY < rect.bottom) cancelLinger();
					else armLinger();
				};
				document.addEventListener("pointermove", onMove);
				return () => {
					document.removeEventListener("pointermove", onMove);
					cancelLinger();
				};
			}, [pointerInside]);
			const buildVersion = localBuildVersion();
			const [copiedToast, setCopiedToast] = (0, react.useState)(null);
			const copyVersion = (version) => () => {
				(0, _deepseek_ai_dsh_client_ui_primitives.writeClipboard)(version).then((ok) => {
					if (ok) setCopiedToast((seq) => (seq ?? 0) + 1);
				});
			};
			const darwinDesktop = (0, _deepseek_ai_dsh_client_ui_primitives.isDarwinDesktop)();
			const toggle = (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
				label: toggleLabel,
				shortcutKeys: shortcut?.keys,
				delayMs: 500,
				side: captionTooltipSide,
				children: (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: clsx(SidebarRoot_module_css_default.iconButton, SidebarRoot_module_css_default.toggle),
					"aria-label": toggleLabel,
					"aria-keyshortcuts": shortcut?.aria,
					onClick: () => {
						toggleSidebar();
					},
					children: [
						!wide && !windowsTitlebar && (0, react_jsx_runtime.jsx)("span", {
							className: SidebarRoot_module_css_default.railMark,
							"aria-hidden": "true",
							children: renderSlot("sidebar.brand.mark", { size: 24 }, { fallback: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.FishLogo, { size: 24 }) })
						}),
						(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPanelLeftOutlineRegular, {
							className: SidebarRoot_module_css_default.panelIcon,
							size: wide || windowsTitlebar ? 16 : 18
						}),
						!wide && renderSlot("sidebar.toggle.badge", {})
					]
				})
			});
			return (0, react_jsx_runtime.jsxs)("div", {
				ref: column,
				className: clsx(SidebarRoot_module_css_default.root, !wide && SidebarRoot_module_css_default.collapsed, !wide && everWide.current && SidebarRoot_module_css_default.railIn, collapsed && wide && SidebarRoot_module_css_default.fading, !pointerInside && SidebarRoot_module_css_default.quietBars),
				style: wide ? { width: collapsed ? lastWideWidth.current : width } : void 0,
				onPointerEnter: () => {
					cancelLinger();
					setPointerInside(true);
				},
				onPointerLeave: () => {
					armLinger();
				},
				children: [
					darwinDesktop && (0, react_jsx_runtime.jsx)("div", {
						className: SidebarRoot_module_css_default.topStrip,
						"data-window-drag": true,
						children: toggle
					}),
					(0, react_jsx_runtime.jsxs)("div", {
						className: SidebarRoot_module_css_default.logoRow,
						"data-window-drag": true,
						children: [wide && (() => {
							const identity = (0, react_jsx_runtime.jsxs)("span", {
								className: SidebarRoot_module_css_default.brandIdentity,
								"aria-hidden": "true",
								children: [(0, react_jsx_runtime.jsx)("span", {
									className: SidebarRoot_module_css_default.brandMark,
									children: renderSlot("sidebar.brand.mark", { size: 24 }, { fallback: buildVersion === void 0 ? (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.FishLogo, { size: 24 }) : (0, react_jsx_runtime.jsx)("span", {
										className: SidebarRoot_module_css_default.copyVersion,
										"data-copy-version": true,
										onClick: copyVersion(buildVersion),
										children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.FishLogo, { size: 24 })
									}) })
								}), (0, react_jsx_runtime.jsx)("span", {
									className: SidebarRoot_module_css_default.brandName,
									children: renderSlot("sidebar.brand.name", {}, { fallback: buildVersion === void 0 ? (0, react_jsx_runtime.jsx)("span", {
										className: SidebarRoot_module_css_default.fallbackBrandName,
										children: t("brand.localBuild")
									}) : (0, react_jsx_runtime.jsxs)("span", {
										className: clsx(SidebarRoot_module_css_default.localBuildBrand, SidebarRoot_module_css_default.copyVersion),
										"data-copy-version": true,
										onClick: copyVersion(buildVersion),
										children: [(0, react_jsx_runtime.jsx)("span", {
											className: SidebarRoot_module_css_default.localBuildTitle,
											children: t("brand.localBuild")
										}), (0, react_jsx_runtime.jsx)("span", {
											className: SidebarRoot_module_css_default.buildVersion,
											children: buildVersion
										})]
									}) })
								})]
							});
							return darwinDesktop || !canStartSession ? (0, react_jsx_runtime.jsx)("span", {
								className: clsx(SidebarRoot_module_css_default.brand, SidebarRoot_module_css_default.wide),
								children: identity
							}) : (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: clsx(SidebarRoot_module_css_default.brand, SidebarRoot_module_css_default.wide),
								"aria-label": t("session.new.label"),
								"aria-keyshortcuts": newShortcut?.aria,
								onClick: (event) => {
									if (event.target.closest("[data-copy-version]") !== null) return;
									openNewSession();
								},
								children: identity
							});
						})(), !darwinDesktop && toggle]
					}),
					canStartSession && (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
						label: t("session.new.label"),
						shortcutKeys: newShortcut?.keys,
						delayMs: 500,
						side: captionTooltipSide,
						disabled: wide,
						children: (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: SidebarRoot_module_css_default.newSession,
							"aria-label": t("session.new.label"),
							"aria-keyshortcuts": newShortcut?.aria,
							onClick: openNewSession,
							children: [(0, react_jsx_runtime.jsx)("span", {
								className: SidebarRoot_module_css_default.newSessionLabelMask,
								children: (0, react_jsx_runtime.jsxs)("span", {
									className: SidebarRoot_module_css_default.newSessionContent,
									children: [wide ? (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconNewChatOutlineMedium, { size: 14 }) : (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconNewChatOutlineRegular, { size: windowsTitlebar ? 16 : 18 }), wide && (0, react_jsx_runtime.jsx)("span", {
										className: clsx(SidebarRoot_module_css_default.newSessionLabel, SidebarRoot_module_css_default.wide),
										children: t("session.new")
									})]
								})
							}), wide && newShortcut !== void 0 && newShortcut.keys.length > 0 && (0, react_jsx_runtime.jsx)("span", {
								className: SidebarRoot_module_css_default.newSessionShortcut,
								"aria-hidden": "true",
								children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.ShortcutKeys, { keys: newShortcut.keys })
							})]
						})
					}),
					panels.length > 0 && (0, react_jsx_runtime.jsxs)("nav", {
						className: SidebarRoot_module_css_default.panelList,
						"aria-label": t("panels.label"),
						children: [orderedPanels.filter(({ id }) => id === "plugins" || !unpinned.includes(id)).map(({ id, label }) => (0, react_jsx_runtime.jsx)(PanelRow, {
							id,
							label,
							wide,
							usePanelInfo,
							selectPanel,
							trackEntryClick,
							renderSlot
						}, id)), hasEntryActions && (0, react_jsx_runtime.jsx)(PanelMoreMenu, {
							wide,
							label: t("panels.more"),
							entries: orderedPanels.filter(({ id }) => id !== "plugins").map(({ id, label }) => ({
								id,
								label,
								pinned: !unpinned.includes(id),
								active: id === activePanelId
							})),
							onOpen: (id) => {
								const entry = officialEntry(id);
								if (entry !== void 0) trackEntryClick({
									menu_name: entry,
									position: "sidebar_more"
								});
								const panel = panels.find((candidate) => candidate.id === id);
								if (panel !== void 0) selectPanel(panel.id);
							},
							onPinnedChange: setPinned,
							trackEntryClick,
							renderSlot
						})]
					}), (0, react_jsx_runtime.jsx)(PanelSettingsRow, {
						wide,
						label: t("entries.settings"),
						onClick: () => {
							setEntriesOpen(true);
						}
					}),
					(0, react_jsx_runtime.jsx)("div", {
						className: SidebarRoot_module_css_default.regionArea,
						children: renderSlot("sidebar.workspaces", {
							wide,
							expandSidebar: () => {
								if (collapsed) toggleSidebar();
							}
						})
					}),
					copiedToast !== null && (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Toast, {
						tone: "success",
						text: t("version.copied"),
						onDone: () => {
							setCopiedToast(null);
						}
					}, copiedToast),
					(0, react_jsx_runtime.jsxs)("div", {
						className: SidebarRoot_module_css_default.footArea,
						children: [(0, react_jsx_runtime.jsx)("div", {
							className: SidebarRoot_module_css_default.footerActions,
							children: renderSlot("sidebar.footer.action", { wide })
						}), (0, react_jsx_runtime.jsx)("div", {
							className: SidebarRoot_module_css_default.settingsArea,
							children: renderSlot("sidebar.settings", { wide })
						})]
					}), (0, react_jsx_runtime.jsx)(EntrySettingsDialog, {
						open: entriesOpen,
						onClose: () => {
							setEntriesOpen(false);
						},
						entries: orderedPanels.map(({ id, label }) => ({
							id,
							label
						})),
						unpinned,
						onOrder: setOrder,
						onPinnedChange: setPinned,
						onReset: () => {
							setOrder([]);
							for (const id of unpinned) setPinned(id, true);
						},
						renderSlot,
						t
					})
				]
			});
		}
		//#endregion
		//#region lib/types/client/locales.js
		/** `sidebar` namespace dictionaries for shell controls and global panels. */
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"session.new": "新会话",
			"session.new.label": "新建会话",
			"toggle.open": "打开侧边栏",
			"toggle.collapse": "收起侧边栏",
			"panels.label": "全局面板",
			"panels.more": "更多",
			"entries.settings": "入口设置",
			"entries.title": "入口设置",
			"entries.description": "调整左侧入口的顺序；取消勾选即可从列表隐藏，隐藏的入口仍可在“更多”里打开。",
			"entries.show": "在列表中显示",
			"entries.moveUp": "上移",
			"entries.moveDown": "下移",
			"entries.reset": "恢复默认",
			"entries.close": "完成",
			"version.copied": "版本号复制成功"
		};
		/** English dictionary, checked complete against the zh key set. */
		const en = {
			"session.new": "New Session",
			"session.new.label": "New session",
			"toggle.open": "Open sidebar",
			"toggle.collapse": "Collapse sidebar",
			"panels.label": "Global panels",
			"panels.more": "More",
			"entries.settings": "Entry settings",
			"entries.title": "Entry settings",
			"entries.description": "Reorder the left sidebar entries. Clear a box to hide one from the list; hidden entries stay reachable from More.",
			"entries.show": "Show in list",
			"entries.moveUp": "Move up",
			"entries.moveDown": "Move down",
			"entries.reset": "Reset",
			"entries.close": "Done",
			"version.copied": "Version copied"
		};
		/** Japanese copy, checked against the English keys. */
		const ja = {
			"session.new": "新規セッション",
			"session.new.label": "新規セッション",
			"toggle.open": "サイドバーを開く",
			"toggle.collapse": "サイドバーを折りたたむ",
			"panels.label": "グローバルパネル",
			"panels.more": "その他",
			"entries.settings": "エントリ設定",
			"entries.title": "エントリ設定",
			"entries.description": "左サイドバーの並び順を変更します。チェックを外すと一覧から隠れます（「その他」からは開けます）。",
			"entries.show": "一覧に表示",
			"entries.moveUp": "上へ",
			"entries.moveDown": "下へ",
			"entries.reset": "初期値に戻す",
			"entries.close": "完了",
			"version.copied": "バージョンをコピーしました"
		};
		/** Spanish dictionary, checked against the English keys. */
		const es = {
			"session.new": "Nueva sesión",
			"session.new.label": "Nueva sesión",
			"toggle.open": "Abrir barra lateral",
			"toggle.collapse": "Contraer barra lateral",
			"panels.label": "Paneles globales",
			"panels.more": "Más",
			"entries.settings": "Ajustes de entradas",
			"entries.title": "Ajustes de entradas",
			"entries.description": "Reordena las entradas de la barra lateral. Desmarca una para ocultarla de la lista; seguirá disponible en Más.",
			"entries.show": "Mostrar en la lista",
			"entries.moveUp": "Subir",
			"entries.moveDown": "Bajar",
			"entries.reset": "Restablecer",
			"entries.close": "Listo",
			"version.copied": "Versión copiada"
		};
		/** French dictionary, checked against the English keys. */
		const fr = {
			"session.new": "Nouvelle séance",
			"session.new.label": "Nouvelle séance",
			"toggle.open": "Ouvrir la barre latérale",
			"toggle.collapse": "Réduire la barre latérale",
			"panels.label": "Panneaux globaux",
			"panels.more": "Plus",
			"entries.settings": "Réglages des entrées",
			"entries.title": "Réglages des entrées",
			"entries.description": "Réordonnez les entrées de la barre latérale. Décochez une entrée pour la masquer de la liste ; elle reste accessible via Plus.",
			"entries.show": "Afficher dans la liste",
			"entries.moveUp": "Monter",
			"entries.moveDown": "Descendre",
			"entries.reset": "Réinitialiser",
			"entries.close": "Terminé",
			"version.copied": "Version copiée"
		};
		/** German dictionary, checked against the English keys. */
		const de = {
			"session.new": "Neue Sitzung",
			"session.new.label": "Neue Sitzung",
			"toggle.open": "Seitenleiste öffnen",
			"toggle.collapse": "Seitenleiste einklappen",
			"panels.label": "Globale Bereiche",
			"panels.more": "Mehr",
			"entries.settings": "Einträge verwalten",
			"entries.title": "Einträge verwalten",
			"entries.description": "Ordne die Einträge der Seitenleiste. Ein Häkchen entfernen blendet den Eintrag aus; erreichbar bleibt er über Mehr.",
			"entries.show": "In der Liste anzeigen",
			"entries.moveUp": "Nach oben",
			"entries.moveDown": "Nach unten",
			"entries.reset": "Zurücksetzen",
			"entries.close": "Fertig",
			"version.copied": "Version kopiert"
		};
		/** Russian dictionary, checked against the English keys. */
		const ru = {
			"session.new": "Новая сессия",
			"session.new.label": "Новая сессия",
			"toggle.open": "Открыть боковую панель",
			"toggle.collapse": "Свернуть боковую панель",
			"panels.label": "Глобальные панели",
			"panels.more": "Ещё",
			"entries.settings": "Настройки входов",
			"entries.title": "Настройки входов",
			"entries.description": "Измените порядок пунктов боковой панели. Снимите флажок, чтобы скрыть пункт из списка; он останется в «Ещё».",
			"entries.show": "Показывать в списке",
			"entries.moveUp": "Выше",
			"entries.moveDown": "Ниже",
			"entries.reset": "Сбросить",
			"entries.close": "Готово",
			"version.copied": "Версия скопирована"
		};
		/** Portuguese dictionary, checked against the English keys. */
		const pt = {
			"session.new": "Nova sessão",
			"session.new.label": "Nova sessão",
			"toggle.open": "Abrir barra lateral",
			"toggle.collapse": "Recolher barra lateral",
			"panels.label": "Painéis globais",
			"panels.more": "Mais",
			"entries.settings": "Ajustes de entradas",
			"entries.title": "Ajustes de entradas",
			"entries.description": "Reordene as entradas da barra lateral. Desmarque uma para ocultá-la da lista; ela continua acessível em Mais.",
			"entries.show": "Mostrar na lista",
			"entries.moveUp": "Mover para cima",
			"entries.moveDown": "Mover para baixo",
			"entries.reset": "Restaurar padrão",
			"entries.close": "Concluir",
			"version.copied": "Versão copiada"
		};
		//#endregion
		//#region lib/types/client/index.js
		/** Dictionary namespace owned by this plugin. */
		const NS = "sidebar";
		/** Services required by the sidebar plugin. */
		const inject = [
			"slots",
			"layout",
			"uiWorkspace",
			"locale",
			"shortcuts"
		];
		/** Registers the sidebar shell and its service callbacks.
		* @param ctx - Client root context.
		*/
		function apply(ctx) {
			const workspaceNavigation = ctx.get("uiWorkspace");
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en,
				ja,
				es,
				fr,
				de,
				ru,
				pt
			}), "ui-sidebar: dictionaries");
			const panels = (0, _deepseek_ai_dsh_client_store.createSnapshotStore)([]);
			const syncPanels = () => {
				const next = ctx.slots.entriesOfSlot("sidebar.panellist").map(({ options }) => {
					const id = options.id;
					return {
						id,
						order: options.order ?? 0,
						label: (0, _deepseek_ai_dsh_client_ui_slots.resolveSlotLabel)(options.label) ?? id
					};
				}).sort((a, b) => a.order - b.order);
				const previous = panels.getSnapshot();
				if (previous.length === next.length && previous.every((panel, index) => {
					const candidate = next[index];
					return panel.id === candidate.id && panel.order === candidate.order && panel.label === candidate.label;
				})) return;
				panels.set(next);
			};
			ctx.effect(() => ctx.slots.subscribe("sidebar.panellist", syncPanels), "ui-sidebar: panel entries");
			ctx.effect(() => ctx.locale.subscribe(syncPanels), "ui-sidebar: panel labels");
			const panelPins = createPanelPins();
			const entryOrder = createEntryOrder();
			const entryActions = {
				getSnapshot: () => ctx.slots.entriesOfSlot("sidebar.panellist.actions").length > 0,
				subscribe: (listener) => ctx.slots.subscribe("sidebar.panellist.actions", listener)
			};
			const injectProps = () => ({
				startSession: (workspaceId) => {
					workspaceNavigation.startSession(workspaceId);
				},
				toggleSidebar: () => {
					ctx.layout.toggleSidebar();
				},
				selectPanel: (id) => {
					ctx.layout.selectPanel(id);
				},
				setPinned: panelPins.setPinned,
				setOrder: entryOrder.setOrder,
				trackEntryClick: (attributes) => {
					ctx.get("productAnalytics")?.track("sidebar_menu_click", attributes);
				},
				hooks: {
					panels,
					shortcuts: ctx.shortcuts.catalog,
					entryPins: panelPins.unpinned,
					entryOrder: entryOrder.order,
					entryActions
				}
			});
			ctx.slots.inject("sidebar", () => ctx.slots.register({
				name: "sidebar",
				locale: NS,
				children: {
					"sidebar.brand.mark": {
						kind: "single",
						scope: "root"
					},
					"sidebar.brand.name": {
						kind: "single",
						scope: "root"
					},
					"sidebar.toggle.badge": {
						kind: "single",
						scope: "root"
					},
					"sidebar.panellist": {
						kind: "list",
						scope: "root"
					},
					"sidebar.panellist.actions": {
						kind: "list",
						scope: "root"
					},
					"sidebar.workspaces": {
						kind: "single",
						scope: "root"
					},
					"sidebar.settings": {
						kind: "single",
						scope: "root"
					},
					"sidebar.footer.action": {
						kind: "list",
						scope: "root"
					}
				},
				inject: injectProps
			}, SidebarRoot));
			ctx.slots.inject("shell.leading", () => ctx.slots.register({
				name: "shell.leading",
				locale: NS,
				inject: injectProps
			}, HeaderLeadingControls));
			syncPanels();
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map