import type { IAgoraRTCClient } from 'agora-rtc-sdk-ng';

export type TranscriptLine = {
  id: string;
  speaker: 'agent' | 'user';
  text: string;
  state: 'live' | 'interrupted' | 'complete';
};

export type TranscriptSession = {
  close: () => Promise<void>;
};

type Connection = { appId: string; token: string; channel: string; uid: number; agentUid: number };

export async function connectTranscript(
  rtc: IAgoraRTCClient,
  connection: Connection,
  onUpdate: (lines: TranscriptLine[]) => void,
  onSpeaking: (speaking: boolean) => void,
): Promise<TranscriptSession> {
  let expired = false;
  let timer: number | undefined;

  async function setup() {
    const [{ default: AgoraRTM }, { AgoraVoiceAI, AgoraVoiceAIEvents, AgentState, TranscriptHelperMode, TurnStatus }] = await Promise.all([
      import('agora-rtm'),
      import('agora-agent-client-toolkit'),
    ]);
    if (expired) throw new Error('Signaling setup expired');
    const rtm = new AgoraRTM.RTM(connection.appId, String(connection.uid));
    let toolkit: Awaited<ReturnType<typeof AgoraVoiceAI.init>> | undefined;

    async function close() {
      if (toolkit) {
        try {
          toolkit.unsubscribe();
        } finally {
          toolkit.destroy();
        }
      }
    }

    async function disconnect() {
      try {
        await close();
      } finally {
        await rtm.logout().catch(() => undefined);
      }
    }

    try {
      await rtm.login({ token: connection.token });
      if (expired) throw new Error('Signaling login expired');
      await rtm.subscribe(connection.channel);
      if (expired) throw new Error('Signaling subscription expired');
      toolkit = await AgoraVoiceAI.init({
        rtcEngine: rtc,
        rtmEngine: rtm,
        renderMode: TranscriptHelperMode.TEXT,
        enableLog: false,
      });
      if (expired) throw new Error('Transcript setup expired');
      toolkit.on(AgoraVoiceAIEvents.TRANSCRIPT_UPDATED, turns => {
        const lines: TranscriptLine[] = [];
        turns.forEach((item, index) => {
          const text = typeof item.text === 'string'
            ? item.text.replace(/([.!?,])(?=\p{L})/gu, '$1 ').replace(/\s{2,}/g, ' ').trim() : '';
          if (!text) return;
          // UID zero identifies the local speaker in the demo's toolkit.
          const uid = String(item.uid) === '0' ? String(connection.uid) : String(item.uid);
          lines.push({
            id: `${uid}:${item.turn_id ?? index}`,
            speaker: uid === String(connection.agentUid) ? 'agent' : 'user',
            text,
            state: item.status === TurnStatus.IN_PROGRESS ? 'live'
              : item.status === TurnStatus.INTERRUPTED ? 'interrupted' : 'complete',
          });
        });
        onUpdate(lines);
      });
      toolkit.on(AgoraVoiceAIEvents.AGENT_STATE_CHANGED, (uid, event) => {
        if (String(uid) === String(connection.agentUid)) onSpeaking(event.state === AgentState.SPEAKING);
      });
      toolkit.subscribeMessage(connection.channel);
      return { close: disconnect };
    } catch (error) {
      void disconnect().catch(() => undefined);
      throw error;
    }
  }

  try {
    return await Promise.race([
      setup(),
      new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => {
          expired = true;
          reject(new Error('Transcript setup timed out'));
        }, 8500);
      }),
    ]);
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
}
