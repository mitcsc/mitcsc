import { readdir } from "fs/promises";
import { join } from "path";

let imageCache: string[] | null = null;

export async function getImageFiles(): Promise<string[]> {
  if (imageCache) return imageCache;

  try {
    const eventImgDir = join(process.cwd(), "public", "img", "event");
    const files = await readdir(eventImgDir);

    // Filter for common image extensions
    const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"];
    const eventImageFiles = files.filter((file) =>
      imageExtensions.some((ext) => file.toLowerCase().endsWith(ext))
    );

    imageCache = eventImageFiles;
    return eventImageFiles;
  } catch (error) {
    console.error("Error reading image directory:", error);
    return [];
  }
}

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
