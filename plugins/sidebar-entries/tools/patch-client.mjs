#!/usr/bin/env node
// Patch the installed @deepseek-ai/dsh-client-ui-sidebar client bundle so the
// left sidebar panel list gets an "入口设置" (entry settings) row that controls
// entry order and visibility, persisted in localStorage. The patched bundle is
// then re-registered under this plugin's own module id.
//
// Usage: node tools/patch-client.mjs tools/pristine-client.js client.js
import { readFileSync, writeFileSync } from "node:fs";

const [, , srcPath, outPath] = process.argv;
if (!srcPath || !outPath) {
  console.error("usage: node patch-client.mjs <pristine-client.js> <out-client.js>");
  process.exit(2);
}

let source = readFileSync(srcPath, "utf8");

function replaceOnce(anchor, replacement, label) {
  const count = source.split(anchor).length - 1;
  if (count !== 1) throw new Error(`anchor "${label}" matched ${count} times (expected 1)`);
  source = source.replace(anchor, replacement);
}

// ── 1. entry-settings module: preference store, sorter, launcher row, dialog ──
const entrySettingsRegion = String.raw`

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
`;

replaceOnce("const NO_PANELS = [];", "const NO_PANELS = [];\n" + entrySettingsRegion, "NO_PANELS");

// ── 2. pins start from storage and every change is persisted ──
replaceOnce(
  `const store = (0, _deepseek_ai_dsh_client_store.createSnapshotStore)({ unpinned: NO_PANELS });`,
  `const store = (0, _deepseek_ai_dsh_client_store.createSnapshotStore)({ unpinned: readEntryPrefs().unpinned });`,
  "pin store init",
);
replaceOnce(
  `					store.set({ unpinned: pinned ? current.filter((entry) => entry !== id) : [...current, id] });`,
  `					const next = pinned ? current.filter((entry) => entry !== id) : [...current, id];
					store.set({ unpinned: next });
					writeEntryPrefs({ unpinned: next });`,
  "setPinned body",
);

// ── 3. SidebarRoot: order-aware list, dialog state, launcher row, dialog ──
replaceOnce(
  `function SidebarRoot({ collapsed, width, startSession, toggleSidebar, selectPanel, setPinned, trackEntryClick, useRemoteAccess, usePanels, useEntryPins, useEntryActions, useShortcuts, usePanelInfo, t, renderSlot }) {`,
  `function SidebarRoot({ collapsed, width, startSession, toggleSidebar, selectPanel, setPinned, setOrder, trackEntryClick, useRemoteAccess, usePanels, useEntryPins, useEntryOrder, useEntryActions, useShortcuts, usePanelInfo, t, renderSlot }) {`,
  "SidebarRoot signature",
);
replaceOnce(
  `			const unpinned = useEntryPins((ids) => ids);`,
  `			const unpinned = useEntryPins((ids) => ids);
			const entryOrder = useEntryOrder((ids) => ids);
			const [entriesOpen, setEntriesOpen] = (0, react.useState)(false);
			const orderedPanels = applyEntryOrder(panels, entryOrder);`,
  "SidebarRoot hooks",
);
replaceOnce(
  `						children: [panels.filter(({ id }) => id === "plugins" || !unpinned.includes(id)).map(`,
  `						children: [orderedPanels.filter(({ id }) => id === "plugins" || !unpinned.includes(id)).map(`,
  "panel list filter",
);
replaceOnce(
  `							entries: panels.filter(({ id }) => id !== "plugins").map(({ id, label }) => ({`,
  `							entries: orderedPanels.filter(({ id }) => id !== "plugins").map(({ id, label }) => ({`,
  "more menu entries",
);
replaceOnce(
  `\t\t\t\t\t\t})]
\t\t\t\t\t}),
\t\t\t\t\t(0, react_jsx_runtime.jsx)("div", {
\t\t\t\t\t\tclassName: SidebarRoot_module_css_default.regionArea,`,
  `\t\t\t\t\t\t})]
\t\t\t\t\t}), (0, react_jsx_runtime.jsx)(PanelSettingsRow, {
\t\t\t\t\t\twide,
\t\t\t\t\t\tlabel: t("entries.settings"),
\t\t\t\t\t\tonClick: () => {
\t\t\t\t\t\t\tsetEntriesOpen(true);
\t\t\t\t\t\t}
\t\t\t\t\t}),
\t\t\t\t\t(0, react_jsx_runtime.jsx)("div", {
\t\t\t\t\t\tclassName: SidebarRoot_module_css_default.regionArea,`,
  "launcher row",
);
replaceOnce(
  `\t\t\t\t\t\t\tchildren: renderSlot("sidebar.settings", { wide })
\t\t\t\t\t\t})]
\t\t\t\t\t})
\t\t\t\t]`,
  `\t\t\t\t\t\t\tchildren: renderSlot("sidebar.settings", { wide })
\t\t\t\t\t\t})]
\t\t\t\t\t}), (0, react_jsx_runtime.jsx)(EntrySettingsDialog, {
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
				]`,
  "dialog mount",
);

// ── 4. inject the new order store and setter into the sidebar's slot props ──
replaceOnce(
  `			const panelPins = createPanelPins();`,
  `			const panelPins = createPanelPins();
			const entryOrder = createEntryOrder();`,
  "order store",
);
replaceOnce(
  `				setPinned: panelPins.setPinned,`,
  `				setPinned: panelPins.setPinned,
				setOrder: entryOrder.setOrder,`,
  "setOrder prop",
);
replaceOnce(
  `					entryPins: panelPins.unpinned,`,
  `					entryPins: panelPins.unpinned,
					entryOrder: entryOrder.order,`,
  "entryOrder hook",
);

// ── 5. locale copy for the new row and dialog (every shipped locale) ──
const copy = {
  zh: {
    settings: "入口设置",
    title: "入口设置",
    description: "调整左侧入口的顺序；取消勾选即可从列表隐藏，隐藏的入口仍可在“更多”里打开。",
    show: "在列表中显示",
    moveUp: "上移",
    moveDown: "下移",
    reset: "恢复默认",
    close: "完成",
  },
  en: {
    settings: "Entry settings",
    title: "Entry settings",
    description: "Reorder the left sidebar entries. Clear a box to hide one from the list; hidden entries stay reachable from More.",
    show: "Show in list",
    moveUp: "Move up",
    moveDown: "Move down",
    reset: "Reset",
    close: "Done",
  },
  ja: {
    settings: "エントリ設定",
    title: "エントリ設定",
    description: "左サイドバーの並び順を変更します。チェックを外すと一覧から隠れます（「その他」からは開けます）。",
    show: "一覧に表示",
    moveUp: "上へ",
    moveDown: "下へ",
    reset: "初期値に戻す",
    close: "完了",
  },
  es: {
    settings: "Ajustes de entradas",
    title: "Ajustes de entradas",
    description: "Reordena las entradas de la barra lateral. Desmarca una para ocultarla de la lista; seguirá disponible en Más.",
    show: "Mostrar en la lista",
    moveUp: "Subir",
    moveDown: "Bajar",
    reset: "Restablecer",
    close: "Listo",
  },
  fr: {
    settings: "Réglages des entrées",
    title: "Réglages des entrées",
    description: "Réordonnez les entrées de la barre latérale. Décochez une entrée pour la masquer de la liste ; elle reste accessible via Plus.",
    show: "Afficher dans la liste",
    moveUp: "Monter",
    moveDown: "Descendre",
    reset: "Réinitialiser",
    close: "Terminé",
  },
  de: {
    settings: "Einträge verwalten",
    title: "Einträge verwalten",
    description: "Ordne die Einträge der Seitenleiste. Ein Häkchen entfernen blendet den Eintrag aus; erreichbar bleibt er über Mehr.",
    show: "In der Liste anzeigen",
    moveUp: "Nach oben",
    moveDown: "Nach unten",
    reset: "Zurücksetzen",
    close: "Fertig",
  },
  ru: {
    settings: "Настройки входов",
    title: "Настройки входов",
    description: "Измените порядок пунктов боковой панели. Снимите флажок, чтобы скрыть пункт из списка; он останется в «Ещё».",
    show: "Показывать в списке",
    moveUp: "Выше",
    moveDown: "Ниже",
    reset: "Сбросить",
    close: "Готово",
  },
  pt: {
    settings: "Ajustes de entradas",
    title: "Ajustes de entradas",
    description: "Reordene as entradas da barra lateral. Desmarque uma para ocultá-la da lista; ela continua acessível em Mais.",
    show: "Mostrar na lista",
    moveUp: "Mover para cima",
    moveDown: "Mover para baixo",
    reset: "Restaurar padrão",
    close: "Concluir",
  },
};

const moreValue = {
  zh: "更多",
  en: "More",
  ja: "その他",
  es: "Más",
  fr: "Plus",
  de: "Mehr",
  ru: "Ещё",
  pt: "Mais",
};

for (const [lang, values] of Object.entries(copy)) {
  const anchor = `			"panels.more": "${moreValue[lang]}",`;
  const lines = [
    `			"entries.settings": ${JSON.stringify(values.settings)},`,
    `			"entries.title": ${JSON.stringify(values.title)},`,
    `			"entries.description": ${JSON.stringify(values.description)},`,
    `			"entries.show": ${JSON.stringify(values.show)},`,
    `			"entries.moveUp": ${JSON.stringify(values.moveUp)},`,
    `			"entries.moveDown": ${JSON.stringify(values.moveDown)},`,
    `			"entries.reset": ${JSON.stringify(values.reset)},`,
    `			"entries.close": ${JSON.stringify(values.close)},`,
  ].join("\n");
  replaceOnce(anchor, `${anchor}\n${lines}`, `locale ${lang}`);
}

// ── 4. serve under this plugin's module id ───────────────────────────────────
source = source.replace(
  'id: "@deepseek-ai/dsh-client-ui-sidebar"',
  'id: "dsh-sidebar-entries"',
);
source = source.replaceAll(
  'tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-sidebar"',
  'tag.dataset.plugin = "dsh-sidebar-entries"',
);

writeFileSync(outPath, source);
console.log(`patched ${srcPath} -> ${outPath}`);
