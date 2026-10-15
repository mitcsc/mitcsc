// Shows right away when switching dashboard tabs, while the server gets the new tab's data.
export default function DashboardLoading() {
  return (
    <main className="d-page d-loading" aria-busy="true" aria-label="Loading">
      <span className="d-loading-line is-title" />
      <span className="d-loading-line" />
      <span className="d-loading-line is-short" />
    </main>
  );
}
