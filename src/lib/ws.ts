import { browser } from '$app/environment';
import { get, writable } from 'svelte/store';
import data from '$lib/user_data';
import config from '$lib/user_config';
import { PayloadOP, type IncomingPayload } from '$lib/types/event';
import markdown from '$lib/markdown';
import type { UserData } from './types/ui/user';
import type { State } from './types/ui/state';
import { request } from './request';

const state = writable<State>({ connected: false, messages: [], users: [] });

let ws: WebSocket | null = null;
let pingInterval: NodeJS.Timer | null = null;
let lastAuthor: number | null = null;
let notification: Notification;
let notification_opt: number;
let connected = false;

state.subscribe((state) => { connected = state.connected });

const retryConnect = (wait = 5_000) => {
  state.update((state) => { state.connected = false; return state });
  setTimeout(() => {
    let userData = get(data);
    if (userData) {
      connect(userData)
    }
  }, wait);
};

const connect = async (userData: UserData) => {
  ws?.close();
  if (pingInterval) clearInterval(pingInterval);

  const innerWs = new WebSocket(userData.instanceInfo.pandemonium_url);

  innerWs.addEventListener('open', () => {
    innerWs?.addEventListener('message', (msg: MessageEvent) => {
      const payload: IncomingPayload = JSON.parse(msg.data);

      if (payload.op == PayloadOP.HELLO) {
        setTimeout(() => {
          ws?.send(JSON.stringify({ op: PayloadOP.PING }));
          pingInterval = setInterval(
            () => ws?.send(JSON.stringify({ op: PayloadOP.PING })),
            payload.d.heartbeat_interval
          );
        }, payload.d.heartbeat_interval * Math.random());
        ws = innerWs;
        ws?.send(JSON.stringify({ op: PayloadOP.AUTHENTICATE, d: userData.session.token }));
      } else if (payload.op == PayloadOP.AUTHENTICATED) {
        state.update((state) => {
          state.connected = true;
          state.users = [];
          payload.d.users.forEach((u) => state.users[u.id] = u);
          state.users[payload.d.user.id] = payload.d.user;
          return state;
        });
        data.update((data) => { if (data) data.user = payload.d.user; return data; });
        ws = innerWs;
      }
      else if (payload.op == PayloadOP.USER_UPDATE) {
        state.update((state) => {
          state.connected = true;
          state.users[payload.d.id] = payload.d;
          return state;
        });
      } else if (payload.op == PayloadOP.PRESENCE_UPDATE) {
        state.update((s) => {
          s.connected = true;
          if (!s.users[payload.d.user_id]) {
            request('GET', `/users/${payload.d.user_id}`).then((u) => {
              state.update((state) => {
                state.users[payload.d.user_id] = u;
                return state;
              })
            });
          }
          else {
            s.users[payload.d.user_id].status = payload.d.status;
          }
          return s;
        });
      } else if (payload.op == PayloadOP.MESSAGE_CREATE)
        markdown(payload.d.content).then((content) => {
          const message = {
            renderedContent: content,
            showAuthor: payload.d.author.id != lastAuthor,
            mentioned: payload.d.content.toLowerCase().split(`<@${userData.user.id}>`).length > 1,
            ...payload.d
          };
          if (
            'Notification' in window &&
            Notification.permission == 'granted' &&
            message.author.id != userData.user.id &&
            !document.hasFocus() &&
            notification_opt > 0
          ) {
            if (notification_opt >= 3 || message.mentioned)
              notification = new Notification(
                message.mentioned
                  ? `New mention from ${message.author.display_name ?? message.author.username}`
                  : `New message from ${message.author.display_name ?? message.author.username}`,
                {
                  body: message.content,
                  icon: `${userData.instanceInfo.effis_url}/avatars/${message.author.avatar}` ?? '/das_ding.png',
                  renotify: true,
                  tag: 'NewMessage'
                }
              );
          }
          lastAuthor = payload.d.author.id;
          state.update((state) => {
            state.messages.push(message);
            return state;
          });
        });
    });

    innerWs?.addEventListener('close', () => {
      console.warn('WebSocket connection closed, reconnecting');
      retryConnect();
    });
  });

  innerWs.addEventListener('error', () => {
    console.error('Encountered an error while connecting to WebSocket');
    retryConnect();
  });
};

if (browser) {
  data.subscribe(async (userData) => {
    // You have to log out to change the instance's url.
    if (!connected && userData) {
      await connect(userData);
    } else if (!userData) {
      state.update((state) => { state.connected = false; return state; });
      ws?.close();
      if (pingInterval) clearInterval(pingInterval);
      ws = null;
    }
  });

  config.subscribe((conf) => {
    if (!conf.notifications) {
      conf.notifications = 2;
    }
    notification_opt = conf.notifications;
  });

  document.addEventListener('focus', () => {
    notification?.close();
  });
}

export default state;
