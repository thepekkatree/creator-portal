// User & Auth Types

/**
 * Staff roles that may access the creator portal regardless of is_creator.
 * Backend has no "creator" role value — creator access is the `is_creator`
 * boolean (set at provisioning); these roles are the staff override.
 */
export const ALLOWED_CREATOR_ROLES = ["admin", "super_admin"] as const;

export interface User {
    _id: string;
    first_name: string;
    last_name: string;
    contact_id?: string;
    security_id?: string;
    profile_id?: string;
    role: Array<"user" | "admin" | "super_admin" | "creator" | "moderator" | "finance">;
    status: "active" | "suspended" | "deleted";
    is_creator: boolean;
    email?: string; // returned by /auth/verify (to_self_dict)
    profile_image?: { url?: string; public_id?: string } | null;
    points_earned?: number; // returned by /auth/verify (to_self_dict)
    created_at: string;
    updated_at: string;
}

/**
 * Backend role shape is inconsistent: V2 `/auth/verify` may return `role` as a
 * single string (e.g. "admin") OR an array. The portal assumes an array
 * (`user.role.some(...)`). Coerce here at the boundary so every consumer is safe.
 */
export function normalizeUser<T extends { role?: unknown } | null | undefined>(user: T): T {
    if (!user || typeof user !== "object") return user;
    const raw = (user as { role?: unknown }).role;
    const role = Array.isArray(raw) ? raw : raw === null || raw === undefined ? [] : [raw];
    return { ...(user as object), role } as T;
}

export type CreatorAccessDenialReason = "not_creator" | "no_profile" | "suspended" | "rejected";

export interface CreatorAccessResult {
    allowed: boolean;
    reason?: CreatorAccessDenialReason;
}

/**
 * Decide whether a user may enter the creator portal.
 *
 * Per V2 backend contract:
 *  - Staff (admin/super_admin) always pass.
 *  - A creator must have `is_creator === true` AND a provisioned `creators`
 *    record (GET /creators/me 200) with `status === "active"`.
 *  - `is_verified` is a trust BADGE only — it never gates login (unverified
 *    active creators are allowed in to build drafts).
 *  - suspended/rejected creators, and is_creator-without-record, are blocked.
 */
export function evaluateCreatorAccess(
    user: { role?: unknown; is_creator?: boolean } | null | undefined,
    creator: { status?: string } | null | undefined
): CreatorAccessResult {
    if (!user) return { allowed: false, reason: "not_creator" };

    const roles = Array.isArray(user.role) ? user.role : user.role ? [user.role] : [];
    const isStaff = roles.some((r) => (ALLOWED_CREATOR_ROLES as readonly unknown[]).includes(r));
    if (isStaff) return { allowed: true };

    if (!user.is_creator) return { allowed: false, reason: "not_creator" };
    if (!creator) return { allowed: false, reason: "no_profile" };
    if (creator.status === "suspended") return { allowed: false, reason: "suspended" };
    if (creator.status === "rejected") return { allowed: false, reason: "rejected" };
    return { allowed: true };
}

/** Boolean convenience wrapper around {@link evaluateCreatorAccess}. */
export function canAccessCreatorPortal(
    user: { role?: unknown; is_creator?: boolean } | null | undefined,
    creator: { status?: string } | null | undefined
): boolean {
    return evaluateCreatorAccess(user, creator).allowed;
}

export interface UserProfile {
    _id: string;
    bio?: string;
    profile_image?: CloudinaryAsset;
    points_earned: number;
    referral_code?: string;
}

/** Self-chosen display badge on a creator profile (free-form dict in V2). */
export interface CreatorBadge {
    label?: string;
    color?: string;
    icon?: string;
    [key: string]: unknown;
}

/**
 * V2 creator profile. `GET /creators/me` returns the *enriched* dict (creator
 * fields + merged user identity); `PUT /creators/me` returns the public dict.
 * Most fields are optional so both shapes type-check.
 *
 * Note: `status` is the operational lifecycle (active|suspended|rejected) — NOT
 * "approved"/"pending" (that lives on creator_applications). `is_verified` is a
 * trust BADGE only: per the V2 backend (`submit_quest` checks ownership +
 * `quests:edit`, never verification), any ACTIVE creator may submit quests for
 * review regardless of verification, so the UI must never gate submission on it.
 */
export interface Creator {
    id: string;
    _id?: string;
    user_id: string;
    status: "active" | "suspended" | "rejected";
    is_verified: boolean;
    verified_at?: string | null;
    verification_source?: "auto" | "manual" | null;
    tagline?: string | null;
    creator_bio?: string | null;
    creator_badge?: CreatorBadge | null;
    total_quests?: number;
    total_earnings?: number;
    pending_payouts?: number;
    travelers_served?: number;
    rating?: number | null;
    top_themes?: string[] | null;
    review_count?: number;
    quest_ids?: string[];
    stats_last_updated?: string | null;
    payout_account_id?: string | null;
    source_application_id?: string | null;
    verification_documents?: string[];
    // Identity fields merged in by the enriched dict (to_enriched_dict)
    name?: string | null;
    avatar_url?: string | null;
    hobbies?: string[];
    first_name?: string;
    last_name?: string;
    email?: string;
    profile_image?: CloudinaryAsset | { url?: string } | null;
    created_at?: string;
    updated_at?: string;
}

/** Onboarding checklist from `GET /creators/me/onboarding-status`. */
export interface CreatorOnboarding {
    profile_complete: boolean;
    payout_account_set: boolean;
    first_quest_created: boolean;
    is_verified: boolean;
}

/** Payload for `PUT /creators/me`. */
export interface UpdateCreatorProfilePayload {
    tagline?: string;
    creator_bio?: string;
    creator_badge?: CreatorBadge | null;
}

export interface AuthTokens {
    access_token: string;
    refresh_token: string;
    token_type: "bearer";
    user_id: string;
    expires_in?: number;
}

// Cloudinary Types
export interface CloudinaryAsset {
    public_id: string;
    secure_url: string;
    version?: number;
    format?: string;
    resource_type?: string;
    width?: number;
    height?: number;
    alt_text?: string;
    is_thumbnail?: boolean;
}

export interface CloudinaryUploadResponse {
    public_id: string;
    secure_url: string;
    url: string;
    format: string;
    resource_type: string;
    width: number;
    height: number;
    bytes: number;
    created_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// GeoJSON helpers (V2 stores GeoJSON-shaped location data)
// ─────────────────────────────────────────────────────────────────────────────

/** GeoJSON Point — coordinates are [lng, lat]. */
export interface GeoPoint {
    type: "Point";
    coordinates: [number, number];
}

export interface GeoPolygon {
    type: "Polygon";
    coordinates: number[][][];
}

export interface GeoLineString {
    type: "LineString";
    coordinates: number[][];
}

// ─────────────────────────────────────────────────────────────────────────────
// Pagination (V2 returns FLAT pagination on every list endpoint:
//   { success, <key>: [...], total, page, page_size, total_pages }
// There is no nested `pagination` object and no has_next/has_prev.)
// ─────────────────────────────────────────────────────────────────────────────

export interface Pagination {
    total: number;
    page: number;
    page_size: number;
    total_pages: number;
}

/** Normalized list result produced at the service boundary. */
export interface Paginated<T> extends Pagination {
    items: T[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Quest Types (V2)
//
// A quest has THREE distinct serialized shapes depending on the endpoint:
//   - QuestListItem : list endpoints (Quest.to_list_dict + region_name)
//   - Quest         : create/update/submit/retract result (Quest.to_public_dict)
//   - QuestDetail   : GET /quests/{id} enriched detail (Quest.to_detail_response)
// ─────────────────────────────────────────────────────────────────────────────

/** lowercase, as stored/validated by the backend (VALID_DIFFICULTIES). */
export type QuestDifficulty = "easy" | "moderate" | "hard" | "expert";

/** Title-Case, as stored/validated by the backend (VALID_QUEST_STATUSES). */
export type QuestStatus =
    | "Draft"
    | "Under Review"
    | "Changes Requested"
    | "Published"
    | "Rejected"
    | "Paused"
    | "Archived";

/**
 * Theme enum values accepted by the create/update payload. The backend
 * normalizes any case/spacing to a lowercase underscore form on write and
 * returns Title-Case strings on read, so response `theme` is typed `string[]`.
 */
export type QuestTheme =
    | "adventure"
    | "romance"
    | "culture"
    | "food"
    | "history"
    | "nature"
    | "spiritual"
    | "photography"
    | "archaeological"
    | "offbeat"
    | "finding_yourself"
    | "other";

/** A marker reference inside a quest's playlist (Quest.to_public_dict). */
export interface QuestPlaylistItem {
    marker_id: string | null;
    suggested_order: number | null;
    is_required: boolean | null;
    custom_description: string | null;
    things_to_do_text?: string | null;
    things_to_do_image_url?: string | null;
}

/** Stripped list view — `Quest.to_list_dict()` plus `region_name`. */
export interface QuestListItem {
    id: string;
    title: string | null;
    description: string | null;
    theme: string[] | null;
    difficulty: QuestDifficulty | null;
    price: number;
    currency: string;
    points: number;
    duration_minutes: number | null;
    region_id: string | null;
    region_name?: string | null;
    status: QuestStatus;
    view_count: number;
    average_rating: number | null;
    total_markers: number;
    completion_count: number;
    review_count: number;
    cloudinary_assets: CloudinaryAsset[] | null;
    created_at: string | null;
}

/**
 * Full owner/admin view — `Quest.to_public_dict()`. This is the shape returned
 * by create/update/submit/retract and is the one to prefill the edit wizard
 * (it carries the raw `marker_playlist` and `region_id`).
 */
export interface Quest {
    id: string;
    title: string | null;
    description: string | null;
    theme: string[] | null;
    keywords: string[] | null;
    difficulty: QuestDifficulty | null;
    price: number;
    currency: string;
    points: number;
    duration_minutes: number | null;
    hints_allowed: number | null;
    min_expense: number | null;
    max_expense: number | null;
    best_month_start: string | null;
    best_month_end: string | null;
    marker_playlist: QuestPlaylistItem[];
    suggested_route_geometry: GeoLineString | null;
    cloudinary_assets: CloudinaryAsset[] | null;
    reel_urls: string[] | null;
    region_id: string | null;
    review_id: string | null;
    status: QuestStatus;
    view_count: number;
    average_rating: number | null;
    total_markers: number;
    completion_count: number;
    review_count: number;
    start_time: string | null;
    linked_achievement_id: string | null;
    created_at: string | null;
    updated_at: string | null;
}

export interface QuestCreatorSummary {
    id: string;
    name: string | null;
    avatar_url: string | null;
    tagline: string | null;
    creator_badge: CreatorBadge | null;
}

export interface QuestRegionSummary {
    id: string;
    name: string | null;
    crowd_meter: Record<string, number> | null;
}

export interface QuestStartPoint {
    marker_id: string;
    name: string | null;
    lat: number | null;
    lng: number | null;
}

/**
 * Marker as it appears inside an enriched quest detail. When the caller has not
 * booked the quest this is the *teaser* shape: `coordinates` is null,
 * `images_blurred` is true, `is_unlocked` is false. Booked/staff callers get the
 * full shape with real `coordinates` and `map_url`.
 */
export interface QuestMarkerSummary {
    marker_id: string;
    name: string | null;
    categories?: string[];
    sub_categories?: string[];
    tags: string[];
    images: string[];
    images_blurred?: boolean;
    things_to_do_text: string | null;
    things_to_do_image_url: string | null;
    order: number | null;
    is_required: boolean | null;
    is_unlocked: boolean;
    map_url?: string | null;
    coordinates: { lat: number | null; lng: number | null } | null;
}

export interface QuestLinkedAchievement {
    id: string;
    name: string | null;
    icon_url: string | null;
    xp_reward: number | null;
}

export type QuestBookingStatus = "not_booked" | "active" | "completed" | string;

/** Enriched detail — `Quest.to_detail_response()` (GET /quests/{id}). */
export interface QuestDetail {
    id: string;
    title: string | null;
    description: string | null;
    theme: string[] | null;
    keywords: string[] | null;
    difficulty: QuestDifficulty | null;
    price: number;
    currency: string;
    points: number;
    duration_minutes: number | null;
    hints_allowed: number | null;
    min_expense: number | null;
    max_expense: number | null;
    best_month_start: string | null;
    best_month_end: string | null;
    start_time: string | null;
    status: QuestStatus;
    view_count: number;
    average_rating: number | null;
    review_count: number;
    completion_count: number;
    total_markers: number;
    cloudinary_assets: CloudinaryAsset[];
    reel_urls: string[];
    creator_summary: QuestCreatorSummary | Record<string, never>;
    region_summary: QuestRegionSummary | Record<string, never>;
    start_point: QuestStartPoint | null;
    marker_summaries: QuestMarkerSummary[];
    linked_achievement: QuestLinkedAchievement | null;
    user_booking_status: QuestBookingStatus;
    location: { route_waypoints: unknown[] };
    created_at: string | null;
    updated_at: string | null;
}

/** Cloudinary asset as accepted by the create payload (backend: List[Dict[str,str]]). */
export type QuestAssetInput = Record<string, string>;

/** Inline new-marker definition used inside a playlist item on create/update. */
export interface InlineMarkerInput {
    title: string;
    location: GeoPoint;
    categories?: string[];
    sub_categories?: string[];
    description?: string;
    address?: string;
}

/** One entry of the create/update `marker_playlist`: existing OR inline-new. */
export interface PlaylistItemInput {
    marker_id?: string;
    new_marker?: InlineMarkerInput;
    suggested_order?: number;
    is_required?: boolean;
    custom_description?: string;
    things_to_do_text?: string;
    things_to_do_image_url?: string;
}

/** Body for `POST /quests` (CreateQuestBody). */
export interface CreateQuestPayload {
    title: string;
    description?: string;
    theme?: QuestTheme[];
    keywords?: string[];
    difficulty?: QuestDifficulty;
    price?: number;
    currency?: string;
    points?: number;
    duration_minutes?: number;
    hints_allowed?: number;
    min_expense?: number;
    max_expense?: number;
    best_month_start?: string;
    best_month_end?: string;
    /** Recommended start time, 24-hour "HH:MM". */
    start_time?: string;
    marker_playlist?: PlaylistItemInput[];
    cloudinary_assets?: QuestAssetInput[];
    reel_urls?: string[];
    region_id: string;
    /** when true the quest is created directly in "Under Review". */
    submit?: boolean;
}

/** Body for `PUT /quests/{id}` (UpdateQuestBody) — region_id/submit are not editable. */
export type UpdateQuestPayload = Partial<Omit<CreateQuestPayload, "region_id" | "submit">>;

// ─────────────────────────────────────────────────────────────────────────────
// Marker Types (V2)
// ─────────────────────────────────────────────────────────────────────────────

export type MarkerStatus = "approved" | "pending" | "rejected";
export type MarkerSource = "creator_created" | "user_submitted" | "admin_created" | "imported";

export interface MarkerCenterDistance {
    region_id: string | null;
    center: number[] | null;
    walk_distance_m: number | null;
    walk_duration_s: number | null;
    drive_distance_m: number | null;
    drive_duration_s: number | null;
    computed_at: string | null;
}

/** `Marker.to_public_dict()`. Note: `media` is a list of URL strings. */
export interface Marker {
    id: string;
    location: GeoPoint;
    title: string;
    categories: string[];
    sub_categories: string[];
    description: string | null;
    media: string[] | null;
    tags: string[] | null;
    opens_at: string | null;
    closes_at: string | null;
    address: string | null;
    map_url: string | null;
    min_expense: number | null;
    max_expense: number | null;
    website_url: string | null;
    contact: string | null;
    things_to_do_text: string | null;
    things_to_do_image_url: string | null;
    region_id: string | null;
    hidden: boolean;
    status: MarkerStatus;
    source: MarkerSource | null;
    created_by: string | null;
    usage_count: number;
    center_distance: MarkerCenterDistance | null;
    /** present only on the teaser shape returned by the booking-gated detail. */
    is_locked?: boolean;
    created_at: string | null;
    updated_at: string | null;
}

/** Body for `POST /markers` (CreateMarkerBody). */
export interface CreateMarkerPayload {
    title: string;
    location: GeoPoint;
    categories?: string[];
    sub_categories?: string[];
    description?: string;
    address?: string;
    map_url?: string;
    website_url?: string;
    contact?: string;
    things_to_do_text?: string;
    things_to_do_image_url?: string;
    tags?: string[];
    media?: string[];
    min_expense?: number;
    max_expense?: number;
    /** ISO-8601 time string — e.g. "09:00" or "09:00:00". */
    opens_at?: string;
    /** ISO-8601 time string — e.g. "21:00" or "21:00:00". */
    closes_at?: string;
    region_id?: string;
    properties?: Record<string, unknown>;
    hidden?: boolean;
    /** Proceed even if a marker exists within 20m (distinct place at the same spot). */
    confirm_nearby?: boolean;
}

/** Body for `PUT /markers/{id}` (UpdateMarkerBody) — location is immutable; region_id
 * is editable (empty string clears it on the backend). */
export type UpdateMarkerPayload = Partial<Omit<CreateMarkerPayload, "location">> & {
    status?: MarkerStatus;
};

// ─────────────────────────────────────────────────────────────────────────────
// Task Config Types (V2) — serialized via to_dict(): the raw doc uses `_id`,
// normalized to `id` at the service boundary.
// ─────────────────────────────────────────────────────────────────────────────

export type TaskType = "photo_challenge" | "qr_scan" | "quiz" | "collection" | "social" | "checkin";

export interface TaskConfig {
    id: string;
    task_type: TaskType;
    title: string;
    description: string | null;
    marker_id: string;
    quest_id: string | null;
    photo_requirements: Record<string, unknown> | null;
    qr_data: Record<string, unknown> | null;
    quiz_data: Record<string, unknown> | null;
    game_config: Record<string, unknown> | null;
    collection_items: unknown[] | null;
    social_task: Record<string, unknown> | null;
    hints: Array<Record<string, unknown>> | null;
    base_points: number;
    is_active: boolean;
    created_by: string | null;
    created_at: string | null;
    updated_at: string | null;
}

/** Body for `POST /tasks` (CreateTaskBody). */
export interface CreateTaskConfigPayload {
    task_type: TaskType;
    title: string;
    description?: string;
    marker_id: string;
    quest_id?: string;
    photo_requirements?: Record<string, unknown>;
    qr_data?: Record<string, unknown>;
    quiz_data?: Record<string, unknown>;
    game_config?: Record<string, unknown>;
    collection_items?: unknown[];
    social_task?: Record<string, unknown>;
    hints?: Array<Record<string, unknown>>;
    base_points?: number;
    is_active?: boolean;
}

/** Body for `PUT /tasks/{id}` (UpdateTaskBody) — task_type/marker_id immutable. */
export type UpdateTaskConfigPayload = Partial<
    Omit<CreateTaskConfigPayload, "task_type" | "marker_id" | "quest_id">
>;

// ─────────────────────────────────────────────────────────────────────────────
// Step Reward Types (V2) — serialized via to_dict(): raw doc uses `_id`,
// normalized to `id` at the service boundary.
// ─────────────────────────────────────────────────────────────────────────────

export type RewardContextType =
    | "quest_completion"
    | "marker_visit"
    | "task_completion"
    | "streak_bonus";

export type BonusOperator = "gte" | "lte" | "eq" | "in";

export interface BonusCondition {
    field: string;
    operator: BonusOperator;
    value: unknown;
    bonus_points: number;
}

export interface StepReward {
    id: string;
    context_type: RewardContextType;
    context_id: string;
    base_points: number;
    bonus_conditions: BonusCondition[] | null;
    unlocked_badges: string[] | null;
    unlocked_content: string[] | null;
    created_by: string | null;
    created_at: string | null;
    updated_at: string | null;
}

/** Body for `POST /rewards` (CreateRewardBody). */
export interface CreateStepRewardPayload {
    context_type: RewardContextType;
    context_id: string;
    base_points: number;
    bonus_conditions?: BonusCondition[];
    unlocked_badges?: string[];
    unlocked_content?: string[];
}

/** Body for `PUT /rewards/{id}` (UpdateRewardBody). */
export type UpdateStepRewardPayload = Partial<
    Omit<CreateStepRewardPayload, "context_type" | "context_id">
>;

// ─────────────────────────────────────────────────────────────────────────────
// Region Types (V2)
// ─────────────────────────────────────────────────────────────────────────────

export type RegionType = "city" | "hotspot";

/** `Region.to_public_dict()` (GET /regions/{id}). */
export interface Region {
    id: string;
    name: string;
    slug: string;
    type: RegionType;
    parent_id: string | null;
    description: string | null;
    bbox: GeoPolygon | null;
    center_point: GeoPoint | null;
    mapbox_place_id: string | null;
    quest_ids: string[];
    marker_count: number;
    admin_weight: number;
    crowd_meter: Record<string, number>;
    is_active: boolean;
    created_at: string | null;
    updated_at: string | null;
}

/** `Region.to_list_dict()` (GET /regions, GET /regions/search). */
export interface RegionListItem {
    id: string;
    name: string;
    slug: string;
    type: RegionType;
    parent_id: string | null;
    marker_count: number;
    admin_weight: number;
    is_active: boolean;
}

/**
 * Body for `POST /regions/resolve-or-create` (ResolveOrCreateBody). Creators use
 * this during quest building to resolve a Mapbox feature into a region they can
 * attach a quest to (no direct region edit/delete).
 */
export interface ResolveOrCreateRegionPayload {
    mapbox_id: string;
    name: string;
    feature_type: string;
    full_address?: string;
    bbox?: unknown;
    center?: unknown;
    context?: Record<string, unknown>;
}

/** A region this candidate exactly matches or geographically overlaps. */
export interface RegionMatchRef {
    id: string;
    name: string | null;
    type: RegionType;
}

/**
 * One result from `GET /regions/mapbox-search` — a Mapbox v6 place annotated by
 * the backend with how it maps onto SeekKrr regions. The dropdown reuses
 * `existing_region` when present and otherwise POSTs `resolve_payload` (the
 * backend dedupes by overlap underneath).
 */
export interface MapboxRegionCandidate {
    mapbox_id: string;
    name: string;
    full_address: string | null;
    place_formatted: string | null;
    feature_type: string;
    suggested_type: RegionType;
    /** [lng, lat] */
    center: [number, number];
    bbox: GeoPolygon | null;
    /** exact match by mapbox_place_id — reuse this region id directly. */
    existing_region: RegionMatchRef | null;
    /** same-type regions whose bbox already contains this point (likely covered). */
    overlaps: RegionMatchRef[];
    /** for hotspots, the enclosing city (from Mapbox context). */
    parent_city: { name: string | null; mapbox_id: string | null } | null;
    /**
     * Ready-to-POST body for `POST /regions/resolve-or-create`. Null for
     * candidates that are already existing SeekKrr regions (blended in by name,
     * or matched by id/overlap) — those reuse `existing_region` directly and
     * never resolve-or-create.
     */
    resolve_payload: ResolveOrCreateRegionPayload | null;
}

/** The region a creator settled on in the quest builder. */
export interface ResolvedRegion {
    /** Empty string while `pending_payload` is set (region not yet created). */
    region_id: string;
    name: string;
    type: RegionType;
    /** [lng, lat] — region center, used to seed the markers map. */
    center: [number, number];
    /**
     * Present when the creator picked a NEW region that doesn't exist on SeekKrr
     * yet. We DON'T create it on selection (that would spawn orphan regions from
     * mere dropdown clicks); instead we POST this to `resolve-or-create` only when
     * the creator clicks "Next" to proceed. Absent for already-existing regions.
     */
    pending_payload?: ResolveOrCreateRegionPayload;
}

// ─────────────────────────────────────────────────────────────────────────────
// Narrative Types (V2 attach model) — serialized via to_dict(): raw doc uses
// `_id`, normalized to `id` at the service boundary.
// ─────────────────────────────────────────────────────────────────────────────

export type NarrativeAttachType = "marker" | "quest" | "region";
export type NarrativeStatus = "draft" | "under_review" | "approved" | "rejected" | "archived";
export type NarrativeAudioStatus =
    | "pending"
    | "generating"
    | "ready"
    | "failed"
    | "quota_exceeded";
export type VoicePersona =
    | "historian_warm"
    | "mystery_whisper"
    | "energetic_guide"
    | "elder_storyteller"
    | "custom";

export interface Narrative {
    id: string;
    title: string;
    attach_type: NarrativeAttachType;
    attach_id: string;
    content: string | null;
    subtitle: string | null;
    trigger_location: GeoPoint | null;
    trigger_radius_m: number | null;
    voice_persona: VoicePersona | null;
    custom_voice_id: string | null;
    media: string[];
    is_mandatory: boolean;
    is_unlocked: boolean;
    chain_id: string | null;
    sequence_order: number | null;
    status: NarrativeStatus;
    audio_url: string | null;
    audio_status: NarrativeAudioStatus;
    audio_duration_s?: number | null;
    reviewed_by: string | null;
    reviewed_at: string | null;
    review_note: string | null;
    view_count: number;
    created_by: string;
    created_at: string | null;
    updated_at: string | null;
    is_deleted?: boolean;
}

/** Body for `POST /narratives` (CreateNarrativeBody). */
export interface CreateNarrativePayload {
    title: string;
    attach_type: NarrativeAttachType;
    attach_id: string;
    content?: string;
    subtitle?: string;
    trigger_location?: GeoPoint;
    trigger_radius_m?: number;
    voice_persona?: VoicePersona;
    custom_voice_id?: string;
    media?: string[];
    is_mandatory?: boolean;
    is_unlocked?: boolean;
    chain_id?: string;
    sequence_order?: number;
    /** creators may only set draft/under_review; admins may set approved. */
    status?: "draft" | "under_review" | "approved";
    /** existing narrative id to chain the new one onto (resolves an attach conflict). */
    chain_with?: string;
}

/** Body for `PUT /narratives/{id}` (UpdateNarrativeBody) — attachment is immutable. */
export type UpdateNarrativePayload = Partial<
    Omit<CreateNarrativePayload, "attach_type" | "attach_id" | "status" | "chain_with">
>;

// One existing narrative chain attached to a target (marker/quest/region).
export interface NarrativeChainSummary {
    chain_id: string;
    // Human label for the chain (typically the first narrative's title).
    label: string;
    // First narrative in the chain — the "edit existing" navigation target.
    first_narrative_id: string;
    // Number of active narratives in this chain.
    count: number;
    // Highest sequence_order currently used in the chain.
    max_sequence_order: number;
    // Sequence order to use when appending the next narrative.
    next_sequence_order: number;
}

// A standalone (un-chained) active narrative on the target.
export interface NarrativeStandaloneSummary {
    id: string;
    title: string;
    status: NarrativeStatus;
    sequence_order: number | null;
}

/** Result of `GET /narratives/attach-summary` (drives the chain selector / conflict pre-check). */
export interface NarrativeAttachSummary {
    attach_type: NarrativeAttachType;
    attach_id: string;
    // Total active narratives on the target.
    active_count: number;
    // True when active_count > 0.
    has_conflict: boolean;
    // True when any active narrative already belongs to a chain.
    is_chain: boolean;
    // Existing chains attached to the target.
    chains: NarrativeChainSummary[];
    // Active narratives attached to the target with no chain.
    standalone: NarrativeStandaloneSummary[];
}

/** Result of `GET /narratives/{id}/audio-status`. */
export interface NarrativeAudioStatusResponse {
    narrative_id: string;
    audio_status: NarrativeAudioStatus | null;
    audio_url: string | null;
    audio_duration_s: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Payout Account Types (V2) — `PayoutAccount.to_safe_dict()` (PII-stripped).
// ─────────────────────────────────────────────────────────────────────────────

export type PayoutMethod = "bank_transfer" | "upi";
export type PayoutAccountStatus = "pending_verification" | "verified" | "rejected" | "disabled";

export interface PayoutBankDetailsSafe {
    account_number_masked: string | null;
    ifsc_code: string | null;
    bank_name: string | null;
}

export interface PayoutAccount {
    id: string;
    creator_id: string;
    method: PayoutMethod;
    status: PayoutAccountStatus;
    is_primary: boolean;
    currency: string;
    account_holder_name: string | null;
    bank_details: PayoutBankDetailsSafe | null;
    upi_id: string | null;
    verified_by: string | null;
    verified_at: string | null;
    rejection_reason: string | null;
    created_at: string | null;
    updated_at: string | null;
}

/** Raw bank details accepted on create/update (account_number is write-only). */
export interface PayoutBankDetailsInput {
    account_number?: string;
    ifsc_code?: string;
    bank_name?: string;
}

/** Body for `POST /payout-accounts` (CreatePayoutAccountBody). */
export interface CreatePayoutAccountPayload {
    method: string;
    currency: string;
    account_holder_name?: string;
    bank_details?: PayoutBankDetailsInput;
    upi_id?: string;
}

/** Body for `PUT /payout-accounts/{id}` (UpdatePayoutAccountBody). */
export type UpdatePayoutAccountPayload = Partial<Omit<CreatePayoutAccountPayload, "method">>;

// ─────────────────────────────────────────────────────────────────────────────
// Creator Analytics Types (V2) — `/creators/me/analytics/*`.
// ─────────────────────────────────────────────────────────────────────────────

export interface CreatorAnalyticsSummary {
    creator_id: string;
    total_quests: number;
    total_earnings: number;
    pending_payouts: number;
    rating: number | null;
    review_count: number;
    travelers_served: number;
}

export interface CreatorQuestBreakdownRow {
    quest_id: string;
    title: string | null;
    status: QuestStatus | string;
    average_rating: number | null;
    review_count: number;
    completions: number;
    total_earnings: number;
}

export type EarningsInterval = "daily" | "weekly" | "monthly";

export interface CreatorEarningsPoint {
    period: string;
    revenue: number;
    count: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic API envelope types
// ─────────────────────────────────────────────────────────────────────────────

export interface ApiResponse<T> {
    data: T;
    status: number;
    message?: string;
}

export interface ApiError {
    error: string;
    details?: string;
    status?: number;
}
