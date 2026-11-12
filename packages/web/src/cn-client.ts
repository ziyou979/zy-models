// zy-models client additions.
//
// 1. "仅国内平台" filter. Rows carry data-cn="1" | "0". The choice is kept in
//    localStorage so it follows the user across pages; until the user has made
//    a choice, a page whose checkbox carries data-cn-default (the home page)
//    starts with the filter on.
// 2. /plans platform filter (select[data-plan-provider] → tr[data-provider]).
// 3. CNY price details: hover on mouse devices (CSS), click / tap anywhere
//    (toggles .open), Esc or an outside click closes.
const KEY = "zy-models:cn-only";

function refreshEmpty() {
  const cnOnly = document.documentElement.hasAttribute("data-cn-only");
  for (const section of document.querySelectorAll<HTMLElement>(".table-section")) {
    const rows = Array.from(section.querySelectorAll<HTMLTableRowElement>("tbody tr[data-cn]"));
    if (rows.length === 0) continue;
    const visible = rows.filter((row) => !row.hidden && (!cnOnly || row.dataset.cn === "1")).length;
    section.toggleAttribute("data-empty", visible === 0);
  }
}

function apply(on: boolean) {
  document.documentElement.toggleAttribute("data-cn-only", on);
  for (const box of document.querySelectorAll<HTMLInputElement>("input[data-cn-filter]")) box.checked = on;
  refreshEmpty();
}

let stored: string | null = null;
try {
  stored = localStorage.getItem(KEY);
} catch {}
const pageDefault = document.querySelector("input[data-cn-filter][data-cn-default]") !== null;
apply(stored === null ? pageDefault : stored === "1");

document.addEventListener("change", (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement && target.hasAttribute("data-cn-filter")) {
    try {
      localStorage.setItem(KEY, target.checked ? "1" : "0");
    } catch {}
    apply(target.checked);
    return;
  }
  if (target instanceof HTMLSelectElement && target.hasAttribute("data-plan-provider")) {
    const value = target.value;
    for (const row of document.querySelectorAll<HTMLTableRowElement>("tbody tr[data-provider]")) {
      row.hidden = value !== "" && row.dataset.provider !== value;
    }
    refreshEmpty();
  }
});

// ---------------------------------------------------------------- CNY details
function closeAll(except?: Element) {
  for (const open of document.querySelectorAll(".cny-detail.open")) {
    if (open === except) continue;
    open.classList.remove("open");
    open.querySelector(".cny-toggle")?.setAttribute("aria-expanded", "false");
  }
}

document.addEventListener("click", (event) => {
  const target = event.target as Element | null;
  const clamp = target?.closest?.(".plan-clamp");
  if (clamp) {
    const open = clamp.classList.toggle("expanded");
    clamp.setAttribute("aria-expanded", String(open));
    const more = clamp.querySelector(".plan-clamp-more");
    if (more) more.textContent = open ? "收起" : "展开";
    return;
  }
  const toggle = target?.closest?.(".cny-toggle");
  if (toggle) {
    const detail = toggle.closest(".cny-detail")!;
    closeAll(detail);
    const open = detail.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(open));
    if (open) {
      // Open towards the side with room.
      const rect = detail.getBoundingClientRect();
      detail.classList.toggle("pop-left", rect.left < 340);
    }
    return;
  }
  if (!target?.closest?.(".cny-pop")) closeAll();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeAll();
});
