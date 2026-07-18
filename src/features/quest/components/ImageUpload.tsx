import { useState, useCallback, type ChangeEvent, type DragEvent } from "react";
import { Upload, X, Image as ImageIcon, Loader2 } from "lucide-react";
import { cloudinaryService, type UploadProgress } from "@services/cloudinary.service";
import type { CloudinaryAsset } from "@/types";

interface ImageUploadProps {
    value?: CloudinaryAsset;
    onChange: (asset: CloudinaryAsset | undefined) => void;
    folder?: string;
    className?: string;
    variant?: "default" | "minimal";
    allowMultiple?: boolean; // If true, won't show preview, just uploads and calls onChange
}

export function ImageUpload({
    value,
    onChange,
    folder = "creator-portal/quests",
    className = "",
    allowMultiple = false,
    variant = "default",
}: ImageUploadProps) {
    const [isUploading, setIsUploading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [dragActive, setDragActive] = useState(false);

    const handleUpload = useCallback(
        async (file: File) => {
            // Validate file type
            if (!file.type.startsWith("image/")) {
                setError("Please select an image file");
                return;
            }

            setIsUploading(true);
            setProgress(0);
            setError(null);

            // No size cap: cloudinaryService.uploadImage downscales oversized
            // photos (phone shots are routinely 8-15MB) before upload, so a hard
            // limit here would only reject files that would otherwise succeed.

            try {
                const result = await cloudinaryService.uploadImage(file, {
                    folder,
                    onProgress: (p: UploadProgress) => setProgress(p.percentage),
                });

                onChange({
                    public_id: result.public_id,
                    secure_url: result.secure_url,
                    width: result.width,
                    height: result.height,
                    format: result.format,
                });
            } catch (err) {
                setError(err instanceof Error ? err.message : "Upload failed");
                onChange(undefined);
            } finally {
                setIsUploading(false);
                setProgress(0);
            }
        },
        [folder, onChange]
    );

    const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            handleUpload(file);
        }
    };

    const handleDrag = (e: DragEvent<HTMLLabelElement>) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === "dragenter" || e.type === "dragover") {
            setDragActive(true);
        } else if (e.type === "dragleave") {
            setDragActive(false);
        }
    };

    const handleDrop = (e: DragEvent<HTMLLabelElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);

        const file = e.dataTransfer.files?.[0];
        if (file) {
            handleUpload(file);
        }
    };

    const handleRemove = () => {
        onChange(undefined);
        setError(null);
    };

    if (value && !allowMultiple) {
        return (
            <div className={`relative ${className}`}>
                <div className="relative rounded-xl overflow-hidden border-2 border-neutral-200">
                    <img
                        src={cloudinaryService.getOptimizedUrl(value.public_id, {
                            width: 600,
                            height: 400,
                            crop: "fill",
                        })}
                        alt="Cover image"
                        className="w-full h-full object-cover"
                    />
                    <button
                        type="button" // Use type button to prevent form submission
                        onClick={handleRemove}
                        className="absolute top-2 right-2 p-1.5 bg-white/90 backdrop-blur rounded-full text-neutral-600 hover:text-red-600 transition-colors shadow-md"
                        aria-label="Remove image"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className={className}>
            <label
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                className={`
          relative flex flex-col items-center justify-center
          w-full h-full rounded-xl cursor-pointer transition-all duration-200
          ${variant === "minimal"
                        ? "border border-dashed border-neutral-300 bg-neutral-50 hover:bg-white hover:border-neutral-800 hover:text-neutral-900"
                        : "border-2 border-dashed border-neutral-300 bg-neutral-50 hover:bg-neutral-100 hover:border-neutral-400"
                    }
          ${dragActive ? "border-neutral-900 bg-neutral-100 ring-1 ring-neutral-900" : ""}
          ${isUploading ? "pointer-events-none opacity-80" : ""}
        `}
            >
                <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileChange}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    disabled={isUploading}
                    aria-label="Upload image"
                />

                {isUploading ? (
                    <div className="flex flex-col items-center justify-center w-full h-full">
                        {variant !== "minimal" ? (
                            <div className="w-full px-4">
                                <Loader2 className="w-10 h-10 text-neutral-900 animate-spin mx-auto mb-3" />
                                <p className="text-sm text-neutral-600 text-center">Uploading... {progress}%</p>
                                <div className="w-full max-w-[200px] h-1.5 bg-neutral-100 rounded-full mt-3 overflow-hidden mx-auto">
                                    <div
                                        className="h-full bg-neutral-900 transition-all duration-300"
                                        style={{ width: `${progress}%` }}
                                    />
                                </div>
                            </div>
                        ) : (
                            <div className="relative flex items-center justify-center w-full h-full">
                                <svg className="w-12 h-12 transform -rotate-90">
                                    <circle
                                        className="text-neutral-100"
                                        strokeWidth="3"
                                        stroke="currentColor"
                                        fill="transparent"
                                        r="18"
                                        cx="24"
                                        cy="24"
                                    />
                                    <circle
                                        className="text-neutral-900 transition-all duration-300 ease-linear"
                                        strokeWidth="3"
                                        strokeDasharray={113}
                                        strokeDashoffset={113 - (113 * progress) / 100}
                                        strokeLinecap="round"
                                        stroke="currentColor"
                                        fill="transparent"
                                        r="18"
                                        cx="24"
                                        cy="24"
                                    />
                                </svg>
                                <span className="absolute text-[10px] font-bold text-neutral-900">{progress}%</span>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="text-center">
                        {variant === "minimal" ? (
                            <div className="flex flex-col items-center justify-center p-2 text-neutral-400 group-hover:text-neutral-900 transition-colors">
                                <span className="bg-white border border-neutral-200 p-1.5 rounded-full mb-1.5 group-hover:border-neutral-400 transition-colors">
                                    <Upload className="w-3.5 h-3.5" />
                                </span>
                                <span className="text-[10px] font-semibold uppercase tracking-wider">Add</span>
                            </div>
                        ) : (
                            <>
                                {dragActive ? (
                                    <Upload className="w-10 h-10 text-neutral-900 mx-auto mb-3" />
                                ) : (
                                    <ImageIcon className="w-10 h-10 text-neutral-400 mx-auto mb-3" />
                                )}
                                <p className="text-sm font-medium text-neutral-700 mb-1">
                                    {dragActive ? "Drop image here" : "Click or drag to upload"}
                                </p>
                                <p className="text-xs text-neutral-500">PNG or JPG — large photos are optimized automatically</p>
                            </>
                        )}
                    </div>
                )}
            </label>

            {error && (
                <p className="mt-2 text-sm text-red-600" role="alert">
                    {error}
                </p>
            )}
        </div>
    );
}
