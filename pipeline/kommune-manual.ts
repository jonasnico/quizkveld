/**
 * Manual part of the kommune alias table.
 *
 * The source's "kommune" column is a place name typed by a volunteer, not a kommune. Most
 * values happen to be a kommune name and resolve automatically; the ones below are either
 * a locality inside a larger kommune (Greaaker is in Sarpsborg), or a kommune that ceased
 * to exist in the 2020 merger (Rygge is now part of Moss).
 *
 * This is reference data, not asserted facts about quizzes: Norwegian administrative
 * geography changes on a published schedule, roughly once a decade, and when it does the
 * change is loud and public. It is safe for us to own.
 *
 * Values are official kommune *names*, not numbers, so the numbers stay derived from the
 * committed Kartverket list and cannot drift out of sync with it.
 */
export const MANUAL_KOMMUNE_ALIASES: Record<string, string> = {
  // Localities inside a larger kommune.
  "Ålgård": "Gjesdal",
  "Årnes": "Nes",
  "Åsgårdstrand": "Horten",
  "Bjørkelangen": "Aurskog-Høland",
  "Bø i Telemark": "Midt-Telemark",
  "Bryne": "Time",
  "Drøbak": "Frogn",
  "Fagerstrand": "Nesodden",
  "Førde": "Sunnfjord",
  "Greåker": "Sarpsborg",
  "Hafrsfjord": "Stavanger",
  "Hønefoss": "Ringerike",
  "Hokksund": "Øvre Eiker",
  "Honningsvåg": "Nordkapp",
  "Hvittingfoss": "Kongsberg",
  "Jessheim": "Ullensaker",
  "Kirkenes": "Sør-Varanger",
  "Kolbotn": "Nordre Follo",
  "Kopervik": "Karmøy",
  "Langesund": "Bamble",
  "Lierbyen": "Lier",
  "Minnesund": "Eidsvoll",
  "Mo i Rana": "Rana",
  "Mosjøen": "Vefsn",
  "Nærbø": "Hå",
  "Otta": "Sel",
  "Rørvik": "Nærøysund",
  "Sigerfjord": "Sortland",
  "Skjærhalden": "Hvaler",
  "Slemmestad": "Asker",
  "Stathelle": "Bamble",
  "Vestfossen": "Øvre Eiker",
  "Vikersund": "Modum",

  // Kommuner dissolved in the 2020 reform. The old name is still what people say.
  "Egersund": "Eigersund",
  "Mandal": "Lindesnes",
  "Mjøndalen": "Drammen",
  "Rygge": "Moss",
  "Skjetten": "Lillestrøm",
  "Spydeberg": "Indre Østfold",
  "Stokke": "Sandefjord",

  // Svalbard is not a kommune and has no Kartverket geometry; it gets a synthetic entry.
  "Longyearbyen": "Svalbard",

  // Kartverket's fylke listing returns only the Sami name for this one.
  "Hamarøy": "Hábmer",
};

/**
 * Pre-2020 fylke names to their current counterpart.
 *
 * The source still uses the old names, so this is only ever used to sanity-check the alias
 * table: `fylkeNow` on a venue is derived from its kommune, which is authoritative. A
 * mismatch here is a warning, not an error - a few kommuner genuinely changed fylke in
 * ways the old name cannot predict (Jevnaker went Oppland -> Viken -> Akershus).
 */
export const LEGACY_FYLKE_TO_CURRENT: Record<string, string> = {
  Akershus: "Akershus",
  "Aust-Agder": "Agder",
  Buskerud: "Buskerud",
  Finnmark: "Finnmark",
  Hedmark: "Innlandet",
  Hordaland: "Vestland",
  "Møre og Romsdal": "Møre og Romsdal",
  "Nord-Trøndelag": "Trøndelag",
  Nordland: "Nordland",
  Oppland: "Innlandet",
  Oslo: "Oslo",
  Rogaland: "Rogaland",
  "Sogn og Fjordane": "Vestland",
  Svalbard: "Svalbard",
  "Sør-Trøndelag": "Trøndelag",
  Telemark: "Telemark",
  Troms: "Troms",
  "Troms og Finnmark": "Troms",
  "Vest-Agder": "Agder",
  Vestfold: "Vestfold",
  "Vestfold og Telemark": "Vestfold",
  Viken: "Akershus",
  Østfold: "Østfold",
};

/**
 * Places where the source's old fylke name legitimately disagrees with the kommune's
 * current fylke, so the cross-check stays quiet about them.
 */
export const KNOWN_FYLKE_MOVES: Record<string, string> = {
  Jevnaker: "Flyttet fra Oppland via Viken til Akershus.",
};

/**
 * Source place names that are known to be unresolvable, with the reason. Listing them
 * explicitly keeps them out of the "needs investigating" bucket on every run.
 */
export const KNOWN_UNRESOLVED: Record<string, string> = {
  Sandnesseter:
    "Finnes ikke i Kartverkets stedsnavnregister, heller ikke i Akershus som kilden oppgir. Trolig en skrivefeil hos kilden - ma rettes hos Norges Quizforbund.",
};
