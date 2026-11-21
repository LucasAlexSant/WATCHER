import type { RTMClient } from 'agora-rtm';

export interface AgoraTokenData {
  appId: string;
  token: string;
  uid: string;
  channel: string;
}

export type VoiceSessionData = AgoraTokenData & { id: string; owner: string };
export type AgoraRenewalTokens = { rtcToken: string; rtmToken: string };

export interface ConversationComponentProps {
  agoraData: AgoraTokenData;
  rtmClient: RTMClient;
  onTokenWillExpire: () => Promise<AgoraRenewalTokens>;
  onEndConversation: () => void;
}
