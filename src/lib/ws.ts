import { browser } from '$app/environment';
import { get, writable } from 'svelte/store';
import data from '$lib/user_data';
import config from '$lib/user_config';
import { PayloadOP, type IncomingPayload } from '$lib/types/event';
import markdown from '$lib/markdown';
import type { UserData } from './types/ui/user';
import type { State } from './types/ui/state';
import { request } from './request';
import type { InstanceInfo } from './types/instance';

const state = writable<State>({
  connected: false,
  messages: [],
  users: [],
  spheres: [],
  categories: [],
  channels: []
});

let ws: WebSocket | null = null;
let pingInterval: NodeJS.Timeout | null = null;
let lastAuthorID: { [name: number]: number } = {};
let lastAuthorData: { [name: number]: { name: string; avatar: string | number | undefined } } = {};
let notification: Notification;
let notification_opt: number;
let connected = false;

state.subscribe((state) => {
  connected = state.connected;
});

const retryConnect = (wait = 5_000) => {
  if (connected == false) return; // this should hopefully maybe prevent having more than one pending reconnects
  state.update((state) => {
    state.connected = false;
    return state;
  });
  ws?.close();
  if (pingInterval) clearInterval(pingInterval);
  setTimeout(() => {
    let userData = get(data);
    if (userData) {
      connect(userData);
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

      let instanceInfo: InstanceInfo;
      if (payload.op == PayloadOP.HELLO) {
        setTimeout(() => {
          ws?.send(JSON.stringify({ op: PayloadOP.PING }));
          pingInterval = setInterval(
            () => ws?.send(JSON.stringify({ op: PayloadOP.PING })),
            payload.d.heartbeat_interval
          );
        }, payload.d.heartbeat_interval * Math.random());
        ws = innerWs;
        instanceInfo = payload.d.instance_info;
        ws?.send(JSON.stringify({ op: PayloadOP.AUTHENTICATE, d: userData.session.token }));
      } else if (payload.op == PayloadOP.AUTHENTICATED) {
        state.update((state) => {
          state.connected = true;
          state.users = [];
          payload.d.spheres.forEach((u) => {
            u.members.forEach((m) => {
              state.users[m.user.id] = m.user;
            });
            u.categories.forEach((c) => {
              c.collapsed = false; // TODO: Maybe remember this between sessions?
              state.categories[c.id] = c;
              c.channels.forEach((c) => {
                state.channels[c.id] = c;
              });
            });
            state.spheres[u.id] = u;
          });
          state.users[payload.d.user.id] = payload.d.user;
          return state;
        });
        data.update((data) => {
          if (data) {
            data.user = payload.d.user;
            if (instanceInfo) data.instanceInfo = instanceInfo;
          }
          return data;
        });
      } else if (payload.op == PayloadOP.USER_UPDATE) {
        state.update((state) => {
          state.connected = true;
          state.users[payload.d.id] = payload.d;
          return state;
        });
        if (payload.d.id == userData.user.id) {
          data.update((d) => {
            if (d) {
              d.user = payload.d;
            }
            return d;
          });
        }
      } else if (payload.op == PayloadOP.PRESENCE_UPDATE) {
        state.update((s) => {
          s.connected = true;
          if (!s.users[payload.d.user_id]) {
            request('GET', `/users/${payload.d.user_id}`).then((u) => {
              state.update((state) => {
                state.users[payload.d.user_id] = u;
                return state;
              });
            });
          } else {
            s.users[payload.d.user_id].status = payload.d.status;
          }
          return s;
        });
        if (payload.d.user_id == userData.user.id) {
          data.update((d) => {
            if (d) {
              d.user.status = payload.d.status;
            }
            return d;
          });
        }
      } else if (payload.op == PayloadOP.MESSAGE_CREATE)
        markdown(payload.d.content ?? '').then((content) => {
          let channelID = payload.d.channel.id;
          const authorData = {
            name:
              payload.d._disguise?.name ??
              payload.d.author.display_name ??
              payload.d.author.username,
            avatar: payload.d._disguise?.avatar ?? payload.d.author.avatar
          };
          if (!lastAuthorData[channelID]) {
            let lastMessage = get(state).messages[channelID].messages.at(-1);
            if (lastMessage) {
              lastAuthorData[channelID] = {
                name:
                  lastMessage?._disguise?.name ??
                  lastMessage.author.display_name ??
                  lastMessage.author.username,
                avatar: lastMessage?._disguise?.avatar ?? lastMessage?.author.avatar
              };
              lastAuthorID[channelID] = lastMessage?.author.id;
            }
          }
          let sameData =
            authorData?.name == lastAuthorData[channelID]?.name &&
            authorData?.avatar == lastAuthorData[channelID].avatar;
          const message = {
            renderedContent: content,
            showAuthor: !sameData || payload.d.author.id != lastAuthorID[channelID],
            mentioned: new RegExp(`(?<!\\\\)<@${userData.user.id}>`, 'gm').test(
              payload.d.content ?? ''
            ),
            ...payload.d
          };
          lastAuthorData[channelID] = authorData;
          lastAuthorID[channelID] = payload.d.author.id;
          if (
            'Notification' in window &&
            Notification.permission == 'granted' &&
            message.author.id != userData.user.id &&
            !document.hasFocus() &&
            notification_opt > 0
          ) {
            if (notification_opt >= 3 || message.mentioned) {
              let icon = message._disguise?.avatar
                ? `${userData.instanceInfo.effis_url}/proxy?url=${encodeURIComponent(message._disguise?.avatar)}`
                : message.author.avatar
                  ? `${userData.instanceInfo.effis_url}/avatars/${message.author.avatar}`
                  : 'https://github.com/eludris/.github/blob/main/assets/thang-big.png?raw=true';
              notification = new Notification(
                message.mentioned
                  ? `New mention from ${authorData.name}`
                  : `New message from ${authorData.name}`,
                {
                  body: message.content,
                  icon,
                  silent: false,
                  tag: 'NewMessage'
                }
              );
              // new Audio('...').play();
            }
          }
          state.update((state) => {
            if (state.messages[message.channel.id]) {
              state.messages[message.channel.id].messages.push(message);
            } else {
              state.messages[message.channel.id] = { messages: [message], hasEveryMessage: false };
            }
            return state;
          });
        });
    });

    innerWs?.addEventListener('close', () => {
      console.warn('WebSocket connection closed, reconnecting');
      retryConnect(7_000);
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
      state.update((state) => {
        state.connected = false;
        return state;
      });
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
