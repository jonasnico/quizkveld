/**
 * Filters the quiz cards that are already in the document.
 *
 * No framework and no data fetching: the server rendered every card, this script only
 * toggles `hidden` on them. That keeps the page fully usable without JavaScript, and means
 * filtering costs one pass over a few hundred DOM nodes.
 *
 * The chosen filters are mirrored into the query string so a filtered view can be
 * bookmarked or shared, and read back on load so those links work.
 */

type FilterName = "sted" | "ukedag" | "kategori";

const FILTER_NAMES: FilterName[] = ["sted", "ukedag", "kategori"];

const form = document.querySelector<HTMLFormElement>("[data-filters]");

if (form) {
  const status = form.querySelector<HTMLElement>("[data-filter-status]");
  const reset = form.querySelector<HTMLButtonElement>("[data-filter-reset]");
  const cards = Array.from(document.querySelectorAll<HTMLElement>("[data-quiz]"));

  const selects = new Map<FilterName, HTMLSelectElement>();
  for (const name of FILTER_NAMES) {
    const select = form.querySelector<HTMLSelectElement>(`[data-filter="${name}"]`);
    if (select) selects.set(name, select);
  }

  function currentFilters(): Record<FilterName, string> {
    return {
      sted: selects.get("sted")?.value ?? "",
      ukedag: selects.get("ukedag")?.value ?? "",
      kategori: selects.get("kategori")?.value ?? "",
    };
  }

  function matches(card: HTMLElement, filters: Record<FilterName, string>): boolean {
    if (filters.sted && card.dataset.sted !== filters.sted) return false;
    if (filters.ukedag && card.dataset.weekday !== filters.ukedag) return false;

    if (filters.kategori) {
      // `categoryNorm` is a list, so this is a "contains" test. An equality test would
      // hide the 23 quizzes that name more than one genre from every genre but their first.
      const categories = (card.dataset.categories ?? "").split(" ");
      if (!categories.includes(filters.kategori)) return false;
    }

    return true;
  }

  /** Hides day and place headings whose cards were all filtered away. */
  function pruneEmptySections(filtering: boolean): void {
    for (const list of document.querySelectorAll<HTMLElement>(".quiz-list")) {
      const visible = list.querySelectorAll("[data-quiz]:not([hidden])").length;
      const group = list.closest<HTMLElement>(".group, .fylke-block");
      if (group) group.hidden = visible === 0;
    }

    for (const block of document.querySelectorAll<HTMLElement>(".fylke-block")) {
      const visible = block.querySelectorAll(".group:not([hidden])").length;
      const own = block.querySelectorAll("[data-quiz]:not([hidden])").length;
      block.hidden = visible === 0 && own === 0;
    }

    for (const section of document.querySelectorAll<HTMLElement>("[data-day], [data-irregular]")) {
      const total = section.querySelectorAll("[data-quiz]").length;
      const visible = section.querySelectorAll("[data-quiz]:not([hidden])").length;
      const count = section.querySelector<HTMLElement>("[data-day-count]");
      if (count) {
        count.textContent = visible === 1 ? "1 quiz" : `${visible} quizer`;
      }
      const empty = section.querySelector<HTMLElement>(".empty");
      if (empty) empty.hidden = visible > 0 && empty.dataset.always !== "true";
      // A day heading over nothing is noise once the user has narrowed the view, but a day
      // that is genuinely empty in the data keeps its "ingen quizer" message.
      section.hidden = filtering && total > 0 && visible === 0;
    }
  }

  function syncUrl(filters: Record<FilterName, string>): void {
    const params = new URLSearchParams(window.location.search);
    for (const name of FILTER_NAMES) {
      const value = filters[name];
      if (value) {
        params.set(name, value);
      } else {
        params.delete(name);
      }
    }
    const query = params.toString();
    const url = query ? `${window.location.pathname}?${query}` : window.location.pathname;
    window.history.replaceState(null, "", url);
  }

  function apply(updateUrl = true): void {
    const filters = currentFilters();
    let visible = 0;

    for (const card of cards) {
      const show = matches(card, filters);
      card.hidden = !show;
      if (show) visible += 1;
    }

    const active = FILTER_NAMES.filter((name) => filters[name] !== "");

    pruneEmptySections(active.length > 0);

    if (status) {
      if (active.length === 0) {
        status.hidden = true;
        status.textContent = "";
      } else {
        status.hidden = false;
        status.textContent =
          visible === 0
            ? "Ingen quizer passer til filtrene. Prøv å fjerne ett av dem."
            : visible === 1
              ? "1 quiz passer til filtrene."
              : `${visible} quizer passer til filtrene.`;
      }
    }

    if (reset) reset.hidden = active.length === 0;
    if (updateUrl) syncUrl(filters);
  }

  // Restore state from the URL so shared links land on the same view.
  const params = new URLSearchParams(window.location.search);
  for (const name of FILTER_NAMES) {
    const value = params.get(name);
    const select = selects.get(name);
    if (!value || !select) continue;
    const exists = Array.from(select.options).some((option) => option.value === value);
    if (exists) select.value = value;
  }

  for (const select of selects.values()) {
    select.addEventListener("change", () => apply());
  }

  reset?.addEventListener("click", () => {
    for (const select of selects.values()) select.value = "";
    apply();
  });

  form.addEventListener("submit", (event) => event.preventDefault());

  apply(false);
}
