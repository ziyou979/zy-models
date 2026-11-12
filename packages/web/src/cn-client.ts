// zy-models: "仅国内平台" filter. Rows carry data-cn="1" | "0"; the choice is
// kept in localStorage so it follows the user across pages.
const KEY = "zy-models:cn-only";

function apply(on: boolean) {
  document.documentElement.toggleAttribute("data-cn-only", on);
  for (const box of document.querySelectorAll<HTMLInputElement>("input[data-cn-filter]")) box.checked = on;
  for (const section of document.querySelectorAll<HTMLElement>(".table-section")) {
    const rows = section.querySelectorAll("tbody tr[data-cn]");
    if (rows.length === 0) continue;
    const visible = on ? section.querySelectorAll('tbody tr[data-cn="1"]').length : rows.length;
    section.toggleAttribute("data-empty", visible === 0);
  }
}

let stored = false;
try {
  stored = localStorage.getItem(KEY) === "1";
} catch {}
apply(stored);

document.addEventListener("change", (event) => {
  const target = event.target as HTMLElement | null;
  if (!(target instanceof HTMLInputElement) || !target.hasAttribute("data-cn-filter")) return;
  try {
    localStorage.setItem(KEY, target.checked ? "1" : "0");
  } catch {}
  apply(target.checked);
});
