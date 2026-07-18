import { useState, type ReactNode } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
    ArrowLeft,
    Edit2,
    MapPin,
    Tag,
    Clock,
    Globe,
    Phone,
    Banknote,
    Lock,
    ImageOff,
} from "lucide-react";
import { Card, Button, Badge } from "@components/ui";
import { markerService } from "@services/marker.service";
import { MapComponent } from "@features/map/components/MapComponent";
import { MarkerFormModal } from "../components/MarkerFormModal";
import type { Marker } from "@/types";

function InfoRow({
    icon,
    label,
    value,
}: {
    icon: ReactNode;
    label: string;
    value: string | null | undefined;
}) {
    if (!value) return null;
    return (
        <div className="flex items-start gap-3 py-3 border-b border-neutral-100 last:border-b-0">
            <span className="flex-shrink-0 mt-0.5 text-neutral-400">{icon}</span>
            <div className="min-w-0">
                <p className="text-xs font-medium text-neutral-400 uppercase tracking-wider">{label}</p>
                <p className="text-sm text-neutral-700 mt-0.5 break-words">{value}</p>
            </div>
        </div>
    );
}

export function MarkerDetailPage() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const queryClient = useQueryClient();

    const [isEditModalOpen, setIsEditModalOpen] = useState(false);

    const { data: marker, isLoading, error } = useQuery({
        queryKey: ["marker", id],
        queryFn: () => {
            if (!id) throw new Error("No marker id");
            return markerService.getMarker(id);
        },
        enabled: !!id,
    });

    const handleSaved = (updated: Marker) => {
        queryClient.setQueryData(["marker", id], updated);
        queryClient.invalidateQueries({ queryKey: ["creator-markers"] });
        setIsEditModalOpen(false);
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    if (error || !marker) {
        return (
            <div className="max-w-3xl mx-auto px-4 py-12 text-center">
                <p className="text-neutral-500 mb-4">Marker not found or failed to load.</p>
                <Button variant="outline" onClick={() => navigate("/creator/markers")}>
                    Back to My Markers
                </Button>
            </div>
        );
    }

    const lng = marker.location?.coordinates?.[0];
    const lat = marker.location?.coordinates?.[1];
    const hasLocation = lng !== undefined && lat !== undefined;

    return (
        <div className="animate-fade-in w-full max-w-4xl mx-auto pb-10 px-4 sm:px-6 lg:px-8 space-y-6">
            {/* Top bar */}
            <div className="flex items-center justify-between gap-4 pt-4">
                <button
                    onClick={() => navigate("/creator/markers")}
                    className="inline-flex items-center gap-2 text-sm font-medium text-neutral-500 hover:text-neutral-900 transition-colors"
                >
                    <ArrowLeft className="w-4 h-4" />
                    Back to My Markers
                </button>
                <Button
                    variant="outline"
                    size="sm"
                    leftIcon={<Edit2 className="w-4 h-4" />}
                    onClick={() => setIsEditModalOpen(true)}
                    disabled={!!marker.is_locked}
                >
                    Edit
                </Button>
            </div>

            {/* Title + Status */}
            <Card className="p-6">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                            <Badge status={marker.status === "pending" ? "under_review" : marker.status as "approved" | "rejected"}>
                                {marker.status}
                            </Badge>
                            {marker.hidden && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-neutral-100 text-neutral-600 border border-neutral-200">
                                    Hidden
                                </span>
                            )}
                            {marker.is_locked && (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider bg-neutral-100 text-neutral-500 border border-neutral-200">
                                    <Lock className="w-3 h-3" /> Locked
                                </span>
                            )}
                        </div>
                        <h1 className="text-2xl font-display font-bold text-primary-900 tracking-tight mt-1">{marker.title}</h1>
                        {marker.category && (
                            <p className="text-sm text-neutral-500 mt-1">{marker.category}</p>
                        )}
                    </div>
                    <div className="text-xs text-neutral-400 flex-shrink-0 sm:text-right">
                        {marker.created_at && (
                            <p>Created {new Date(marker.created_at).toLocaleDateString()}</p>
                        )}
                        {marker.updated_at && (
                            <p>Updated {new Date(marker.updated_at).toLocaleDateString()}</p>
                        )}
                    </div>
                </div>

                {marker.description && (
                    <p className="mt-4 text-sm text-neutral-600 leading-relaxed">{marker.description}</p>
                )}
            </Card>

            {/* Map */}
            {hasLocation && !marker.is_locked ? (
                <Card className="overflow-hidden p-0">
                    <div className="px-6 py-4 border-b border-neutral-100">
                        <h2 className="text-sm font-semibold text-neutral-700 flex items-center gap-2">
                            <MapPin className="w-4 h-4 text-primary-500" /> Location
                        </h2>
                    </div>
                    <MapComponent
                        center={{ lng, lat }}
                        zoom={15}
                        markers={[{
                            longitude: lng,
                            latitude: lat,
                            place_name: marker.title,
                            address: marker.address ?? undefined,
                        }]}
                        interactive={true}
                        height="320px"
                        preview={true}
                    />
                    <div className="px-6 py-3 text-xs text-neutral-400">
                        {lat.toFixed(5)}, {lng.toFixed(5)}
                    </div>
                </Card>
            ) : (
                // Defensive guard: is_locked is unreachable for owner views; retained for teaser shape.
                <Card className="p-6 text-center text-neutral-400">
                    <Lock className="w-6 h-6 mx-auto mb-2" />
                    <p className="text-sm">Location is locked for this marker.</p>
                </Card>
            )}

            {/* Details */}
            <Card className="p-6">
                <h2 className="text-sm font-semibold text-neutral-700 mb-2">Details</h2>
                <div className="divide-y divide-neutral-100">
                    <InfoRow icon={<MapPin className="w-4 h-4" />} label="Address" value={marker.address} />
                    <InfoRow icon={<Phone className="w-4 h-4" />} label="Contact" value={marker.contact} />
                    <InfoRow icon={<Globe className="w-4 h-4" />} label="Website" value={marker.website_url} />
                    <InfoRow icon={<Globe className="w-4 h-4" />} label="Map URL" value={marker.map_url} />
                    <InfoRow
                        icon={<Clock className="w-4 h-4" />}
                        label="Hours"
                        value={
                            marker.opens_at || marker.closes_at
                                ? `${marker.opens_at ?? "?"} – ${marker.closes_at ?? "?"}`
                                : null
                        }
                    />
                    <InfoRow
                        icon={<Banknote className="w-4 h-4" />}
                        label="Expense"
                        value={
                            marker.min_expense !== null || marker.max_expense !== null
                                ? `₹${marker.min_expense ?? 0} – ₹${marker.max_expense ?? "?"}`
                                : null
                        }
                    />
                </div>
            </Card>

            {/* Things To Do */}
            {(marker.things_to_do_text || marker.things_to_do_image_url) && (
                <Card className="p-6">
                    <h2 className="text-sm font-semibold text-neutral-700 mb-3">Things To Do</h2>
                    {marker.things_to_do_text && (
                        <p className="text-sm text-neutral-600 leading-relaxed mb-3">
                            {marker.things_to_do_text}
                        </p>
                    )}
                    {marker.things_to_do_image_url && (
                        <img
                            src={marker.things_to_do_image_url}
                            alt="Things to do"
                            className="rounded-lg w-full max-h-60 object-cover"
                        />
                    )}
                </Card>
            )}

            {/* Tags */}
            {marker.tags && marker.tags.length > 0 && (
                <Card className="p-6">
                    <h2 className="text-sm font-semibold text-neutral-700 mb-3 flex items-center gap-2">
                        <Tag className="w-4 h-4 text-primary-500" /> Tags
                    </h2>
                    <div className="flex flex-wrap gap-2">
                        {marker.tags.map((tag) => (
                            <span
                                key={tag}
                                className="px-2.5 py-0.5 bg-primary-50 text-primary-700 border border-primary-200 rounded-full text-xs font-medium"
                            >
                                {tag}
                            </span>
                        ))}
                    </div>
                </Card>
            )}

            {/* Media Gallery */}
            {marker.media && marker.media.length > 0 ? (
                <Card className="p-6">
                    <h2 className="text-sm font-semibold text-neutral-700 mb-3">Media</h2>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                        {marker.media.map((url) => (
                            <div key={url} className="aspect-square rounded-lg overflow-hidden bg-neutral-100">
                                <img
                                    src={url}
                                    alt="Marker media"
                                    className="w-full h-full object-cover hover:scale-105 transition-transform duration-200"
                                />
                            </div>
                        ))}
                    </div>
                </Card>
            ) : (
                <Card className="p-6 text-center text-neutral-400">
                    <ImageOff className="w-6 h-6 mx-auto mb-2" />
                    <p className="text-sm">No media uploaded yet.</p>
                </Card>
            )}

            {/* Edit Modal */}
            <MarkerFormModal
                open={isEditModalOpen}
                mode="edit"
                initial={marker}
                onClose={() => setIsEditModalOpen(false)}
                onSaved={handleSaved}
            />
        </div>
    );
}
