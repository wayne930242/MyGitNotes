import { useRef, useState } from 'react';
import { RIGHT_PANEL_RAIL_WIDTH } from '../components/WorkspaceChrome.js';
import { type FileManagerHandle } from '../components/FileManager.js';
import { type FileEntry } from '../lib/files-api.js';

export function useFilePanel() {
  const [fileDialog, setFileDialog] = useState<{ notebookId: string; path?: string; movePath?: string; }>();
  const [fileMetadataContainer, setFileMetadataContainer] = useState<HTMLDivElement | null>(null);
  const [fileMetadataOpen, setFileMetadataOpen] = useState(false);
  // Seeded to the rail width (not 0) so the right panel mounts on first render and can report
  // its real width via onWidthChange — a 0 seed would never let it mount in the first place.
  const [rightPanelWidth, setRightPanelWidth] = useState(RIGHT_PANEL_RAIL_WIDTH);
  const [selectedFileEntry, setSelectedFileEntry] = useState<FileEntry>();
  const fileManagerRef = useRef<FileManagerHandle>(null);

  return { fileDialog, setFileDialog, fileMetadataContainer, setFileMetadataContainer, fileMetadataOpen, setFileMetadataOpen, rightPanelWidth, setRightPanelWidth, selectedFileEntry, setSelectedFileEntry, fileManagerRef };
}
