import { z } from "zod";
import type { CreateMarkerPayload, UpdateMarkerPayload } from "@/types";

const TIME_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

/**
 * Optional ₹ amount. A `type=number` input registered with `valueAsNumber`
 * yields `NaN` when left blank, which `z.number()` rejects and would silently
 * block submit. Coerce blank/NaN to `undefined` so empty stays optional.
 */
const optionalAmount = z.preprocess(
    (v) => (v === "" || v === null || (typeof v === "number" && Number.isNaN(v)) ? undefined : v),
    z.number().min(0).optional()
);

// Canonical marker categories — must mirror VALID_MARKER_CATEGORIES in backend/v2/models/marker.py.
// NOTE: "Landmark" is NOT in the backend enum (legacy data exists); do not add it until backend is updated.
export const MARKER_CATEGORIES = [
    "Restaurants", "Cafes", "Activities", "Shops", "Stays", "Touristy", "Quest", "Others",
] as const;

export const markerFormSchema = z.object({
    title: z.string().min(1, "Title is required").max(300),
    categories: z.array(z.string()).max(3, "Select up to 3 categories").default([]),
    sub_categories: z.array(z.string()).default([]),
    description: z.string().max(2000).optional().or(z.literal("")),
    address: z.string().max(500).optional().or(z.literal("")),
    contact: z.string().max(100).optional().or(z.literal("")),
    website_url: z.string().url("Must be a valid URL").max(500).optional().or(z.literal("")),
    map_url: z.string().url("Must be a valid URL").max(500).optional().or(z.literal("")),
    things_to_do_text: z.string().max(2000).optional().or(z.literal("")),
    things_to_do_image_url: z.string().optional().or(z.literal("")),
    tags: z.array(z.string().max(100)).max(20).default([]),
    media: z.array(z.string()).default([]),
    min_expense: optionalAmount,
    max_expense: optionalAmount,
    opens_at: z.string().regex(TIME_RE, "Use HH:MM (24h)").optional().or(z.literal("")),
    closes_at: z.string().regex(TIME_RE, "Use HH:MM (24h)").optional().or(z.literal("")),
    region_id: z.string().optional().or(z.literal("")),
    longitude: z.number({ required_error: "Pick a location on the map" }).min(-180).max(180),
    latitude: z.number({ required_error: "Pick a location on the map" }).min(-90).max(90),
});

export type MarkerFormData = z.infer<typeof markerFormSchema>;

const clean = <T extends Record<string, unknown>>(o: T): Partial<T> =>
    Object.fromEntries(Object.entries(o).filter(([, v]) => v !== "" && v !== undefined)) as Partial<T>;

export function toCreatePayload(d: MarkerFormData): CreateMarkerPayload {
    return {
        ...clean({
            title: d.title, description: d.description, address: d.address,
            contact: d.contact, website_url: d.website_url, map_url: d.map_url,
            things_to_do_text: d.things_to_do_text, things_to_do_image_url: d.things_to_do_image_url,
            min_expense: d.min_expense, max_expense: d.max_expense, region_id: d.region_id,
            opens_at: d.opens_at, closes_at: d.closes_at,
        }),
        title: d.title,
        location: { type: "Point", coordinates: [d.longitude, d.latitude] },
        categories: d.categories.length > 0 ? d.categories : undefined,
        sub_categories: d.sub_categories.length > 0 ? d.sub_categories : undefined,
        tags: d.tags,
        media: d.media,
    } as CreateMarkerPayload;
}

export function toUpdatePayload(d: MarkerFormData): UpdateMarkerPayload {
    // location is immutable on PUT; region_id IS editable — always send it (the form
    // is prefilled from the marker), where an empty string clears the region.
    const { longitude: _lng, latitude: _lat, region_id, ...rest } = d;
    return {
        ...clean(rest),
        title: d.title,
        tags: d.tags,
        media: d.media,
        region_id: region_id ?? "",
    } as UpdateMarkerPayload;
}
