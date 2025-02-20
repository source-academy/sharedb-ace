import type WebSocket from 'reconnecting-websocket';

export interface SharedbAceUser {
  name: string;
  color: string;
}

export type SharedbAcePlugin = (pluginWS: WebSocket, editor: any) => any;
