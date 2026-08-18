import {
    useState,
    useCallback,
    useMemo,
    useEffect,
    useRef,
    type DragEvent,
    type ReactNode,
} from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import {
    ChevronLeft,
    ChevronRight,
    Trash2,
    MapPin,
    GripVertical,
    Search,
    Plus,
    Sparkles,
    AlertTriangle,
    Loader2,
} from "lucide-react";
import { Button, Card, Input, InfoHint } from "@components/ui";
import { WaypointMapComponent, LocationSearch, type LocationSearchResult } from "@features/map";
import type { PlaylistPoint } from "@features/map";
import {
    markerPlaylistStepSchema,
    type MarkerPlaylistStepData,
    type MarkerPlaylistItemData,
} from "../schemas/quest.schema";
import { regionService } from "@services/region.service";
import { markerService } from "@services/marker.service";
import type { Marker, RegionType } from "@/types";
import { haversineMeters, pointInBboxRing, bboxBounds } from "@/utils/geo";
import { VideoWalkthroughModal, VideoHelpButton } from "@components/VideoWalkthroughModal";
import { WALKTHROUGH_VIDEOS } from "@config/walkthroughVideos";

/** Auto-reuse threshold (metres) — mirrors the backend's 20m inline-marker dedupe. */
const DEDUPE_RADIUS_M = 20;

interface WaypointsStepProps {
    defaultValues: Partial<MarkerPlaylistStepData> & {
        regionId?: string;
        regionName?: string;
        regionType?: RegionType;
        latitude?: number;
        longitude?: number;
    };
    onNext: (data: MarkerPlaylistStepData) => void;
    onBack: (data?: MarkerPlaylistStepData) => void;
    /** Switch the wizard's region (used by the "expand to city" banner). */
    onRegionChange?: (region: {
        regionId: string;
        regionName: string;
        regionType: RegionType;
    }) => void;
}

/** Field label with an inline "?" help hint, matching steps 1–2. */
function FieldLabel({
    children,
    hint,
}: {
    children: ReactNode;
    hint: ReactNode;
}) {
    return (
        <div className="flex items-center gap-1.5 mb-1.5">
            <span className="block text-sm font-medium text-neutral-700">{children}</span>
            <InfoHint text={hint} side="top" />
        </div>
    );
}

export function WaypointsStep({ defaultValues, onNext, onBack, onRegionChange }: WaypointsStepProps) {
    const regionId = defaultValues.regionId;

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
    const [reuseNote, setReuseNote] = useState<string | null>(null);
    const [search, setSearch] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const reuseTimerRef = useRef<ReturnType<typeof setTimeout>>();

    const {
        handleSubmit,
        watch,
        setValue,
        formState: { errors },
    } = useForm<MarkerPlaylistStepData>({
        resolver: zodResolver(markerPlaylistStepSchema),
        defaultValues: {
            markerPlaylist: defaultValues.markerPlaylist ?? [],
        },
    });

    const markerPlaylist = watch("markerPlaylist");

    // Read current playlist without adding it to callback deps.
    const getPlaylist = useCallback(() => watch("markerPlaylist") ?? [], [watch]);

    // ─── Region (bbox / center / parent) ─────────────────────────────────────
    // Only fetch when regionId is a real MongoDB ObjectId (24-char hex). This
    // prevents 404 spam when the draft was saved with a placeholder string like
    // "fake-region-id-manali" from a previous dev/test session.
    const isRealRegionId = !!regionId && /^[0-9a-f]{24}$/i.test(regionId);

    const { data: region } = useQuery({
        queryKey: ["region", regionId],
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        queryFn: () => regionService.getRegion(regionId!),
        enabled: isRealRegionId,
        staleTime: 5 * 60 * 1000,
    });

    const regionRing = region?.bbox?.coordinates?.[0];
    const bbox = useMemo(() => bboxBounds(regionRing), [regionRing]);

    const regionCenter = region?.center_point?.coordinates;
    const defaultCenter = useMemo(() => {
        if (regionCenter) return { lng: regionCenter[0], lat: regionCenter[1] };
        if (defaultValues.latitude !== null && defaultValues.latitude !== undefined && defaultValues.longitude !== null && defaultValues.longitude !== undefined) {
            return { lng: defaultValues.longitude, lat: defaultValues.latitude };
        }
        return { lng: 77.5946, lat: 12.9716 };
    }, [regionCenter, defaultValues.latitude, defaultValues.longitude]);

    // ─── Existing approved markers within the region bbox ────────────────────
    const { data: existingPage, isLoading: isLoadingMarkers } = useQuery({
        queryKey: ["region-markers", regionId, bbox],
        queryFn: () =>
            markerService.listMarkers({
                status: "approved",
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                min_lon: bbox!.min_lon,
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                min_lat: bbox!.min_lat,
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                max_lon: bbox!.max_lon,
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                max_lat: bbox!.max_lat,
                page_size: 100,
            }),
        // bbox is derived from region which only loads for real ObjectIds (F1 fix).
        enabled: !!bbox && isRealRegionId,
        staleTime: 60 * 1000,
    });
    const existingMarkers = useMemo(() => existingPage?.items ?? [], [existingPage]);

    // ─── Reuse-first search results (existing markers matching the query) ────
    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
        return () => clearTimeout(t);
    }, [search]);

    const { data: searchPage, isFetching: isSearching } = useQuery({
        queryKey: ["marker-search", regionId, bbox, debouncedSearch],
        queryFn: () =>
            markerService.listMarkers({
                status: "approved",
                search: debouncedSearch,
                ...(bbox
                    ? {
                          min_lon: bbox.min_lon,
                          min_lat: bbox.min_lat,
                          max_lon: bbox.max_lon,
                          max_lat: bbox.max_lat,
                      }
                    : {}),
                page_size: 8,
            }),
        enabled: debouncedSearch.length >= 2,
        staleTime: 30 * 1000,
    });
    const searchResults = searchPage?.items ?? [];

    // Ids already chosen — for hiding from the map + disabling in search results.
    const selectedMarkerIds = useMemo(
        () => markerPlaylist.map((it) => it.marker_id).filter((x): x is string => !!x),
        [markerPlaylist]
    );
    const selectedSet = useMemo(() => new Set(selectedMarkerIds), [selectedMarkerIds]);

    // Ordered pins for the map.
    const playlistPoints = useMemo<PlaylistPoint[]>(
        () =>
            markerPlaylist.flatMap((it) =>
                it._display
                    ? [{ lng: it._display.lng, lat: it._display.lat, title: it._display.title }]
                    : []
            ),
        [markerPlaylist]
    );

    const flashReuseNote = useCallback((msg: string) => {
        setReuseNote(msg);
        if (reuseTimerRef.current) clearTimeout(reuseTimerRef.current);
        reuseTimerRef.current = setTimeout(() => setReuseNote(null), 4000);
    }, []);
    useEffect(() => () => reuseTimerRef.current && clearTimeout(reuseTimerRef.current), []);

    // ─── Add: existing marker (reuse) ────────────────────────────────────────
    const addExistingMarker = useCallback(
        (marker: Marker) => {
            if (!marker.location?.coordinates) return;
            const current = getPlaylist();
            if (current.some((it) => it.marker_id === marker.id)) return; // already added
            const [lng, lat] = marker.location.coordinates;
            const item: MarkerPlaylistItemData = {
                marker_id: marker.id,
                is_required: true,
                // Seed Step 4 fields from the marker so Marker Details shows them prefilled.
                thingsToDo: marker.things_to_do_text ?? undefined,
                thingsToDoImage: marker.things_to_do_image_url
                    ? { public_id: "", secure_url: marker.things_to_do_image_url }
                    : undefined,
                _display: { title: marker.title ?? "Marker", lng, lat },
            };
            setValue("markerPlaylist", [...current, item], { shouldValidate: true });
        },
        [getPlaylist, setValue]
    );

    // ─── Add: NEW marker candidate (with 20m dedupe → auto-reuse) ────────────
    const addNewMarkerCandidate = useCallback(
        (lng: number, lat: number, title: string, categories?: string[], address?: string) => {
            const current = getPlaylist();

            // 20m dedupe against loaded existing markers (mirrors the backend).
            let nearest: { marker: Marker; dist: number } | null = null;
            for (const m of existingMarkers) {
                if (!m.location?.coordinates) continue;
                const dist = haversineMeters([lng, lat], m.location.coordinates);
                if (dist <= DEDUPE_RADIUS_M && (!nearest || dist < nearest.dist)) {
                    nearest = { marker: m, dist };
                }
            }

            if (nearest) {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                if (current.some((it) => it.marker_id === nearest!.marker.id)) {
                    flashReuseNote("That spot is already in your playlist.");
                    return;
                }
                const [mlng, mlat] = nearest.marker.location.coordinates;
                const item: MarkerPlaylistItemData = {
                    marker_id: nearest.marker.id,
                    is_required: true,
                    _display: { title: nearest.marker.title ?? "Marker", lng: mlng, lat: mlat },
                };
                setValue("markerPlaylist", [...current, item], { shouldValidate: true });
                flashReuseNote("Reused a nearby existing marker.");
                return;
            }

            const item: MarkerPlaylistItemData = {
                new_marker: {
                    title,
                    longitude: lng,
                    latitude: lat,
                    categories: categories || undefined,
                    address: address || undefined,
                },
                is_required: true,
                _display: { title, lng, lat },
            };
            setValue("markerPlaylist", [...current, item], { shouldValidate: true });
        },
        [existingMarkers, getPlaylist, setValue, flashReuseNote]
    );

    // Mapbox place picked in the secondary search → NEW marker candidate.
    const handlePlaceSelect = useCallback(
        (loc: LocationSearchResult) => {
            addNewMarkerCandidate(
                loc.longitude,
                loc.latitude,
                loc.place_name,
                loc.category ? [loc.category] : undefined,
                loc.address
            );
        },
        [addNewMarkerCandidate]
    );

    // Map click → NEW marker candidate (title from reverse geocode).
    const handleMapDropNew = useCallback(
        (lng: number, lat: number, title?: string, address?: string) => {
            addNewMarkerCandidate(lng, lat, title ?? `${lat.toFixed(4)}, ${lng.toFixed(4)}`, undefined, address);
        },
        [addNewMarkerCandidate]
    );

    // ─── Playlist item edits ─────────────────────────────────────────────────
    const removeItem = useCallback(
        (index: number) => {
            const current = getPlaylist();
            setValue(
                "markerPlaylist",
                current.filter((_, i) => i !== index),
                { shouldValidate: true }
            );
        },
        [getPlaylist, setValue]
    );

    const toggleRequired = useCallback(
        (index: number) => {
            const current = [...getPlaylist()];
            const item = current[index];
            if (!item) return;
            current[index] = { ...item, is_required: !item.is_required };
            setValue("markerPlaylist", current, { shouldValidate: true });
        },
        [getPlaylist, setValue]
    );

    const setCustomDescription = useCallback(
        (index: number, value: string) => {
            const current = [...getPlaylist()];
            const item = current[index];
            if (!item) return;
            current[index] = { ...item, custom_description: value };
            setValue("markerPlaylist", current, { shouldValidate: true });
        },
        [getPlaylist, setValue]
    );

    // Rename a NEW (inline) marker. Map clicks reverse-geocode to the nearest road,
    // so several new pins can land on the same generic name — let the creator fix it.
    const setNewMarkerTitle = useCallback(
        (index: number, value: string) => {
            const current = [...getPlaylist()];
            const item = current[index];
            if (!item || !item.new_marker) return;
            current[index] = {
                ...item,
                new_marker: { ...item.new_marker, title: value },
                _display: item._display ? { ...item._display, title: value } : item._display,
            };
            setValue("markerPlaylist", current, { shouldValidate: true });
        },
        [getPlaylist, setValue]
    );

    // ─── Drag-to-reorder (ported from the old waypoints step) ────────────────
    const handleDragStart = (e: DragEvent<HTMLDivElement>, index: number) => {
        setDraggedIndex(index);
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", index.toString());
        (e.target as HTMLElement).style.opacity = "0.5";
    };
    const handleDragEnd = (e: DragEvent<HTMLDivElement>) => {
        setDraggedIndex(null);
        setDragOverIndex(null);
        (e.target as HTMLElement).style.opacity = "1";
    };
    const handleDragOver = (e: DragEvent<HTMLDivElement>, index: number) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (draggedIndex !== index) setDragOverIndex(index);
    };
    const handleDragLeave = () => setDragOverIndex(null);
    const handleDrop = (e: DragEvent<HTMLDivElement>, targetIndex: number) => {
        e.preventDefault();
        const sourceIndex = parseInt(e.dataTransfer.getData("text/plain"), 10);
        if (sourceIndex !== targetIndex && !isNaN(sourceIndex)) {
            const next = [...markerPlaylist];
            const [dragged] = next.splice(sourceIndex, 1);
            if (dragged) {
                next.splice(targetIndex, 0, dragged);
                setValue("markerPlaylist", next, { shouldValidate: true });
            }
        }
        setDraggedIndex(null);
        setDragOverIndex(null);
    };

    // ─── Region conflict → expand to parent city ─────────────────────────────
    // Markers whose coords fall outside the current region bbox.
    const outOfRegion = useMemo(() => {
        if (!regionRing) return [];
        return playlistPoints.filter((p) => !pointInBboxRing([p.lng, p.lat], regionRing));
    }, [playlistPoints, regionRing]);

    const hasConflict = outOfRegion.length > 0;
    const canExpand = hasConflict && region?.type === "hotspot" && !!region?.parent_id;

    const { data: parentCity } = useQuery({
        queryKey: ["region", region?.parent_id],
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        queryFn: () => regionService.getRegion(region!.parent_id!),
        enabled: canExpand,
        staleTime: 5 * 60 * 1000,
    });

    const parentRing = parentCity?.bbox?.coordinates?.[0];
    const allFitParent = useMemo(() => {
        if (!parentRing) return false;
        return playlistPoints.every((p) => pointInBboxRing([p.lng, p.lat], parentRing));
    }, [playlistPoints, parentRing]);

    const handleExpandToCity = () => {
        if (!parentCity) return;
        onRegionChange?.({
            regionId: parentCity.id,
            regionName: parentCity.name,
            regionType: parentCity.type,
        });
    };

    const onSubmit = (data: MarkerPlaylistStepData) => {
        // Hard block: every marker must sit inside the region before proceeding
        // (the conflict banner is the only way out — expand, or fix the markers).
        if (hasConflict) return;
        onNext(data);
    };

    const itemKey = (item: MarkerPlaylistItemData, index: number) =>
        `${item.marker_id ?? "new"}-${item._display?.lng ?? 0}-${item._display?.lat ?? 0}-${index}`;

    return (
        <>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-xl font-semibold text-neutral-900 mb-1">
                            Build Your Marker Playlist
                        </h2>
                        <p className="text-neutral-600">
                            Reuse existing SeekKrr markers or drop new ones to define the stops on your quest.
                            <span className="mx-2 font-medium">Drag to reorder, right-click a pin to remove.</span>
                        </p>
                    </div>
                    <VideoHelpButton onClick={() => setIsModalOpen(true)} label="Watch walkthrough" />
                </div>

                {/* Region conflict banner — blocks "Next" until resolved (no dismiss). */}
                {hasConflict && (
                    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                        <div className="flex-1 text-sm">
                            {canExpand && allFitParent ? (
                                <>
                                    <p className="text-amber-900 font-medium">
                                        Some markers are outside {region?.name}.
                                    </p>
                                    <p className="text-amber-700 mt-0.5">
                                        They all fit within {parentCity?.name}. Expand this quest to the
                                        wider city so every marker is covered.
                                    </p>
                                    <div className="mt-3 flex gap-2">
                                        <Button type="button" size="sm" onClick={handleExpandToCity}>
                                            Expand to {parentCity?.name}
                                        </Button>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <p className="text-amber-900 font-medium">
                                        {outOfRegion.length} marker{outOfRegion.length !== 1 ? "s" : ""} fall{outOfRegion.length === 1 ? "s" : ""}
                                        outside {region?.name ?? "the selected region"}.
                                    </p>
                                    <p className="text-amber-700 mt-0.5">
                                        Go back to step 1 and widen the region, or remove the out-of-bounds
                                        markers, so the whole quest stays inside its region.
                                    </p>
                                </>
                            )}
                        </div>
                    </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    {/* Left Column - Search & Playlist (~42% on large screens) */}
                    <div className="lg:col-span-5 space-y-4">
                        {/* Reuse-first combined search */}
                        <div>
                            <FieldLabel hint="Type to find existing SeekKrr markers in this region to reuse. No match? Use the place search below to drop a brand-new marker. Reusing markers keeps quests connected and avoids duplicates.">
                                Find or add markers
                            </FieldLabel>
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400 pointer-events-none" />
                                <input
                                    type="text"
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    placeholder="Search existing markers…"
                                    className="w-full pl-9 pr-9 py-2.5 bg-white border border-neutral-300 rounded-lg text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-500 transition-colors"
                                    aria-label="Search existing markers"
                                />
                                {isSearching && (
                                    <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary-500 animate-spin" />
                                )}
                            </div>

                            {/* Existing-marker matches */}
                            {debouncedSearch.length >= 2 && (
                                <div className="mt-2 border border-neutral-200 rounded-lg overflow-hidden divide-y divide-neutral-100 max-h-56 overflow-y-auto">
                                    {searchResults.length > 0 ? (
                                        searchResults.map((m) => {
                                            const already = selectedSet.has(m.id);
                                            return (
                                                <button
                                                    key={m.id}
                                                    type="button"
                                                    disabled={already}
                                                    onClick={() => addExistingMarker(m)}
                                                    className="w-full flex items-start gap-2 px-3 py-2.5 text-left hover:bg-teal-50 focus:bg-teal-50 focus:outline-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    <MapPin className="w-4 h-4 text-teal-600 flex-shrink-0 mt-0.5" />
                                                    <div className="flex-1 min-w-0">
                                                        <span className="text-sm font-medium text-neutral-900 block truncate">
                                                            {m.title}
                                                        </span>
                                                        {(m.categories || m.address) && (
                                                            <p className="text-xs text-neutral-500 mt-1 line-clamp-1">
                                                                {[(m.categories && m.categories.length > 0) ? m.categories.join(", ") : undefined, m.address].filter(Boolean).join(" · ")}
                                                            </p>
                                                        )}
                                                    </div>
                                                    {already ? (
                                                        <span className="text-[10px] text-neutral-400 flex-shrink-0">
                                                            Added
                                                        </span>
                                                    ) : (
                                                        <Plus className="w-4 h-4 text-teal-600 flex-shrink-0" />
                                                    )}
                                                </button>
                                            );
                                        })
                                    ) : !isSearching ? (
                                        <p className="px-3 py-3 text-sm text-neutral-500">
                                            No existing markers match. Drop a new one below.
                                        </p>
                                    ) : null}
                                </div>
                            )}

                            {/* Secondary: Mapbox place → new marker */}
                            <div className="mt-3">
                                <p className="text-xs font-medium text-neutral-500 uppercase tracking-wide mb-1.5 flex items-center gap-1">
                                    <Sparkles className="w-3 h-3" /> Or drop a new marker
                                </p>
                                <LocationSearch
                                    onSelect={handlePlaceSelect}
                                    placeholder="Search a place to add as a new marker…"
                                    proximity={defaultCenter}
                                />
                            </div>
                        </div>

                        {/* Reuse note */}
                        {reuseNote && (
                            <div className="rounded-lg bg-teal-50 border border-teal-200 px-3 py-2 text-xs text-teal-800 flex items-center gap-1.5">
                                <Sparkles className="w-3.5 h-3.5" /> {reuseNote}
                            </div>
                        )}

                        {/* Playlist */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <label className="block text-sm font-medium text-neutral-700">
                                    Marker playlist
                                </label>
                                <span className="text-sm text-neutral-500">
                                    {markerPlaylist.length} marker{markerPlaylist.length !== 1 ? "s" : ""}
                                </span>
                            </div>

                            {markerPlaylist.length === 0 ? (
                                <Card padding="lg" className="text-center bg-primary-50 border-2 border-dashed border-primary-300">
                                    <div className="w-12 h-12 rounded-full bg-primary-100 flex items-center justify-center mx-auto mb-3">
                                        <MapPin className="w-6 h-6 text-primary-600" />
                                    </div>
                                    <p className="text-sm font-semibold text-neutral-800">No stops added yet</p>
                                    <p className="text-xs text-neutral-500 mt-1 max-w-[220px] mx-auto">
                                        {isLoadingMarkers
                                            ? "Loading markers in this region…"
                                            : "Add at least 2 stops to build the route. Search above or click the map."}
                                    </p>
                                    {!isLoadingMarkers && (
                                        <span className="inline-flex items-center gap-1 mt-3 text-xs font-medium text-accent-500 bg-white border border-accent-400 rounded-full px-3 py-1">
                                            <Plus className="w-3 h-3" /> Use the search or map to add stops
                                        </span>
                                    )}
                                </Card>
                            ) : (
                                <div className="space-y-2 max-h-[560px] overflow-y-auto pr-1">
                                    {markerPlaylist.map((item, index) => (
                                        <div
                                            key={itemKey(item, index)}
                                            draggable
                                            onDragStart={(e) => handleDragStart(e, index)}
                                            onDragEnd={handleDragEnd}
                                            onDragOver={(e) => handleDragOver(e, index)}
                                            onDragLeave={handleDragLeave}
                                            onDrop={(e) => handleDrop(e, index)}
                                            className={`group transition-all duration-200 ease-out ${
                                                dragOverIndex === index ? "transform scale-[1.02]" : ""
                                            } ${draggedIndex === index ? "opacity-50" : ""}`}
                                        >
                                            <Card
                                                padding="sm"
                                                className={`cursor-grab active:cursor-grabbing hover:shadow-md hover:border-primary-200 transition-all duration-150 ${
                                                    dragOverIndex === index ? "border-primary-400 bg-primary-50" : ""
                                                }`}
                                            >
                                                <div className="flex items-start gap-2">
                                                    <div className="flex-shrink-0 text-neutral-300 group-hover:text-neutral-500 transition-colors pt-1">
                                                        <GripVertical className="w-4 h-4" />
                                                    </div>
                                                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary-500 to-primary-700 text-white flex items-center justify-center text-sm font-bold flex-shrink-0 shadow-sm">
                                                        {index + 1}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        {/* Reused markers keep their existing name; NEW markers are
                                                            renamable inline (map clicks reverse-geocode to the nearest
                                                            road, which can collide across nearby pins). */}
                                                        {item.marker_id ? (
                                                            <p className="text-sm font-medium text-neutral-900 truncate" title={item._display?.title}>
                                                                {item._display?.title ?? `Marker ${index + 1}`}
                                                            </p>
                                                        ) : (
                                                            <input
                                                                value={item.new_marker?.title ?? item._display?.title ?? ""}
                                                                onChange={(e) => setNewMarkerTitle(index, e.target.value)}
                                                                onMouseDown={(e) => e.stopPropagation()}
                                                                placeholder="Name this stop"
                                                                className="w-full text-sm font-medium text-neutral-900 bg-transparent border-b border-dashed border-neutral-300 focus:border-primary-500 focus:outline-none py-0.5"
                                                            />
                                                        )}
                                                        <div className="flex items-center gap-2 mt-0.5">
                                                            <span
                                                                className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                                                                    item.marker_id
                                                                        ? "bg-teal-100 text-teal-700"
                                                                        : "bg-primary-100 text-primary-700"
                                                                }`}
                                                            >
                                                                {item.marker_id ? "Reused" : "New"}
                                                            </span>
                                                            {item._display && (
                                                                <span className="text-xs text-neutral-400 font-mono truncate">
                                                                    {item._display.lat.toFixed(4)},{" "}
                                                                    {item._display.lng.toFixed(4)}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => removeItem(index)}
                                                        className="p-1.5 text-neutral-300 hover:text-red-500 hover:bg-red-50 rounded-md transition-all opacity-0 group-hover:opacity-100"
                                                        aria-label={`Remove marker ${index + 1}`}
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </div>

                                                {/* Per-item controls */}
                                                <div className="mt-2 pl-9 space-y-2">
                                                    <Input
                                                        value={item.custom_description ?? ""}
                                                        onChange={(e) => setCustomDescription(index, e.target.value)}
                                                        placeholder="Custom note for this stop (optional)"
                                                        className="text-xs"
                                                    />
                                                    <label className="flex items-center gap-2 cursor-pointer select-none">
                                                        <input
                                                            type="checkbox"
                                                            checked={item.is_required}
                                                            onChange={() => toggleRequired(index)}
                                                            className="w-3.5 h-3.5 rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
                                                        />
                                                        <span className="text-xs text-neutral-600">
                                                            Required stop
                                                        </span>
                                                        <InfoHint
                                                            text="Required stops must be visited to complete the quest. Optional stops are bonus detours."
                                                            side="right"
                                                        />
                                                    </label>
                                                </div>
                                            </Card>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {errors.markerPlaylist && (
                                <p className="text-sm text-red-600 mt-2" role="alert">
                                    {errors.markerPlaylist.message ??
                                        errors.markerPlaylist.root?.message}
                                </p>
                            )}

                            {markerPlaylist.length > 0 && (
                                <p className="text-xs text-neutral-400 mt-2">
                                    Drag items to reorder your playlist
                                </p>
                            )}
                        </div>
                    </div>

                    {/* Right Column - Map (~58% on large screens) */}
                    <div className="lg:col-span-7">
                        <WaypointMapComponent
                            center={defaultCenter}
                            playlistPoints={playlistPoints}
                            existingMarkers={existingMarkers}
                            selectedMarkerIds={selectedMarkerIds}
                            onExistingMarkerClick={addExistingMarker}
                            onMapDropNew={handleMapDropNew}
                            onPlaylistPointRemove={removeItem}
                            regionBbox={region?.bbox ?? null}
                            height="560px"
                        />
                        {/* F7: only show zero-state hint when playlist is also empty, so it
                            disappears once the creator has added stops. */}
                        {!isLoadingMarkers && existingMarkers.length === 0 && markerPlaylist.length === 0 && (
                            <p className="mt-2 text-xs text-neutral-500">
                                No existing markers in {region?.name ?? "this region"} yet — click the map or
                                search a place to add the first ones.
                            </p>
                        )}
                    </div>
                </div>

                {/* Navigation */}
                <div className="flex justify-between pt-4">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => onBack({ markerPlaylist })}
                        leftIcon={<ChevronLeft className="w-4 h-4" />}
                    >
                        Back
                    </Button>
                    <Button
                        type="submit"
                        rightIcon={<ChevronRight className="w-4 h-4" />}
                        disabled={markerPlaylist.length < 2 || hasConflict}
                    >
                        Next
                    </Button>
                </div>
            </form>

            <VideoWalkthroughModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                videoUrl={WALKTHROUGH_VIDEOS.WAYPOINTS}
                title="Marker Playlist Walkthrough"
            />
        </>
    );
}
