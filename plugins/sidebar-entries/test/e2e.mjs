// End-to-end check for dsh-sidebar-entries against a live DSH web server.
//
// Usage: node test/e2e.mjs <url-with-token> <out-dir>
//
// Requires puppeteer-core and a local Chrome; both are taken from the desktop
// profile, matching how this plugin is verified on this machine.
import puppeteer from "/Users/fuzhuo/.dsh/profiles/desktop/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
import { mkdirSync } from "node:fs";

const url = process.argv[2];
const out = process.argv[3] ?? "/tmp/sidebar-entries-e2e";
if (!url) {
  console.error("usage: node test/e2e.mjs <url-with-token> <out-dir>");
  process.exit(2);
}
mkdirSync(out, { recursive: true });

const SETTINGS_LABELS = ["入口设置", "Entry settings"];
const RESET_LABELS = ["恢复默认", "Restore defaults"];
const MOVE_UP_LABELS = ["上移", "Move up"];

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu", "--window-size=1200,860"],
  defaultViewport: { width: 1200, height: 860, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
const problems = [];
page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
page.on("console", (message) => {
  if (message.type() === "error") problems.push(`console: ${message.text()}`);
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await page.goto(url, { waitUntil: "networkidle2", timeout: 120000 });
await wait(4000);

// Dismiss the preview-version notice if it is on screen.
const dismissed = await page.evaluate(() => {
  for (const button of document.querySelectorAll("button")) {
    const text = button.textContent?.trim();
    if (text === "继续" || text === "Continue") {
      button.click();
      return true;
    }
  }
  return false;
});
if (dismissed) await wait(1500);

/** Labels of the sidebar panel rows, in render order. */
const listSnapshot = () =>
  page.evaluate(() => {
    const navs = [...document.querySelectorAll("nav")];
    const nav =
      navs.find((candidate) => (candidate.getAttribute("aria-label") ?? "").includes("全局面板")) ??
      navs.find((candidate) => (candidate.getAttribute("aria-label") ?? "").includes("Global")) ??
      navs.find((candidate) => candidate.querySelectorAll("button").length >= 2);
    return nav === undefined
      ? []
      : [...nav.querySelectorAll("button")].map(
          (button) => button.getAttribute("aria-label") ?? button.textContent?.trim() ?? "",
        );
  });

const clickByLabel = (labels) =>
  page.evaluate((wanted) => {
    const button = [...document.querySelectorAll("button")].find((candidate) =>
      wanted.includes(candidate.getAttribute("aria-label") ?? ""),
    );
    if (button === undefined) return false;
    button.click();
    return true;
  }, labels);

/** The entry-settings dialog: the one holding a list of checkbox rows. */
const dialogRows = () =>
  page.evaluate(() => {
    const dialogs = [...document.querySelectorAll('div[role="dialog"]')];
    const own = dialogs.find((dialog) => dialog.querySelectorAll('input[type="checkbox"]').length > 0);
    if (own === undefined) return [];
    return [...own.querySelectorAll("li")].map((item) => ({
      label: item.querySelector('input[type="checkbox"]')?.getAttribute("aria-label") ?? "",
      checked: item.querySelector('input[type="checkbox"]')?.checked ?? false,
      hideable: item.querySelector('input[type="checkbox"]')?.disabled !== true,
    }));
  });

const stored = () =>
  page.evaluate(() => window.localStorage.getItem("dsh.sidebar.entryPrefs.v1"));

const result = { checks: {}, problems, stored: null };
const check = (name, value) => {
  result.checks[name] = value;
};

const before = await listSnapshot();
check("listBefore", before);
await page.screenshot({ path: `${out}/1-list.png` });

// 1. the settings row exists and opens a dialog
const opened = await clickByLabel(SETTINGS_LABELS);
check("settingsRow", opened);
await wait(1200);
const rows = await dialogRows();
check("dialogRows", rows.map((row) => row.label));
await page.screenshot({ path: `${out}/2-dialog.png` });

if (!opened || rows.length === 0) {
  result.ok = false;
  result.reason = "no settings row or dialog";
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
  process.exit(1);
}

// 2. hide the first hideable entry and confirm it leaves the list
const target = rows.find((row) => row.hideable && row.checked);
check("hiddenTarget", target?.label ?? null);
if (target !== undefined) {
  await page.evaluate((label) => {
    const dialogs = [...document.querySelectorAll('div[role="dialog"]')];
    const own = dialogs.find((dialog) => dialog.querySelectorAll('input[type="checkbox"]').length > 0);
    const input = [...own.querySelectorAll('input[type="checkbox"]')].find(
      (candidate) => candidate.getAttribute("aria-label") === label,
    );
    input.click();
  }, target.label);
  await wait(900);
}
const afterHide = await listSnapshot();
check("removedAfterHide", target !== undefined && !afterHide.includes(target.label));

// 3. move the last row up and confirm the dialog order changed
const beforeMove = (await dialogRows()).map((row) => row.label);
await page.evaluate(() => {
  const dialogs = [...document.querySelectorAll('div[role="dialog"]')];
  const own = dialogs.find((dialog) => dialog.querySelectorAll('input[type="checkbox"]').length > 0);
  const items = [...own.querySelectorAll("li")];
  const last = items.at(-1);
  const arrow = [...last.querySelectorAll("button")].find((button) =>
    ["上移", "Move up"].includes(button.getAttribute("aria-label") ?? ""),
  );
  arrow?.click();
});
await wait(900);
const afterMove = (await dialogRows()).map((row) => row.label);
check("orderBeforeMove", beforeMove);
check("orderAfterMove", afterMove);
check("orderChanged", JSON.stringify(beforeMove) !== JSON.stringify(afterMove));
await page.screenshot({ path: `${out}/3-hidden-and-moved.png` });

// 4. close, reload, confirm both changes survive
await page.keyboard.press("Escape");
await wait(600);
const storedBeforeReload = await stored();
check("storedBeforeReload", storedBeforeReload);
await page.reload({ waitUntil: "networkidle2", timeout: 120000 });
await wait(4000);
const afterReload = await listSnapshot();
check("removedAfterReload", target !== undefined && !afterReload.includes(target.label));
await page.screenshot({ path: `${out}/4-after-reload.png` });

// 5. restore defaults: the removed entry returns and storage is cleared
await clickByLabel(SETTINGS_LABELS);
await wait(1000);
const resetClicked = await page.evaluate((wanted) => {
  const button = [...document.querySelectorAll("button")].find((candidate) =>
    wanted.includes(candidate.textContent?.trim() ?? ""),
  );
  if (button === undefined) return false;
  button.click();
  return true;
}, RESET_LABELS);
check("resetClicked", resetClicked);
await wait(900);
await page.keyboard.press("Escape");
await wait(600);
const afterReset = await listSnapshot();
check("allBackAfterReset", before.every((label) => afterReset.includes(label)));
result.stored = await stored();
check("storageCleared", result.stored === null || /"order":\[\]/.test(result.stored));
result.problems = problems;
check("problemsEmpty", problems.length === 0);
result.ok = Boolean(
  opened &&
    problems.length === 0 &&
    result.checks.removedAfterHide &&
    result.checks.orderChanged &&
    result.checks.removedAfterReload &&
    result.checks.allBackAfterReset,
);
await page.screenshot({ path: `${out}/5-after-reset.png` });
console.log(JSON.stringify(result, null, 2));
await browser.close();
process.exit(result.ok ? 0 : 1);
