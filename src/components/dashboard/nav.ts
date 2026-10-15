// The dashboard's pages. Desktop shows the sections as tabs with their tabs below; phones show one menu.

export interface NavTab {
  href: string;
  label: string;
  // Stays selected on the tab's sub-pages.
  nested?: boolean;
}

interface NavSection {
  // Every page of the section is under this path.
  base: string;
  label: string;
  tabs?: NavTab[];
}

// Each tab's path ends with its label, like /dashboard/website/home for Website › Home.

export const CHECK_IN_TABS: NavTab[] = [
  { href: "/dashboard/check-in", label: "Check-In" },
  { href: "/dashboard/check-in/events", label: "Events", nested: true },
];

export const MEMBERSHIP_TABS: NavTab[] = [
  { href: "/dashboard/membership/members", label: "Members" },
  { href: "/dashboard/membership/edit-form", label: "Edit Form" },
  { href: "/dashboard/membership/settings", label: "Settings" },
];

export const DELIB_TABS: NavTab[] = [
  { href: "/dashboard/delibs/live", label: "Live" },
  { href: "/dashboard/delibs/history", label: "History", nested: true },
];

// Everything that changes the public site. Links come first: they change most often.
export const WEBSITE_TABS: NavTab[] = [
  { href: "/dashboard/website/links", label: "Links" },
  { href: "/dashboard/website/home", label: "Home" },
  { href: "/dashboard/website/exec", label: "Exec" },
  { href: "/dashboard/website/alumni", label: "Alumni" },
  { href: "/dashboard/website/roles", label: "Roles" },
];

// Check-in comes first: it is what exec open the dashboard for at events.
export const SECTIONS: NavSection[] = [
  { base: "/dashboard/check-in", label: "Check-In", tabs: CHECK_IN_TABS },
  { base: "/dashboard/membership", label: "Membership", tabs: MEMBERSHIP_TABS },
  { base: "/dashboard/delibs", label: "Delibs", tabs: DELIB_TABS },
  { base: "/dashboard/website", label: "Website", tabs: WEBSITE_TABS },
  { base: "/dashboard/settings", label: "Settings" },
];

// Where the section's link goes: its first tab.
export function sectionHref(section: NavSection) {
  return section.tabs?.[0].href ?? section.base;
}

function within(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function sectionActive(pathname: string, section: NavSection) {
  return within(pathname, section.base);
}

export function tabActive(pathname: string, tab: NavTab) {
  return tab.nested ? within(pathname, tab.href) : pathname === tab.href;
}
