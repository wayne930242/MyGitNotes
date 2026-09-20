export type ViewMode = 'list' | 'card' | 'kanban' | 'flat' | 'graph';

export interface NoteTemplate {
  id: string;
  title: string;
  file: string;
}

export type NotebookMetadataFieldType = 'string' | 'boolean' | 'number';

export interface NotebookMetadataField {
  key: string;
  type?: NotebookMetadataFieldType;
  label?: string;
}

export interface NotebookConfig {
  id: string;
  title: string;
  root: string;
  assets?: string;
  default_view?: ViewMode;
  statuses?: string[];
  templates?: NoteTemplate[];
  metadata?: NotebookMetadataField[];
  pathAliases?: Record<string, string>;
}

export type YouTubeDisplayMode = 'thumbnail' | 'medium' | 'theater';

export interface WorkspacePreferences {
  defaultYoutubeDisplayMode?: YouTubeDisplayMode;
  defaultShowLineNumbers?: boolean;
  defaultFocusMode?: boolean;
}

export interface WorkspaceConfig {
  schema_version: number;
  workspace: { title: string; default_notebook: string; };
  notebooks: NotebookConfig[];
  files?: { hide_dotfiles?: boolean; };
  preferences?: WorkspacePreferences;
}

export interface NoteMetadata {
  id?: string;
  title?: string;
  status?: string;
  hiden?: boolean;
  tags?: string[];
  [key: string]: unknown;
}

export interface NoteItem {
  revision?: string;
  id: string;
  path: string;
  notebookId: string;
  title: string;
  status?: string;
  tags: string[];
  metadata: NoteMetadata;
  content: string;
  lineNumberOffset?: number;
  mtime?: number;
  size?: number;
}

export type ResourceType = 'note' | 'agent_instruction' | 'agent_doc' | 'workspace_config' | 'asset' | 'product_source' | 'hidden';

export interface ClassifiedResource {
  path: string;
  type: ResourceType;
  notebookId?: string;
}

export interface FolderItem {
  notebookId: string;
  path: string;
  title: string;
  order: number;
  description?: string;
}

export interface FolderMetadata {
  title?: string;
  order?: number;
  description?: string;
  [key: string]: unknown;
}
