import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { X, Upload, Loader2, AlertTriangle, ExternalLink, MapPin } from "lucide-react";
import { Card, Button, Input, Textarea, InfoHint } from "@components/ui";
import { markerService } from "@services/marker.service";
import { ApiRequestError } from "@services/api";
import { cloudinaryService } from "@services/cloudinary.service";
import { MarkerMapPicker } from "./MarkerMapPicker";
import type { LngLat, ResolvedPlace } from "./MarkerMapPicker";
import { MarkerRegionSelect } from "./MarkerRegionSelect";
import { markerFormSchema, toCreatePayload, toUpdatePayload, MARKER_CATEGORIES } from "../schemas/marker.schema";
import type { MarkerFormData } from "../schemas/marker.schema";
import type { Marker, CreateMarkerPayload } from "@/types";

/** Details the backend returns with a 409 NEARBY_MARKER conflict. */
interface NearbyConflict {
    existing_marker_id: string;
    existing_title?: string;
    existing_category?: string;
    distance_m?: number;
}

/**
 * Normalize a stored time value to the `HH:MM` the form expects. The backend
 * persists opening/closing times as a full ISO datetime on the epoch date
 * (e.g. "1970-01-01T09:30:00"), but may also return a bare "09:30:00"/"09:30".
 * Extract just the time-of-day so edit-prefill matches the HH:MM field/regex.
 */
function toHHMM(v: string | null | undefined): string {
    if (!v) return "";
    const time = v.includes("T") ? (v.split("T")[1] ?? "") : v;
    return time.slice(0, 5);
}

/**
 * The Google Maps link for a pin. Mirrors the backend's fallback in
 * MarkerService.create_marker so what the creator sees before saving is exactly
 * what gets stored.
 */
function googleMapsUrl(lat: number, lng: number): string {
    return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

/**
 * Best-effort map from a Mapbox POI category to our marker category enum.
 * Mapbox returns free-form strings like "restaurant" / "coffee_shop" / "hotel";
 * anything we don't recognise is left for the creator to pick.
 */
function toMarkerCategory(mapboxCategory?: string): MarkerFormData["category"] | undefined {
    if (!mapboxCategory) return undefined;
    const c = mapboxCategory.toLowerCase();
    const match = (...needles: string[]) => needles.some((n) => c.includes(n));

    if (match("coffee", "cafe", "tea", "bakery")) return "Cafes";
    if (match("restaurant", "food", "bar", "pub", "dining", "eat")) return "Restaurants";
    if (match("hotel", "lodging", "motel", "hostel", "resort", "guest_house", "campground")) return "Stays";
    if (match("shop", "store", "retail", "mall", "market", "boutique")) return "Shops";
    if (match("museum", "monument", "historic", "landmark", "viewpoint", "tourist", "attraction", "temple", "church", "mosque", "fort", "palace")) return "Touristy";
    if (match("park", "trail", "sport", "gym", "entertainment", "cinema", "theme", "adventure", "climb", "zoo")) return "Activities";
    return undefined;
}

interface MarkerFormModalProps {
    open: boolean;
    mode: "create" | "edit";
    initial?: Marker;
    onClose: () => void;
    onSaved: (marker: Marker) => void;
}

/** Map a persisted Marker to the flat form shape for prefill. */
function markerToFormData(m: Marker): Partial<MarkerFormData> {
    return {
        title: m.title,
        // Legacy/unknown categories aren't in the canonical list — drop to empty so
        // the creator picks a valid one from the dropdown before saving.
        category: (MARKER_CATEGORIES as readonly string[]).includes(m.category ?? "")
            ? (m.category as MarkerFormData["category"])
            : "",
        description: m.description ?? "",
        address: m.address ?? "",
        contact: m.contact ?? "",
        website_url: m.website_url ?? "",
        map_url: m.map_url ?? "",
        things_to_do_text: m.things_to_do_text ?? "",
        things_to_do_image_url: m.things_to_do_image_url ?? "",
        tags: m.tags ?? [],
        media: m.media ?? [],
        min_expense: m.min_expense ?? undefined,
        max_expense: m.max_expense ?? undefined,
        opens_at: toHHMM(m.opens_at),
        closes_at: toHHMM(m.closes_at),
        region_id: m.region_id ?? "",
        longitude: m.location?.coordinates?.[0],
        latitude: m.location?.coordinates?.[1],
    };
}

const DEFAULT_VALUES: Partial<MarkerFormData> = {
    title: "",
    category: "",
    description: "",
    address: "",
    contact: "",
    website_url: "",
    map_url: "",
    things_to_do_text: "",
    things_to_do_image_url: "",
    tags: [],
    media: [],
    opens_at: "",
    closes_at: "",
    region_id: "",
};

export function MarkerFormModal({ open, mode, initial, onClose, onSaved }: MarkerFormModalProps) {
    const [tagInput, setTagInput] = useState("");
    const [uploadingMedia, setUploadingMedia] = useState(false);
    const [uploadingTtdImage, setUploadingTtdImage] = useState(false);
    const [hidden, setHidden] = useState<boolean>(initial?.hidden ?? false);
    // Nearby-marker conflict (409) awaiting the creator's confirm-or-cancel.
    const [nearbyConflict, setNearbyConflict] = useState<NearbyConflict | null>(null);
    const [pendingPayload, setPendingPayload] = useState<CreateMarkerPayload | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const ttdImageInputRef = useRef<HTMLInputElement>(null);

    // --- Smart default map center for Create mode (F14) ---
    // Priority: (1) most recent creator marker, (2) browser geolocation, (3) Bangalore fallback.
    const [geoCenter, setGeoCenter] = useState<LngLat | undefined>(undefined);

    // Fetch creator's own markers once per session to find a representative location.
    const { data: ownMarkersData } = useQuery({
        queryKey: ["markers", "mine", "map-default"],
        queryFn: () => markerService.listMarkers({ mine: true, page_size: 1 }),
        staleTime: 5 * 60_000,
        // Only run when in create mode and the modal is open
        enabled: mode === "create" && open,
    });

    // Derive the most recent marker's center (backend returns newest-first by default).
    const recentMarkerCenter: LngLat | undefined = (() => {
        const m = ownMarkersData?.items?.[0];
        const coords = m?.location?.coordinates;
        if (Array.isArray(coords) && coords.length === 2) {
            return { lng: coords[0] as number, lat: coords[1] as number };
        }
        return undefined;
    })();

    // Attempt browser geolocation once when modal opens in create mode and no
    // marker-based center is available yet.
    useEffect(() => {
        if (!open || mode !== "create" || recentMarkerCenter) return;
        if (!navigator.geolocation) return;
        let cancelled = false;
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                if (!cancelled) {
                    setGeoCenter({ lng: pos.coords.longitude, lat: pos.coords.latitude });
                }
            },
            () => { /* permission denied or unavailable — silently fall back */ },
            { timeout: 5000, maximumAge: 60_000 }
        );
        return () => { cancelled = true; };
    }, [open, mode, recentMarkerCenter]);

    // The effective default center passed to the map picker (create mode only).
    // Edit mode always centers on the existing marker's location (driven by `value`).
    const smartDefaultCenter: LngLat | undefined =
        mode === "create" ? (recentMarkerCenter ?? geoCenter) : undefined;

    const {
        register,
        handleSubmit,
        setValue,
        watch,
        reset,
        getValues,
        formState: { errors, isSubmitting, dirtyFields },
    } = useForm<MarkerFormData>({
        resolver: zodResolver(markerFormSchema),
        defaultValues: DEFAULT_VALUES,
    });

    // Lock background scroll while the modal is open (matches other portal
    // modals) so only the modal scrolls, not the page behind it.
    useEffect(() => {
        if (!open) return;
        const original = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => { document.body.style.overflow = original; };
    }, [open]);

    // Prefill when editing or reset when creating
    useEffect(() => {
        if (!open) return;
        if (mode === "edit" && initial) {
            reset({ ...DEFAULT_VALUES, ...markerToFormData(initial) });
            setHidden(initial.hidden ?? false);
        } else {
            reset(DEFAULT_VALUES);
            setHidden(false);
        }
        setTagInput("");
    }, [open, mode, initial, reset]);

    const longitude = watch("longitude");
    const latitude = watch("latitude");
    const mapUrl = watch("map_url");
    const tags = watch("tags");
    const media = watch("media");
    const thingsToDoImage = watch("things_to_do_image_url");
    const regionId = watch("region_id");

    /**
     * Move the pin → keep the location-derived fields in step with it.
     *
     * `map_url` is always rewritten from the new coordinates unless the creator
     * typed their own link (a hand-picked Google place URL is better than our
     * generated one, so we never clobber it).
     */
    const syncLocationFields = useCallback(
        (lng: number, lat: number) => {
            setValue("longitude", lng, { shouldValidate: true });
            setValue("latitude", lat, { shouldValidate: true });
            if (!dirtyFields.map_url) {
                setValue("map_url", googleMapsUrl(lat, lng), { shouldValidate: true });
            }
        },
        [setValue, dirtyFields.map_url]
    );

    /**
     * Mapbox told us what's under the pin — fill the blanks so the creator only
     * has to review, not retype. Anything they've already edited is left alone.
     */
    const handlePlace = useCallback(
        (place: ResolvedPlace) => {
            const filled: string[] = [];

            if (place.address && !dirtyFields.address) {
                setValue("address", place.address, { shouldValidate: true });
                filled.push("address");
            }
            if (place.place_name && !getValues("title")?.trim()) {
                setValue("title", place.place_name, { shouldValidate: true });
                filled.push("title");
            }
            const category = toMarkerCategory(place.category);
            if (category && !getValues("category")) {
                setValue("category", category, { shouldValidate: true });
                filled.push("category");
            }

            if (filled.length > 0) {
                toast.success(`Filled in ${filled.join(", ")} — edit anything that looks off.`);
            }
        },
        [setValue, getValues, dirtyFields.address]
    );

    const createMutation = useMutation({
        mutationFn: (payload: ReturnType<typeof toCreatePayload>) =>
            markerService.createMarker(payload),
    });

    const updateMutation = useMutation({
        mutationFn: ({ id, payload }: { id: string; payload: ReturnType<typeof toUpdatePayload> }) =>
            markerService.updateMarker(id, payload),
    });

    /**
     * Create a marker, surfacing the nearby-marker conflict as a confirm dialog
     * rather than a dead-end error. On a 409 NEARBY_MARKER we stash the payload
     * and the existing marker's details; "Create anyway" replays this with
     * confirm_nearby=true.
     */
    const doCreate = async (payload: CreateMarkerPayload) => {
        try {
            const marker = await createMutation.mutateAsync(payload);
            setNearbyConflict(null);
            setPendingPayload(null);
            toast.success("Marker created!");
            onSaved(marker);
            onClose();
        } catch (err) {
            if (
                err instanceof ApiRequestError &&
                err.status === 409 &&
                err.code === "NEARBY_MARKER" &&
                err.details?.existing_marker_id
            ) {
                const d = err.details;
                setNearbyConflict({
                    existing_marker_id: String(d.existing_marker_id),
                    existing_title: typeof d.existing_title === "string" ? d.existing_title : undefined,
                    existing_category: typeof d.existing_category === "string" ? d.existing_category : undefined,
                    distance_m: typeof d.distance_m === "number" ? d.distance_m : undefined,
                });
                setPendingPayload(payload);
                return; // handled by the confirm dialog — no error toast
            }
            toast.error(err instanceof Error ? err.message : "Failed to create marker");
        }
    };

    const confirmCreateAnyway = () => {
        if (!pendingPayload) return;
        void doCreate({ ...pendingPayload, confirm_nearby: true });
    };

    const onSubmit = async (data: MarkerFormData) => {
        if (mode === "create") {
            await doCreate({ ...toCreatePayload(data), hidden });
        } else {
            if (!initial?.id) return;
            try {
                const promise = updateMutation.mutateAsync({
                    id: initial.id,
                    payload: { ...toUpdatePayload(data), hidden },
                });
                toast.promise(promise, {
                    loading: "Saving marker…",
                    success: "Marker updated!",
                    error: "Failed to update marker",
                });
                const marker = await promise;
                onSaved(marker);
                onClose();
            } catch {
                // error handled by toast; keep modal open
            }
        }
    };

    const handleMediaUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        setUploadingMedia(true);
        try {
            const uploads = Array.from(files).map((file) =>
                cloudinaryService.uploadImage(file, { folder: "markers" })
            );
            const results = await Promise.all(uploads);
            const newUrls = results.map((r) => r.secure_url);
            setValue("media", [...(media ?? []), ...newUrls]);
        } catch (err) {
            // Surface what actually went wrong — a swallowed reason ("Failed to
            // upload image") leaves the creator with nothing to act on.
            toast.error(err instanceof Error ? err.message : "Failed to upload image");
        } finally {
            setUploadingMedia(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    const removeMedia = (url: string) => {
        setValue("media", (media ?? []).filter((u) => u !== url));
    };

    const handleThingsToDoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setUploadingTtdImage(true);
        try {
            const result = await cloudinaryService.uploadImage(file, { folder: "markers/things-to-do" });
            setValue("things_to_do_image_url", result.secure_url, { shouldValidate: true });
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to upload image");
        } finally {
            setUploadingTtdImage(false);
            if (ttdImageInputRef.current) ttdImageInputRef.current.value = "";
        }
    };

    const addTag = () => {
        const raw = tagInput.trim();
        if (!raw) return;
        const newTags = raw
            .split(",")
            .map((t) => t.trim())
            .filter((t) => t.length > 0 && !(tags ?? []).includes(t));
        if (newTags.length > 0) {
            setValue("tags", [...(tags ?? []), ...newTags]);
        }
        setTagInput("");
    };

    const removeTag = (tag: string) => {
        setValue("tags", (tags ?? []).filter((t) => t !== tag));
    };

    const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            addTag();
        }
    };

    if (!open) return null;

    const isBusy = isSubmitting || createMutation.isPending || updateMutation.isPending;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-neutral-900/60 backdrop-blur-sm animate-fade-in">
            <Card className="w-full max-w-3xl shadow-2xl border-neutral-200 overflow-hidden animate-scale-up max-h-[90vh] flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200 bg-white shrink-0">
                    <h2 className="text-xl font-bold text-neutral-900">
                        {mode === "create" ? "Create New Marker" : "Edit Marker"}
                    </h2>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors"
                        aria-label="Close modal"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex-1 flex flex-col min-h-0">
                    <div className="p-6 space-y-5 bg-neutral-50 overflow-y-auto flex-1">

                        {/* ── Section: Location ── */}
                        <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
                            <h3 className="text-sm font-semibold text-neutral-500 uppercase tracking-wider mb-3">
                                Location {mode === "create" && <span className="text-red-500">*</span>}
                            </h3>
                            {mode === "edit" && (
                                <p className="text-xs text-amber-600 mb-2 flex items-center gap-1">
                                    <AlertTriangle className="w-3 h-3" />
                                    Location cannot be changed after creation.
                                </p>
                            )}
                            <MarkerMapPicker
                                value={
                                    longitude !== undefined && latitude !== undefined
                                        ? { lng: longitude, lat: latitude }
                                        : null
                                }
                                onChange={({ lng, lat }) => syncLocationFields(lng, lat)}
                                onPlace={handlePlace}
                                defaultCenter={smartDefaultCenter}
                            />
                            {errors.longitude && (
                                <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
                                    <AlertTriangle className="w-3 h-3" /> {errors.longitude.message}
                                </p>
                            )}
                            {errors.latitude && !errors.longitude && (
                                <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
                                    <AlertTriangle className="w-3 h-3" /> {errors.latitude.message}
                                </p>
                            )}

                            <div className="mt-4">
                                <label className="block text-sm font-medium text-neutral-700 mb-1">
                                    Region
                                </label>
                                <MarkerRegionSelect
                                    value={regionId ?? ""}
                                    onChange={(id) => setValue("region_id", id, { shouldValidate: true })}
                                />
                                <p className="mt-1 text-xs text-neutral-400">
                                    Auto-detected from the pin. Search only to attach a different region.
                                </p>
                            </div>
                        </section>
                        
                        {/* ── Section: Basic Info ── */}
                        <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
                            <h3 className="text-sm font-semibold text-neutral-500 uppercase tracking-wider mb-3">
                                Basic Info
                            </h3>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-neutral-700 mb-1">
                                        Title <span className="text-red-500">*</span>
                                    </label>
                                    <Input
                                        {...register("title")}
                                        placeholder="e.g. Gateway of India"
                                        className={errors.title ? "border-red-400" : ""}
                                    />
                                    {errors.title && (
                                        <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
                                            <AlertTriangle className="w-3 h-3" /> {errors.title.message}
                                        </p>
                                    )}
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-neutral-700 mb-1">
                                        Category
                                    </label>
                                    <select
                                        {...register("category")}
                                        className="w-full px-4 py-2.5 bg-white border border-neutral-300 rounded-lg text-neutral-900 text-sm focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-500"
                                    >
                                        <option value="">Select a category…</option>
                                        {MARKER_CATEGORIES.map((c) => (
                                            <option key={c} value={c}>{c}</option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-neutral-700 mb-1">
                                        Description
                                    </label>
                                    <Textarea
                                        {...register("description")}
                                        placeholder="Brief description of this marker…"
                                        rows={3}
                                    />
                                </div>

                                <label className="flex items-center gap-2 text-sm text-neutral-700">
                                    <input
                                        type="checkbox"
                                        checked={hidden}
                                        onChange={(e) => setHidden(e.target.checked)}
                                        className="rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
                                    />
                                    Hidden (quest-only — not shown in public discovery)
                                </label>
                            </div>
                        </section>

                        {/* ── Section: Contact & URLs ── */}
                        <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
                            <h3 className="text-sm font-semibold text-neutral-500 uppercase tracking-wider mb-3">
                                Contact &amp; Links
                            </h3>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-neutral-700 mb-1">
                                        Address
                                        <InfoHint text="Filled in automatically from the map pin. Edit it freely — your text is kept and never overwritten once you change it." />
                                    </label>
                                    <Input {...register("address")} placeholder="Auto-filled from the map pin…" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-neutral-700 mb-1">
                                        Contact
                                    </label>
                                    <Input {...register("contact")} placeholder="Phone / email…" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-neutral-700 mb-1">
                                        Website URL
                                    </label>
                                    <Input
                                        {...register("website_url")}
                                        placeholder="https://example.com"
                                        className={errors.website_url ? "border-red-400" : ""}
                                    />
                                    {errors.website_url && (
                                        <p className="mt-1 text-xs text-red-600">{errors.website_url.message}</p>
                                    )}
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-neutral-700 mb-1">
                                        Map URL
                                        <InfoHint text="Generated from the map pin automatically. Open in Google Maps to check it, or paste your own Google Maps place link here — once you edit it we stop overwriting it." />
                                    </label>
                                    <div className="flex gap-2">
                                        <Input
                                            {...register("map_url")}
                                            placeholder="Auto-filled from the map pin…"
                                            className={`flex-1 ${errors.map_url ? "border-red-400" : ""}`}
                                        />
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            disabled={!mapUrl}
                                            onClick={() => {
                                                if (mapUrl) window.open(mapUrl, "_blank", "noopener,noreferrer");
                                            }}
                                            leftIcon={<ExternalLink className="w-4 h-4" />}
                                            title="Open this location in Google Maps"
                                        >
                                            Open
                                        </Button>
                                    </div>
                                    {errors.map_url && (
                                        <p className="mt-1 text-xs text-red-600">{errors.map_url.message}</p>
                                    )}
                                </div>
                            </div>
                        </section>

                        {/* ── Section: Things To Do ── */}
                        <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
                            <h3 className="text-sm font-semibold text-neutral-500 uppercase tracking-wider mb-3">
                                Things To Do
                            </h3>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-neutral-700 mb-1">
                                        Description
                                    </label>
                                    <Textarea
                                        {...register("things_to_do_text")}
                                        placeholder="What can visitors do here?"
                                        rows={2}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-neutral-700 mb-1">
                                        Image
                                    </label>
                                    <input
                                        ref={ttdImageInputRef}
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        onChange={handleThingsToDoUpload}
                                    />
                                    {thingsToDoImage ? (
                                        <div className="relative inline-block rounded-lg overflow-hidden border border-neutral-200">
                                            <img
                                                src={thingsToDoImage}
                                                alt="Things to do"
                                                className="h-32 w-auto object-cover"
                                            />
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    setValue("things_to_do_image_url", "", { shouldValidate: true })
                                                }
                                                className="absolute top-1 right-1 p-1 bg-black/60 text-white rounded-full hover:bg-black/80"
                                                aria-label="Remove image"
                                            >
                                                <X className="w-3 h-3" />
                                            </button>
                                        </div>
                                    ) : (
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() => ttdImageInputRef.current?.click()}
                                            isLoading={uploadingTtdImage}
                                            leftIcon={<Upload className="w-4 h-4" />}
                                            disabled={uploadingTtdImage}
                                        >
                                            {uploadingTtdImage ? "Uploading…" : "Upload Image"}
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </section>

                        {/* ── Section: Expenses & Hours ── */}
                        <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
                            <h3 className="text-sm font-semibold text-neutral-500 uppercase tracking-wider mb-3">
                                Expenses &amp; Hours
                            </h3>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-neutral-700 mb-1">
                                        Min Expense (₹)
                                    </label>
                                    <Input
                                        type="number"
                                        min={0}
                                        placeholder="0"
                                        {...register("min_expense", { valueAsNumber: true })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-neutral-700 mb-1">
                                        Max Expense (₹)
                                    </label>
                                    <Input
                                        type="number"
                                        min={0}
                                        placeholder="0"
                                        {...register("max_expense", { valueAsNumber: true })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-neutral-700 mb-1">
                                        Opens At
                                    </label>
                                    <Input
                                        {...register("opens_at")}
                                        placeholder="09:00"
                                        className={errors.opens_at ? "border-red-400" : ""}
                                    />
                                    {errors.opens_at && (
                                        <p className="mt-1 text-xs text-red-600">{errors.opens_at.message}</p>
                                    )}
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-neutral-700 mb-1">
                                        Closes At
                                    </label>
                                    <Input
                                        {...register("closes_at")}
                                        placeholder="21:00"
                                        className={errors.closes_at ? "border-red-400" : ""}
                                    />
                                    {errors.closes_at && (
                                        <p className="mt-1 text-xs text-red-600">{errors.closes_at.message}</p>
                                    )}
                                </div>
                            </div>
                        </section>

                        {/* ── Section: Tags ── */}
                        <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
                            <h3 className="text-sm font-semibold text-neutral-500 uppercase tracking-wider mb-3">
                                Tags
                            </h3>
                            <div className="flex gap-2">
                                <Input
                                    value={tagInput}
                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                                        setTagInput(e.target.value)
                                    }
                                    onKeyDown={handleTagKeyDown}
                                    placeholder="Type tag and press Enter or comma"
                                    className="flex-1"
                                />
                                <Button type="button" variant="outline" size="sm" onClick={addTag}>
                                    Add
                                </Button>
                            </div>
                            {tags && tags.length > 0 && (
                                <div className="flex flex-wrap gap-2 mt-2">
                                    {tags.map((tag) => (
                                        <span
                                            key={tag}
                                            className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-primary-50 text-primary-700 border border-primary-200 rounded-full text-xs font-medium"
                                        >
                                            {tag}
                                            <button
                                                type="button"
                                                onClick={() => removeTag(tag)}
                                                className="text-primary-400 hover:text-primary-700"
                                                aria-label={`Remove tag ${tag}`}
                                            >
                                                <X className="w-3 h-3" />
                                            </button>
                                        </span>
                                    ))}
                                </div>
                            )}
                        </section>

                        {/* ── Section: Media ── */}
                        <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
                            <h3 className="text-sm font-semibold text-neutral-500 uppercase tracking-wider mb-3">
                                Media
                            </h3>
                            <div className="space-y-3">
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/*"
                                    multiple
                                    className="hidden"
                                    onChange={handleMediaUpload}
                                />
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => fileInputRef.current?.click()}
                                    isLoading={uploadingMedia}
                                    leftIcon={<Upload className="w-4 h-4" />}
                                    disabled={uploadingMedia}
                                >
                                    {uploadingMedia ? "Uploading…" : "Upload Images"}
                                </Button>

                                {media && media.length > 0 && (
                                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                                        {media.map((url) => (
                                            <div key={url} className="relative group rounded-lg overflow-hidden aspect-square bg-neutral-100">
                                                <img
                                                    src={url}
                                                    alt="Marker media"
                                                    className="w-full h-full object-cover"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => removeMedia(url)}
                                                    className="absolute top-1 right-1 p-1 bg-black/60 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                                                    aria-label="Remove image"
                                                >
                                                    <X className="w-3 h-3" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </section>
                    </div>

                    {/* Footer */}
                    <div className="flex gap-3 px-6 py-4 border-t border-neutral-200 bg-neutral-50 shrink-0">
                        <Button
                            type="button"
                            variant="ghost"
                            fullWidth
                            onClick={onClose}
                            disabled={isBusy}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            variant="primary"
                            fullWidth
                            isLoading={isBusy}
                            disabled={isBusy}
                        >
                            {mode === "create" ? "Create Marker" : "Save Changes"}
                        </Button>
                    </div>
                </form>
            </Card>

            {/* Spinning overlay while uploading media */}
            {uploadingMedia && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center bg-neutral-900/30">
                    <Loader2 className="w-8 h-8 text-primary-600 animate-spin" />
                </div>
            )}

            {/* Nearby-marker confirmation — a marker already exists within 20m.
                Portaled to <body> so it escapes this modal's backdrop-blur
                containing block (otherwise a nested fixed element is trapped
                inside the scrollable parent and mispositions). */}
            {nearbyConflict && createPortal(
                <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-neutral-900/60 backdrop-blur-sm animate-fade-in">
                    <Card className="w-full max-w-md shadow-2xl overflow-hidden animate-scale-up">
                        <div className="p-6">
                            <div className="flex items-start gap-3">
                                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                                    <MapPin className="w-5 h-5 text-amber-600" />
                                </div>
                                <div className="flex-1">
                                    <h3 className="text-lg font-bold text-neutral-900">
                                        A marker already exists here
                                    </h3>
                                    <p className="mt-1 text-sm text-neutral-600">
                                        <span className="font-semibold text-neutral-900">
                                            {nearbyConflict.existing_title || "An existing marker"}
                                        </span>
                                        {nearbyConflict.existing_category ? ` (${nearbyConflict.existing_category})` : ""}
                                        {" is "}
                                        {nearbyConflict.distance_m !== undefined && nearbyConflict.distance_m !== null
                                            ? `~${nearbyConflict.distance_m}m`
                                            : "right"}
                                        {" away. If this is the same place, cancel and use the existing marker to avoid duplicates. Only create a new one if it's genuinely different (e.g. two shops in the same building)."}
                                    </p>
                                </div>
                            </div>

                            <div className="mt-5 space-y-2">
                                <Button
                                    type="button"
                                    variant="primary"
                                    fullWidth
                                    isLoading={createMutation.isPending}
                                    disabled={createMutation.isPending}
                                    onClick={confirmCreateAnyway}
                                >
                                    Yes, create a new marker
                                </Button>
                                <div className="flex gap-2">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        fullWidth
                                        disabled={createMutation.isPending}
                                        leftIcon={<ExternalLink className="w-4 h-4" />}
                                        onClick={() =>
                                            window.open(
                                                `/creator/markers/view/${nearbyConflict.existing_marker_id}`,
                                                "_blank",
                                                "noopener,noreferrer"
                                            )
                                        }
                                    >
                                        View existing
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        fullWidth
                                        disabled={createMutation.isPending}
                                        onClick={() => {
                                            setNearbyConflict(null);
                                            setPendingPayload(null);
                                        }}
                                    >
                                        Cancel
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </Card>
                </div>,
                document.body
            )}
        </div>
    );
}
