// The dashboard's pages. Desktop shows the sections as tabs with their tabs below; phones show one menu.

export interface NavTab {
  href: string;
  label: string;
  // Stays selected on the tab's sub-pages.
  nested?: boolean;
}

export interface NavSection {
  href: string;
  label: string;
  // Another path that belongs to this section.
  also?: string;
  tabs?: NavTab[];
}

export const CHECK_IN_TABS: NavTab[] = [
  { href: "/dashboard/check-in", label: "Check In" },
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

// Check-in comes first: it is what exec open the dashboard for at events.
export const SECTIONS: NavSection[] = [
  { href: "/dashboard/check-in", label: "Check-in", also: "/dashboard/events", tabs: CHECK_IN_TABS },
  { href: "/dashboard/membership", label: "Membership", tabs: MEMBERSHIP_TABS },
  { href: "/dashboard/delibs", label: "Delibs", tabs: DELIB_TABS },
  { href: "/dashboard/photos", label: "Photos" },
  { href: "/dashboard/settings", label: "Settings" },
];

export function within(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function sectionActive(pathname: string, section: NavSection) {
  return within(pathname, section.href) || (!!section.also && within(pathname, section.also));
}

export function tabActive(pathname: string, tab: NavTab) {
  return tab.nested ? within(pathname, tab.href) : pathname === tab.href;
}
