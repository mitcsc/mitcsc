// The dashboard's pages. Desktop shows the sections as tabs with their tabs below; phones show one menu.

export interface NavTab {
  href: string;
  label: string;
  // Stays selected on the tab's sub-pages.
  nested?: boolean;
}

interface NavSection {
  href: string;
  label: string;
  // Another path that belongs to this section.
  also?: string;
  tabs?: NavTab[];
}

export const CHECK_IN_TABS: NavTab[] = [
  { href: "/dashboard/check-in", label: "Check-In" },
  { href: "/dashboard/events", label: "Events", nested: true },
];

export const MEMBERSHIP_TABS: NavTab[] = [
  { href: "/dashboard/membership", label: "Members" },
  { href: "/dashboard/membership/form", label: "Edit Form" },
  { href: "/dashboard/membership/settings", label: "Settings" },
];

export const DELIB_TABS: NavTab[] = [
  { href: "/dashboard/delibs", label: "Live" },
  { href: "/dashboard/delibs/history", label: "History", nested: true },
];

// Everything that changes the public site.
export const WEBSITE_TABS: NavTab[] = [
  { href: "/dashboard/website/photos", label: "Home" },
  { href: "/dashboard/website/exec", label: "Exec" },
  { href: "/dashboard/website/alumni", label: "Alumni" },
  { href: "/dashboard/website/roles", label: "Roles" },
  { href: "/dashboard/website/links", label: "Links" },
];

// Check-in comes first: it is what exec open the dashboard for at events.
export const SECTIONS: NavSection[] = [
  { href: "/dashboard/check-in", label: "Check-In", also: "/dashboard/events", tabs: CHECK_IN_TABS },
  { href: "/dashboard/membership", label: "Membership", tabs: MEMBERSHIP_TABS },
  { href: "/dashboard/delibs", label: "Delibs", tabs: DELIB_TABS },
  { href: "/dashboard/website/photos", label: "Website", also: "/dashboard/website", tabs: WEBSITE_TABS },
  { href: "/dashboard/settings", label: "Settings" },
];

function within(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function sectionActive(pathname: string, section: NavSection) {
  return within(pathname, section.href) || (!!section.also && within(pathname, section.also));
}

export function tabActive(pathname: string, tab: NavTab) {
  return tab.nested ? within(pathname, tab.href) : pathname === tab.href;
}
