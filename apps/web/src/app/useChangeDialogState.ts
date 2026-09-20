import type { ChangeRequest } from '../lib/types.js';
import { useState } from 'react';

export function useChangeDialogState() {
  // Modal States
  const [commitRequest, setCommitRequest] = useState<ChangeRequest>();
  const [isCommitOpen, setIsCommitOpen] = useState<boolean>(false);

  return { commitRequest, setCommitRequest, isCommitOpen, setIsCommitOpen };
}
