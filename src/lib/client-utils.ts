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
    const randomImage = availableImages[randomIndex];

    if (!used.has(randomImage)) {
      selected.push(randomImage);
      used.add(randomImage);
    }
  }

  return selected;
}
