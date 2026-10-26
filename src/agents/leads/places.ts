import { fetchJson, type FetchFn } from "../../lib/http.js";

export type Place = {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  mapsUrl: string | null;
  rating: number | null;
  reviews: number | null;
  status: string | null;
  type: string | null;
};

type ApiPlace = {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  rating?: number;
  userRatingCount?: number;
  businessStatus?: string;
  primaryTypeDisplayName?: { text?: string };
};

const FIELDS = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.googleMapsUri",
  "places.rating",
  "places.userRatingCount",
  "places.businessStatus",
  "places.primaryTypeDisplayName",
].join(",");

/** Google Places API (New) Text Search, one page of up to 20 results. */
export async function searchPlaces(apiKey: string, textQuery: string, fetchFn: FetchFn = fetch): Promise<Place[]> {
  const data = await fetchJson<{ places?: ApiPlace[] }>(fetchFn, "https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": FIELDS },
    body: JSON.stringify({ textQuery, languageCode: "tr", regionCode: "TR", pageSize: 20 }),
  });
  return (data.places ?? []).map((place) => ({
    id: place.id,
    name: place.displayName?.text ?? "(isimsiz)",
    address: place.formattedAddress ?? null,
    phone: place.nationalPhoneNumber ?? null,
    website: place.websiteUri ?? null,
    mapsUrl: place.googleMapsUri ?? null,
    rating: place.rating ?? null,
    reviews: place.userRatingCount ?? null,
    status: place.businessStatus ?? null,
    type: place.primaryTypeDisplayName?.text ?? null,
  }));
}

type PageSpeed = { lighthouseResult?: { categories?: { performance?: { score?: number }; seo?: { score?: number } }; audits?: Record<string, { displayValue?: string }> } };

/** Mobile Lighthouse scores from the PageSpeed Insights API. */
export async function pageSpeedMobile(url: string, apiKey: string | undefined, fetchFn: FetchFn = fetch) {
  const params = new URLSearchParams({ url, strategy: "mobile" });
  params.append("category", "performance");
  params.append("category", "seo");
  if (apiKey) params.set("key", apiKey);
  const response = await fetchFn(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params}`, { signal: AbortSignal.timeout(90_000) });
  if (!response.ok) throw new Error(`PageSpeed HTTP ${response.status}`);
  const data = (await response.json()) as PageSpeed;
  const result = data.lighthouseResult;
  const pct = (value?: number) => (value == null ? null : Math.round(value * 100));
  return {
    performance: pct(result?.categories?.performance?.score),
    seo: pct(result?.categories?.seo?.score),
    lcp: result?.audits?.["largest-contentful-paint"]?.displayValue ?? null,
    cls: result?.audits?.["cumulative-layout-shift"]?.displayValue ?? null,
  };
}
