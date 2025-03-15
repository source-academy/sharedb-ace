import type { IRangeData } from '@convergencelabs/ace-collab-ext';
import type { IIndexRange } from '@convergencelabs/ace-collab-ext/dist/types/IndexRange';
import type { Ace } from 'ace-builds';

export enum CollabEditingAccess {
  OWNER = 'owner',
  EDITOR = 'editor',
  VIEWER = 'viewer'
}

export interface SharedbAceUser {
  name: string;
  color: string;
  role: CollabEditingAccess;
}

export interface PresenceUpdate {
  user: SharedbAceUser;
  cursorPos?: Ace.Point;
  selectionRange?: IRangeData[];
  radarViewRows?: IIndexRange;
  radarCursorRow?: number;
  newMode?: string;
  newRole?: {
    userId: string;
    newRole: CollabEditingAccess;
  };
}
