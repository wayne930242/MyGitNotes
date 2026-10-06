import { createContext, type ReactNode, useContext } from 'react';
import type { LucideIcon } from 'lucide-react';

/** A top-level page an edition adds beside the workspace routes. */
export interface FeatureRoute {
  path: string;
  element: ReactNode;
}

/** A section an edition appends to the Settings page, with its sidebar link. */
export interface FeatureSettingsSection {
  /** Anchored as `settings-<id>`. */
  id: string;
  title: ReactNode;
  icon: LucideIcon;
  element: ReactNode;
}

/** Renders the header's sign-in and account controls; `local` is true for a local workspace. Return your own component, such as `<TenantMenu />`. */
export type RenderAccountControls = (props: { local: boolean; }) => ReactNode;

/** Renders extra entries in the signed-in account menu, above sign-out; `close` closes the menu. */
export type RenderAccountMenuItems = (props: { close: () => void; }) => ReactNode;

/**
 * What another edition adds to the web app at build time (see docs/adr/0002-open-core-editions.md).
 * Slots are added here when an edition needs one; without features the app renders as the community edition.
 */
export interface WebFeature {
  id: string;
  routes?: FeatureRoute[];
  settingsSections?: FeatureSettingsSection[];
  /** Replaces the header's sign-in and account controls; the last feature that sets it wins. */
  accountControls?: RenderAccountControls;
  /** Adds entries to the community account menu, such as recent repositories, without replacing it. */
  accountMenuItems?: RenderAccountMenuItems;
}

const FeaturesContext = createContext<readonly WebFeature[]>([]);

export function WebFeaturesProvider({ features, children }: { features: readonly WebFeature[]; children?: ReactNode; }) {
  return <FeaturesContext.Provider value={features}>{children}</FeaturesContext.Provider>;
}

export function useAccountMenuItems(): RenderAccountMenuItems[] {
  return useContext(FeaturesContext).flatMap(feature => feature.accountMenuItems ? [feature.accountMenuItems] : []);
}

export function useSettingsSections(): FeatureSettingsSection[] {
  return useContext(FeaturesContext).flatMap(feature => feature.settingsSections ?? []);
}

export function useAccountControls(): RenderAccountControls | undefined {
  return useContext(FeaturesContext).reduce<RenderAccountControls | undefined>((found, feature) => feature.accountControls ?? found, undefined);
}
