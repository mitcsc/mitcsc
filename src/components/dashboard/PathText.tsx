// A Drive path or a sequence of clicks, like "MIT CSC › Website", set off in a brighter color from the text around it.
export default function PathText({ path }: { path: string[] }) {
  return (
    <span className="d-path-text">
      {path.map((s, i) => <span key={i}>{i > 0 && <span className="d-crumb-sep" aria-hidden="true">›</span>}{s}</span>)}
    </span>
  );
}
