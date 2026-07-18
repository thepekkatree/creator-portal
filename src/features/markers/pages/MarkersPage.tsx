import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { MoreVertical, AlertTriangle, Plus, MapPin, Eye } from "lucide-react";
import { Card, Button, Input, Badge, EmptyState, ErrorState, SkeletonTableRows, SearchBar, StatusFilterPills } from "@components/ui";
import { markerService } from "@services/marker.service";
import { useAuthStore } from "@store/auth.store";
import { ALLOWED_CREATOR_ROLES } from "@/types";
import type { MarkerStatus } from "@/types";
import type { Marker } from "@/types";
import { toast } from "sonner";
import { MarkerFormModal } from "../components/MarkerFormModal";

type StatusFilter = MarkerStatus | "all";

const STATUS_FILTERS: { label: string; value: StatusFilter }[] = [
    { label: "All", value: "all" },
    { label: "Approved", value: "approved" },
    { label: "Pending", value: "pending" },
    { label: "Rejected", value: "rejected" },
];

const VISIBILITY_FILTERS: { label: string; value: "all" | "hidden" | "visible" }[] = [
    { label: "All", value: "all" },
    { label: "Hidden", value: "hidden" },
    { label: "Visible", value: "visible" },
];

export function MarkersPage() {
    const { user } = useAuthStore();
    const navigate = useNavigate();
    const queryClient = useQueryClient();

    // Staff may delete anything; a creator must NOT delete an admin-approved
    // marker (it is live content). Non-approved states a creator owns (pending,
    // rejected, hidden) remain deletable. Reuse the portal's canonical staff
    // role set so this never drifts from the rest of the access logic.
    const isStaff = !!user?.role?.some((r) =>
        (ALLOWED_CREATOR_ROLES as readonly string[]).includes(r)
    );
    const canDelete = (status: MarkerStatus) => isStaff || status !== "approved";

    const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
    const [visibility, setVisibility] = useState<"all" | "hidden" | "visible">("all");
    const [search, setSearch] = useState("");
    const [searchInput, setSearchInput] = useState("");

    // Create / edit modal
    const [isFormModalOpen, setIsFormModalOpen] = useState(false);
    const [editingMarker, setEditingMarker] = useState<Marker | undefined>(undefined);

    // Delete modal
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [confirmText, setConfirmText] = useState("");
    const [markerToDelete, setMarkerToDelete] = useState<string | null>(null);

    // Row dropdown
    const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
    const [dropdownPosition, setDropdownPosition] = useState<"bottom" | "top">("bottom");

    // Close dropdown on outside click
    React.useEffect(() => {
        const handleClickOutside = () => setOpenDropdownId(null);
        document.addEventListener("click", handleClickOutside);
        return () => document.removeEventListener("click", handleClickOutside);
    }, []);

    const { data, isLoading, isError, refetch } = useQuery({
        queryKey: ["creator-markers", { status: statusFilter, visibility, search }],
        queryFn: () =>
            markerService.listMarkers({
                mine: true,
                status: statusFilter !== "all" ? statusFilter : undefined,
                hidden: visibility === "all" ? undefined : visibility === "hidden",
                search: search || undefined,
            }),
        enabled: !!user,
    });

    const markers = data?.items ?? [];

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        setSearch(searchInput);
    };

    const openCreateModal = () => {
        setEditingMarker(undefined);
        setIsFormModalOpen(true);
    };

    const openEditModal = (marker: Marker) => {
        setEditingMarker(marker);
        setIsFormModalOpen(true);
    };

    const handleSaved = (saved: Marker) => {
        queryClient.setQueryData(["marker", saved.id], saved);
        queryClient.invalidateQueries({ queryKey: ["creator-markers"] });
        setIsFormModalOpen(false);
    };

    const handleDeleteRequest = (markerId: string) => {
        setMarkerToDelete(markerId);
        setIsDeleteModalOpen(true);
    };

    const confirmDelete = async () => {
        if (!markerToDelete || confirmText !== "CONFIRM") return;

        const promise = markerService.deleteMarker(markerToDelete);
        toast.promise(promise, {
            loading: "Deleting marker…",
            success: "Marker deleted",
            error: "Failed to delete marker",
        });

        try {
            await promise;
            await queryClient.invalidateQueries({ queryKey: ["creator-markers"] });
        } catch {
            // error handled by toast
        } finally {
            setIsDeleteModalOpen(false);
            setMarkerToDelete(null);
            setConfirmText("");
        }
    };

    return (
        <div className="animate-fade-in space-y-4 w-full max-w-6xl mx-auto pb-6 px-4 sm:px-6 lg:px-8">
            {/* Page Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-display font-bold text-primary-900 tracking-tight">My Markers</h1>
                    <p className="text-neutral-500 mt-1">Manage your place markers</p>
                </div>
                <Button
                    variant="accent"
                    onClick={openCreateModal}
                    className="w-full sm:w-auto"
                    leftIcon={<Plus className="w-4 h-4" />}
                >
                    Create New Marker
                </Button>
            </div>

            {/* Delete Confirmation Modal */}
            {isDeleteModalOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-neutral-900/60 backdrop-blur-sm animate-fade-in">
                    <Card className="w-full max-w-md shadow-2xl border-red-100 overflow-hidden animate-scale-up">
                        <div className="p-6">
                            <div className="flex items-center gap-3 text-red-600 mb-4">
                                <div className="p-2 bg-red-50 rounded-full">
                                    <AlertTriangle className="w-6 h-6" />
                                </div>
                                <h3 className="text-xl font-bold">Delete Marker?</h3>
                            </div>
                            <p className="text-neutral-600 mb-6">
                                This action cannot be undone. To confirm, type{" "}
                                <span className="font-bold text-neutral-900 select-none">CONFIRM</span> below.
                            </p>
                            <div className="space-y-4">
                                <Input
                                    placeholder="Type CONFIRM to delete"
                                    value={confirmText}
                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                                        setConfirmText(e.target.value)
                                    }
                                    className="border-red-100 focus:border-red-500 focus:ring-red-200"
                                    autoFocus
                                />
                                <div className="flex gap-3 pt-2">
                                    <Button
                                        variant="ghost"
                                        fullWidth
                                        onClick={() => {
                                            setIsDeleteModalOpen(false);
                                            setConfirmText("");
                                            setMarkerToDelete(null);
                                        }}
                                    >
                                        Cancel
                                    </Button>
                                    <Button
                                        variant="danger"
                                        fullWidth
                                        disabled={confirmText !== "CONFIRM"}
                                        onClick={confirmDelete}
                                    >
                                        Delete Forever
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </Card>
                </div>
            )}

            {/* Form Modal */}
            <MarkerFormModal
                open={isFormModalOpen}
                mode={editingMarker ? "edit" : "create"}
                initial={editingMarker}
                onClose={() => setIsFormModalOpen(false)}
                onSaved={handleSaved}
            />

            {/* Filters + Search */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                <StatusFilterPills
                    filters={STATUS_FILTERS}
                    active={statusFilter}
                    onChange={setStatusFilter}
                />
                <StatusFilterPills
                    filters={VISIBILITY_FILTERS}
                    active={visibility}
                    onChange={setVisibility}
                />
                <SearchBar
                    value={searchInput}
                    onChange={setSearchInput}
                    onSubmit={handleSearch}
                    placeholder="Search markers…"
                />
            </div>

            {/* Table */}
            <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm">
                <div className="w-full overflow-y-auto overflow-x-auto max-h-[60vh] min-h-[300px]">
                    <table className="w-full text-left border-collapse min-w-[700px] table-fixed">
                        <thead className="sticky top-0 z-20 bg-neutral-50 shadow-sm outline outline-1 outline-neutral-200">
                            <tr className="border-b border-neutral-200">
                                <th className="py-4 px-6 text-xs font-semibold text-neutral-500 uppercase tracking-wider w-[35%]">
                                    Title
                                </th>
                                <th className="py-4 px-6 text-xs font-semibold text-neutral-500 uppercase tracking-wider w-[15%]">
                                    Category
                                </th>
                                <th className="py-4 px-6 text-xs font-semibold text-neutral-500 uppercase tracking-wider w-[15%] text-center">
                                    Status
                                </th>
                                <th className="py-4 px-6 text-xs font-semibold text-neutral-500 uppercase tracking-wider w-[15%] text-center">
                                    Created
                                </th>
                                <th className="py-4 px-6 text-xs font-semibold text-neutral-500 uppercase tracking-wider w-[20%] text-right">
                                    Actions
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-neutral-100">
                            {isLoading ? (
                                <SkeletonTableRows columns={5} />
                            ) : isError ? (
                                <tr>
                                    <td colSpan={5} className="p-0">
                                        <ErrorState
                                            message="We couldn't load your markers."
                                            onRetry={() => refetch()}
                                        />
                                    </td>
                                </tr>
                            ) : markers.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="p-0">
                                        <EmptyState
                                            icon={<MapPin className="w-7 h-7" />}
                                            title="No markers found"
                                            description={
                                                search || statusFilter !== "all"
                                                    ? "No markers match your current filters. Try adjusting your search or status."
                                                    : "Add your first place marker to start mapping points of interest for your quests."
                                            }
                                            action={
                                                <Button
                                                    variant="accent"
                                                    onClick={openCreateModal}
                                                    leftIcon={<Plus className="w-4 h-4" />}
                                                >
                                                    Create New Marker
                                                </Button>
                                            }
                                        />
                                    </td>
                                </tr>
                            ) : (
                                markers.map((marker) => {
                                    const title = marker.title || "Untitled Marker";
                                    return (
                                        <tr
                                            key={marker.id}
                                            onClick={() => navigate(`/creator/markers/view/${marker.id}`)}
                                            className="hover:bg-neutral-50/50 transition-colors cursor-pointer"
                                            title="View marker details"
                                        >
                                            <td
                                                className="py-4 px-6 font-medium text-neutral-900 truncate max-w-[200px]"
                                                title={title}
                                            >
                                                {title}
                                            </td>
                                            <td className="py-4 px-6 text-sm text-neutral-500 truncate">
                                                {marker.category ?? "—"}
                                            </td>
                                            <td className="py-4 px-6 text-center">
                                                <div className="inline-flex items-center gap-1.5">
                                                    <Badge status={marker.status === "pending" ? "under_review" : marker.status as "approved" | "rejected"}>
                                                        {marker.status}
                                                    </Badge>
                                                    {marker.hidden && (
                                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-neutral-100 text-neutral-600 border border-neutral-200">
                                                            Hidden
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="py-4 px-6 text-sm text-neutral-500 whitespace-nowrap text-center">
                                                {marker.created_at
                                                    ? new Date(marker.created_at).toLocaleDateString()
                                                    : "—"}
                                            </td>
                                            <td className="py-4 px-6 text-right relative">
                                                <div className="flex items-center justify-end gap-1">
                                                    <Button
                                                        variant="ghost"
                                                        aria-label={`View ${title}`}
                                                        title="View marker details"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            navigate(`/creator/markers/view/${marker.id}`);
                                                        }}
                                                        className="p-2 h-9 w-9 border border-transparent rounded-lg flex items-center justify-center text-neutral-400 hover:text-primary-600 hover:bg-primary-50 transition-colors"
                                                    >
                                                        <Eye className="w-4 h-4" />
                                                    </Button>
                                                    <div className="relative">
                                                        <Button
                                                            variant="ghost"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                const rect = e.currentTarget.getBoundingClientRect();
                                                                const spaceBelow = window.innerHeight - rect.bottom;
                                                                setDropdownPosition(spaceBelow < 200 ? "top" : "bottom");
                                                                setOpenDropdownId(
                                                                    openDropdownId === marker.id ? null : marker.id
                                                                );
                                                            }}
                                                            className={`p-2 h-9 w-9 border border-transparent rounded-lg flex items-center justify-center transition-colors
                                                                ${openDropdownId === marker.id
                                                                    ? "bg-neutral-100 text-neutral-900"
                                                                    : "text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100"
                                                                }`}
                                                        >
                                                            <MoreVertical className="w-4 h-4" />
                                                        </Button>

                                                        {openDropdownId === marker.id && (
                                                            <div
                                                                className={`absolute right-0 w-48 bg-white border border-neutral-200 rounded-xl shadow-xl z-[100] py-1.5 animate-fade-in ${dropdownPosition === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5"}`}
                                                                onClick={(e) => e.stopPropagation()}
                                                            >
                                                                <button
                                                                    onClick={() => {
                                                                        navigate(`/creator/markers/view/${marker.id}`);
                                                                        setOpenDropdownId(null);
                                                                    }}
                                                                    className="w-full text-left px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50 flex items-center gap-2 font-medium"
                                                                >
                                                                    View Details
                                                                </button>
                                                                <button
                                                                    onClick={() => {
                                                                        openEditModal(marker);
                                                                        setOpenDropdownId(null);
                                                                    }}
                                                                    className="w-full text-left px-4 py-2 text-sm text-primary-600 hover:bg-primary-50 flex items-center gap-2 font-medium"
                                                                >
                                                                    Edit Marker
                                                                </button>
                                                                {canDelete(marker.status) && (
                                                                    <button
                                                                        onClick={() => {
                                                                            handleDeleteRequest(marker.id);
                                                                            setOpenDropdownId(null);
                                                                        }}
                                                                        className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2 font-medium"
                                                                    >
                                                                        Delete Marker
                                                                    </button>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
