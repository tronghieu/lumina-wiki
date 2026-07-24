import { Events } from '@wailsio/runtime';
import {
  CancelChat,
  Chat,
} from '../../../bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/service';
import type { ChatEventEnvelope } from './chat-types';
import type { ChatBridge } from './use-chat-stream';

export const WAILS_CHAT_EVENT = 'lumina:chat:event';

export const wailsChatBridge: ChatBridge = {
  onStream(callback) {
    return Events.On(WAILS_CHAT_EVENT, (event) => callback(event.data as ChatEventEnvelope));
  },
  chat: Chat,
  cancelChat: CancelChat,
};
