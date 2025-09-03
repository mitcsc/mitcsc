import { readdir } from "fs/promises";
import { join } from "path";

// Cache for image list to avoid repeated filesystem calls
let imageCache: string[] | null = null;

/**
 * Gets all image files from the public/img directory
 * Uses caching to avoid repeated filesystem calls
 */
export async function getImageFiles(): Promise<string[]> {
  if (imageCache) return imageCache;

  try {
    const imgDir = join(process.cwd(), "public", "img");
    const files = await readdir(imgDir);

    // Filter for common image extensions
    const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"];
    const imageFiles = files.filter((file) =>
      imageExtensions.some((ext) => file.toLowerCase().endsWith(ext))
    );

    imageCache = imageFiles;
    return imageFiles;
  } catch (error) {
    console.error("Error reading image directory:", error);
    return [];
  }
}

/**
 * Efficiently selects a random set of images from the available images
 * @param allImages - Array of all available image filenames
 * @param count - Number of images to select (default: 10)
 * @param exclude - Array of image filenames to exclude from selection
 * @returns Array of randomly selected image filenames
 */
export function getRandomImages(
  allImages: string[],
  count: number = 10,
  exclude: string[] = []
): string[] {
  const availableImages = allImages.filter((img) => !exclude.includes(img));
  const maxCount = Math.min(count, availableImages.length);

  if (maxCount === 0) return [];
  if (maxCount === availableImages.length) return [...availableImages];

  const selected: string[] = [];
  const used = new Set<string>();

  while (selected.length < maxCount) {
    const randomIndex = Math.floor(Math.random() * availableImages.length);
    const image = availableImages[randomIndex];

    if (!used.has(image)) {
      selected.push(image);
      used.add(image);
    }
  }

  return selected;
}
