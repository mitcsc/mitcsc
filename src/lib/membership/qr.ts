import qrcode from "qrcode-generator";

// A QR code as one SVG path, drawn on the server so the page ships no QR library.
export function qrSvg(text: string, label: string) {
  const code = qrcode(0, "M");
  code.addData(text, "Byte");
  code.make();
  const size = code.getModuleCount();
  let path = "";
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) if (code.isDark(row, col)) path += `M${col} ${row}h1v1h-1z`;
  }
  const quiet = 2;
  const box = size + quiet * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-quiet} ${-quiet} ${box} ${box}" role="img" aria-label="${label.replace(/"/g, "&quot;")}" shape-rendering="crispEdges"><rect x="${-quiet}" y="${-quiet}" width="${box}" height="${box}" fill="#fff"/><path d="${path}" fill="#0c0c0d"/></svg>`;
}
