import type { WebSocket } from 'partysocket';

export interface SharedbAceUser {
  id: string;
  name: string;
  color: string;
}

export type SharedbAcePlugin = (pluginWS: WebSocket, editor: any) => any;
