import { config } from "@config/env";
import type { CloudinaryUploadResponse } from "@/types";

export interface UploadProgress {
    loaded: number;
    total: number;
    percentage: number;
}

export interface UploadOptions {
    onProgress?: (progress: UploadProgress) => void;
    folder?: string;
    tags?: string[];
}

/** Longest edge, in px, we keep. Comfortably above any display size we render. */
const MAX_DIMENSION = 2000;
/** Files at or under this are sent untouched — re-encoding them only loses quality. */
const COMPRESS_THRESHOLD_BYTES = 1_500_000;
const JPEG_QUALITY = 0.85;

/**
 * Downscale + re-encode an oversized photo before upload.
 *
 * A phone camera JPEG is routinely 8-15 MB, which Cloudinary's unsigned preset
 * rejects outright and which takes minutes to push over mobile data. Shrinking
 * to a sane display size first is what makes uploads land in seconds.
 *
 * Returns the original file untouched on any failure (HEIC and other formats the
 * browser cannot decode, canvas being unavailable, etc.) — a slow upload that
 * might work beats a hard failure here.
 */
async function compressImage(file: File): Promise<File> {
    if (!file.type.startsWith("image/")) return file;
    // GIFs would lose animation and SVGs are vectors — never re-encode either.
    if (file.type === "image/gif" || file.type === "image/svg+xml") return file;

    try {
        // `from-image` applies the EXIF rotation phone cameras rely on; without
        // it, portrait shots upload sideways.
        const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
        const longestEdge = Math.max(bitmap.width, bitmap.height);
        const scale = Math.min(1, MAX_DIMENSION / longestEdge);

        if (scale === 1 && file.size <= COMPRESS_THRESHOLD_BYTES) {
            bitmap.close();
            return file;
        }

        const canvas = document.createElement("canvas");
        canvas.width = Math.round(bitmap.width * scale);
        canvas.height = Math.round(bitmap.height * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) {
            bitmap.close();
            return file;
        }
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close();

        const blob = await new Promise<Blob | null>((resolve) =>
            canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
        );
        // Keep the original if re-encoding somehow made it bigger (small PNGs can).
        if (!blob || blob.size >= file.size) return file;

        return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", {
            type: "image/jpeg",
            lastModified: Date.now(),
        });
    } catch {
        return file;
    }
}

export const cloudinaryService = {
    /**
     * Upload image to Cloudinary using unsigned upload preset
     * Note: API Secret is NOT used here - we use unsigned preset for security
     */
    async uploadImage(
        file: File,
        options: UploadOptions = {}
    ): Promise<CloudinaryUploadResponse> {
        const upload = await compressImage(file);

        const formData = new FormData();
        formData.append("file", upload);
        formData.append("upload_preset", config.cloudinary.uploadPreset);

        if (options.folder) {
            formData.append("folder", options.folder);
        }

        if (options.tags && options.tags.length > 0) {
            formData.append("tags", options.tags.join(","));
        }

        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();

            xhr.upload.addEventListener("progress", (event) => {
                if (event.lengthComputable && options.onProgress) {
                    options.onProgress({
                        loaded: event.loaded,
                        total: event.total,
                        percentage: Math.round((event.loaded / event.total) * 100),
                    });
                }
            });

            xhr.addEventListener("load", () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    try {
                        const response = JSON.parse(xhr.responseText) as CloudinaryUploadResponse;
                        resolve(response);
                    } catch {
                        reject(new Error("Failed to parse upload response"));
                    }
                } else {
                    let errorMessage = `Upload failed with status ${xhr.status}`;
                    try {
                        const errorResponse = JSON.parse(xhr.responseText);
                        if (errorResponse.error && errorResponse.error.message) {
                            errorMessage = errorResponse.error.message;
                        }
                    } catch {
                        // ignore parse error
                    }
                    console.error("Cloudinary error:", xhr.responseText);
                    reject(new Error(errorMessage));
                }
            });

            xhr.addEventListener("error", () => {
                reject(new Error("Upload failed due to network error"));
            });

            xhr.addEventListener("abort", () => {
                reject(new Error("Upload was aborted"));
            });

            xhr.open("POST", config.cloudinary.uploadUrl);
            xhr.send(formData);
        });
    },

    /**
     * Generate optimized Cloudinary URL with transformations
     */
    getOptimizedUrl(
        publicId: string,
        options: {
            width?: number;
            height?: number;
            crop?: "fill" | "fit" | "scale" | "thumb";
            quality?: "auto" | number;
            format?: "auto" | "webp" | "jpg" | "png";
        } = {}
    ): string {
        const {
            width,
            height,
            crop = "fill",
            quality = "auto",
            format = "auto",
        } = options;

        const transformations: string[] = [];

        if (width) transformations.push(`w_${width}`);
        if (height) transformations.push(`h_${height}`);
        if (width || height) transformations.push(`c_${crop}`);
        transformations.push(`q_${quality}`);
        transformations.push(`f_${format}`);

        const transformString = transformations.join(",");

        return `https://res.cloudinary.com/${config.cloudinary.cloudName}/image/upload/${transformString}/${publicId}`;
    },
};
