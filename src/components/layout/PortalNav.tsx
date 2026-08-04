"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

/**
 * Portal section navigation registry.
 *
 * The problem this solves: the global <Navbar /> lives in the ROOT layout, but
 * the section navigation (requester sidebar, admin nav) is decided further down
 * the tree — sometimes from server-evaluated feature flags. On desktop those
 * live in their own sidebar/nav strip, but on mobile there is no room for a
 * second navigation surface, so everything has to collapse into the single
 * hamburger in the navbar.
 *
 * Because the Navbar is an ANCESTOR of the section layouts, a normal
 * "provider inside the section" pattern cannot work. Instead the provider sits
 * at the root and section shells *register* their links into it on mount via
 * `useRegisterPortalNav`. The Navbar then renders whatever is registered.
 */

export interface PortalNavLink {
  href: string;
  label: string;
  /** Optional decorative glyph shown in the sidebar / drawer. */
  icon?: string;
}

export interface PortalNavSection {
  /** Stable id so re-registration replaces rather than duplicates. */
  id: string;
  /** Short heading shown above the links in the mobile drawer. */
  title: string;
  links: PortalNavLink[];
}

interface PortalNavContextValue {
  sections: PortalNavSection[];
  register: (section: PortalNavSection) => void;
  unregister: (id: string) => void;
}

const PortalNavContext = createContext<PortalNavContextValue | null>(null);

export function PortalNavProvider({ children }: { children: React.ReactNode }) {
  const [sections, setSections] = useState<PortalNavSection[]>([]);

  const register = useCallback((section: PortalNavSection) => {
    setSections((prev) => {
      const next = prev.filter((s) => s.id !== section.id);
      next.push(section);
      return next;
    });
  }, []);

  const unregister = useCallback((id: string) => {
    setSections((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const value = useMemo(
    () => ({ sections, register, unregister }),
    [sections, register, unregister]
  );

  return (
    <PortalNavContext.Provider value={value}>
      {children}
    </PortalNavContext.Provider>
  );
}

/** Read the registered section navigation (used by the navbar drawer). */
export function usePortalNav(): PortalNavSection[] {
  const ctx = useContext(PortalNavContext);
  return ctx?.sections ?? [];
}

/**
 * Register a section's navigation for the lifetime of the calling component.
 *
 * `links` is serialised for the dependency comparison so callers can pass a
 * freshly-built array on every render without causing an update loop.
 */
export function useRegisterPortalNav(section: PortalNavSection): void {
  const ctx = useContext(PortalNavContext);
  const register = ctx?.register;
  const unregister = ctx?.unregister;
  const { id, title } = section;
  const serialisedLinks = JSON.stringify(section.links);

  useEffect(() => {
    if (!register || !unregister) return;
    register({ id, title, links: JSON.parse(serialisedLinks) as PortalNavLink[] });
    return () => unregister(id);
  }, [register, unregister, id, title, serialisedLinks]);
}
