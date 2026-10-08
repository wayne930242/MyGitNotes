import { createContext, type ReactNode, useContext } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { NoteChangeFacts } from './commit-summary.js';

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

/** What `commitMessagePolish` is given: the facts of every changed note, and the commit message as it stands (subject, body and trailers). */
export interface CommitPolishInput {
  facts: NoteChangeFacts[];
  message: string;
}

/**
 * Rewrites a commit message's subject and body. Whatever it returns, the trailers are regenerated from the
 * facts afterwards, so a model can neither drop nor invent a `Note-Added`, `Note-Modified` or `Document-Modified` line.
 */
export type CommitMessagePolish = (input: CommitPolishInput) => Promise<string>;

/** The agent workspace an Agents-page section is shown for: a folder of one repository, empty for its root. */
export interface AgentWorkspaceRef {
  repository: string;
  folder: string;
}

/**
 * Renders a section of the Agents page's sidebar for the selected agent workspace, below its skills, such as an
 * edition's MCP server settings. `readOnly` is true when the user may not change that workspace.
 */
export type RenderAgentWorkspaceSection = (props: { workspace: AgentWorkspaceRef; readOnly: boolean; }) => ReactNode;

/** The features an edition may gate; `WebFeature.gate` is asked about each by one of these ids. */
export const FEATURE_IDS = { agent: 'agent', r2: 'r2', commitPolish: 'commit-polish' } as const;

/** Whether a feature is open to the signed-in user, and what to show in its place when it is not. */
export interface FeatureGate {
  allowed: boolean;
  /** Shown where the feature would be, such as an upgrade prompt. */
  reason?: ReactNode;
}

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
  /** Adds sections to the Agents page for the selected agent workspace; the community edition has none. */
  agentWorkspaceSections?: RenderAgentWorkspaceSection[];
  /** Adds an "AI polish" button to the commit dialog, beside "Generate message"; the last feature that sets it wins. */
  commitMessagePolish?: CommitMessagePolish;
  /**
   * The server runs an agent for a remote deployment too (its `PiAgent` is mounted at `/api/pi`), so the web app
   * asks it for a session there. Without it a remote deployment never asks, as a remote server runs no local Pi.
   */
  agent?: boolean;
  /**
   * Shown in the agent panel in place of the message box while Pi has no model it can call, such as how to add a
   * provider key; the last feature that sets it wins, and without one the panel explains Pi's own setup.
   */
  agentModelSetup?: ReactNode;
  /**
   * Whether the agent panel (`FEATURE_IDS.agent`), the R2 panel (`FEATURE_IDS.r2`) and the polish button
   * (`FEATURE_IDS.commitPolish`) are open to this user. A denied feature shows its `reason` in place instead
   * of being hidden or failing at the server. It is presentation only: the server still enforces every limit.
   */
  gate?: (featureId: string) => FeatureGate;
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

export function useAgentWorkspaceSections(): RenderAgentWorkspaceSection[] {
  return useContext(FeaturesContext).flatMap(feature => feature.agentWorkspaceSections ?? []);
}

export function useAccountControls(): RenderAccountControls | undefined {
  return useContext(FeaturesContext).reduce<RenderAccountControls | undefined>((found, feature) => feature.accountControls ?? found, undefined);
}

export function useCommitMessagePolish(): CommitMessagePolish | undefined {
  return useContext(FeaturesContext).reduce<CommitMessagePolish | undefined>((found, feature) => feature.commitMessagePolish ?? found, undefined);
}

export function useAgentModelSetup(): ReactNode | undefined {
  return useContext(FeaturesContext).reduce<ReactNode | undefined>((found, feature) => feature.agentModelSetup ?? found, undefined);
}

/** Whether the app asks the server for an agent session: always for a local workspace, and for a remote one only when an edition's server supplies an agent. */
export function useAgentEnabled(remote: boolean): boolean {
  const hosted = useContext(FeaturesContext).some(feature => feature.agent === true);
  return !remote || hosted;
}

/** The first denial among the features, or an open gate; the community edition gates nothing. */
export function useFeatureGate(featureId: string): FeatureGate {
  for (const feature of useContext(FeaturesContext)) {
    const gate = feature.gate?.(featureId);
    if (gate && !gate.allowed) return gate;
  }
  return { allowed: true };
}
