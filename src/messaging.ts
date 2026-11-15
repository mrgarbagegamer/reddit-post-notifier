import browser from 'webextension-polyfill';
import type { PortMessage, PortMessageId, PortMessagePayload } from './types/message';

export type MessageListener = (payload?: PortMessagePayload) => Promise<void> | void;
type Context = 'popup' | 'options' | 'background';

const messageListeners = new Map<PortMessageId, MessageListener>();

export async function sendMessage(id: PortMessageId, payload?: PortMessagePayload) {
    const message: PortMessage = { id, payload };
    
    // In MV3, chrome.runtime.sendMessage returns a promise.
    // We catch the error to prevent it from bubbling up as an "uncaught" error
    // which can sometimes interfere with Service Worker health.
    return chrome.runtime.sendMessage(message).catch((error) => {
        const msg = error.message;
        if (msg.includes('Could not establish connection')) {
            // This is expected when the popup/options pages are closed.
            return; 
        }
        console.error('Message failed:', id, msg);
    });
}

let listener: Parameters<typeof browser.runtime.onMessage.addListener>[0];

export function listenForMessages(context: Context) {
    if (listener && browser.runtime.onMessage.hasListener(listener))
        browser.runtime.onMessage.removeListener(listener);

    listener = function (request: any /* , sender, sendResponse */) {
        const message = request as PortMessage;
        console.info(`${context} received message`, message);
        messageListeners.get(message.id)?.(message.payload);
        return undefined;
    };
    browser.runtime.onMessage.addListener(listener);
}

export function onMessage(id: PortMessageId, cb: MessageListener) {
    messageListeners.set(id, cb);
}
