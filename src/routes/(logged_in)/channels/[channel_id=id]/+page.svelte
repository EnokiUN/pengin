<script lang="ts">
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import userConfig from '$lib/user_config';
  import userData from '$lib/user_data';
  import activeContext from '$lib/context';
  import state from '$lib/ws';
  import { tick } from 'svelte';
  import { browser } from '$app/environment';
  import MessageInput from './MessageInput.svelte';
  import MessageComponent from './Message.svelte';
  import type { ClientMessage } from '$lib/types/ui/message';
  import type { User } from '$lib/types/user';
  import UserProfile from './UserProfile.svelte';
  import type { Unsubscriber } from 'svelte/store';
  import UserContext from './UserContext.svelte';
  import UsersBar from './UsersBar.svelte';
  import { request } from '$lib/request';
  import markdown from '$lib/markdown';
  import type { TextChannel } from '$lib/types/channel';
  import type { Sphere } from '$lib/types/sphere';
  import Thang from '$lib/components/Thang.svelte';

  let messagesUList: HTMLUListElement;
  let value = '';
  let input: HTMLTextAreaElement;
  let usernames: { [key: string]: number } = {};
  let channel_names: { [key: string]: number } = {};
  let currentProfile: number | undefined;
  let currentContext: number;
  let authorContext: User | undefined;
  let authorContextDiv: HTMLDivElement;
  let populatingMessages = false;
  let channel_id: number;
  let firstLoad = true;

  onMount(() => {
    messagesUList.scroll(0, messagesUList.scrollHeight);
    input.focus();
  });

  // TODO: handle channels not existing
  let sphere: Sphere;
  $: {
    firstLoad = true;
    channel_id = Number.parseInt($page.params.channel_id);
  }
  $: channel = $state.channels[channel_id] as TextChannel;
  $: if (channel) {
    sphere = $state.spheres[channel.sphere_id];
    $userConfig.lastChannel = channel.id;
  }
  $: users = Object.values($state.users).filter((u) =>
    sphere ? sphere.members.find((m) => m.user.id == u.id) != undefined : false
  );
  $: {
    usernames = {};
    users.forEach((u) => (usernames[u.username] = u.id));
  }
  $: {
    channel_names = {};
    sphere.categories.forEach((cat) => {
      cat.channels.forEach((chan) => {
        channel_names[chan.name] = chan.id;
      });
    });
  }
  $: messageHistory = channel
    ? ($state.messages[channel.id] ?? { messages: [], hasEveryMessage: false })
    : { messages: [], hasEveryMessage: false }; // assigning it to a variable makes it break (idk why)
  $: if (!messageHistory.messages.length) {
    populateMessages();
  } else {
    if (firstLoad) {
      tick().then(() => messagesUList?.scroll(0, messagesUList.scrollHeight));
      firstLoad = false;
    }
  }

  const populateMessages = (before: Number | null = null) => {
    if (populatingMessages || messageHistory.hasEveryMessage || !channel) return;
    populatingMessages = true;
    let lastAuthorID: number | null = null;
    let lastAuthorData: { name: string; avatar: string | number | undefined } | null = null;
    let fetchedMessages: ClientMessage[] = [];
    if (!$state.messages[channel.id]) {
      $state.messages[channel.id] = { messages: [], hasEveryMessage: false };
    }
    request('GET', `channels/${channel.id}/messages?before=${before}`).then(async (data) => {
      for (let i = 0; i < data.length; i++) {
        let m = data[i];
        let content = await markdown(m.content ?? '');
        const authorData = {
          name: m._disguise?.name ?? m.author.display_name ?? m.author.username,
          avatar: m._disguise?.avatar ?? m.author.avatar
        };
        let sameData =
          authorData.name == lastAuthorData?.name && authorData.avatar == lastAuthorData?.avatar;
        const message = {
          renderedContent: content,
          showAuthor: !sameData || m.author.id != lastAuthorID,
          mentioned: new RegExp(`(?<!\\\\)<@${$userData?.user.id}>`, 'gm').test(m.content ?? ''),
          ...m
        };
        lastAuthorData = authorData;
        lastAuthorID = m.author.id;
        fetchedMessages.push(message);
      }
      if (fetchedMessages.length < 50) {
        messageHistory.hasEveryMessage = true;
      }
      if (fetchedMessages.length) {
        state.update((s) => {
          if (s.messages[channel_id]?.messages.length) {
            let lastMessage = s.messages[channel_id].messages[0]!;
            lastAuthorID = lastMessage.id;
            lastAuthorData = {
              name:
                lastMessage._disguise?.name ??
                lastMessage.author.display_name ??
                lastMessage.author.username,
              avatar: lastMessage._disguise?.avatar ?? lastMessage.author.avatar
            };
            let firstFetchedMessage = fetchedMessages.at(-1)!;
            if (
              lastMessage.author.id == firstFetchedMessage.author.id &&
              (lastMessage._disguise?.name ??
                lastMessage.author.display_name ??
                lastMessage.author.username) ==
                (firstFetchedMessage._disguise?.name ??
                  firstFetchedMessage.author.display_name ??
                  firstFetchedMessage.author.username) &&
              (lastMessage._disguise?.avatar ?? lastMessage.author.avatar) ==
                (firstFetchedMessage._disguise?.avatar ?? firstFetchedMessage.author.avatar)
            )
              lastMessage.showAuthor = false;
          }
          s.messages[channel.id].messages = [
            ...fetchedMessages,
            ...($state.messages[channel.id].messages ?? [])
          ];
          s.messages[channel.id].hasEveryMessage = messageHistory.hasEveryMessage;
          return s;
        });
      }
      populatingMessages = false;
    });
  };

  $: if ($state.connected) {
    let scroll =
      messagesUList &&
      messagesUList.scrollHeight - messagesUList.offsetHeight - messagesUList.scrollTop <
        window.outerHeight / 4;
    tick().then(() => {
      if (scroll) messagesUList?.scroll(0, messagesUList.scrollHeight);
    });
  }

  const autoScroll = async () => {
    if (!browser) return;
    await tick();
    if (
      messagesUList.scrollHeight - messagesUList.offsetHeight - messagesUList.scrollTop <
      window.outerHeight / 4
    )
      messagesUList.scroll(0, messagesUList.scrollHeight);
  };

  const onReply = async (e: CustomEvent<ClientMessage>) => {
    const start = input.selectionStart;
    const end = input.selectionEnd;

    const reply = `${value.trim() ? '\n' : ''}${(e.detail.content ?? '')
      .split('\n')
      .map((l) => `> ${l}`)
      .join('\n')}\n@${e.detail._disguise?.name ?? e.detail.author.username}\n\n`;
    value = value.substring(0, start) + reply + value.substring(end);
    await tick();

    input.selectionStart = input.selectionEnd = start + reply.length;

    input.focus();
  };

  const onMention = async (e: CustomEvent<User>) => {
    const start = input.selectionStart;
    const end = input.selectionEnd;

    const mention = `@${e.detail.username}`;
    value = value.substring(0, start) + mention + value.substring(end);
    await tick();

    input.selectionStart = input.selectionEnd = start + mention.length;

    input.focus();
  };

  const windowKeyDown = (e: KeyboardEvent) => {
    if (e.key == 'u' && e.ctrlKey) {
      $userConfig.userList = !$userConfig.userList;
      e.preventDefault();
    }
  };

  let touchX = 0;

  const windowTouchStart = (e: TouchEvent) => {
    touchX = e.touches[0].clientX;
  };

  const windowTouchMove = (e: TouchEvent) => {
    let screenWidth = window.screen.width;
    if (screenWidth > 1000) return;
    let touchEndX = e.touches[0].clientX;
    let diff = touchX - touchEndX;
    if (Math.abs(touchX - touchEndX) > screenWidth / 5) {
      if (diff > 0) {
        if ($userConfig.userList) {
          $userConfig.userList = false;
        }
      } else {
        if (!$userConfig.userList) {
          $userConfig.userList = true;
        }
      }
    }
  };

  const showProfile = (id: number) => {
    currentProfile = id;
  };

  const userContextFromEvent = async (e: CustomEvent<{ event: MouseEvent; user: User }>) => {
    await userContext(e.detail.event, e.detail.user);
  };

  const userContext = async (e: MouseEvent, user: User) => {
    $activeContext = $activeContext + 1;
    currentContext = $activeContext;
    let unsubscribe: Unsubscriber;
    unsubscribe = activeContext.subscribe((id) => {
      if (id != currentContext) {
        authorContext = undefined;
        unsubscribe();
      }
    });
    authorContext = user;
    await tick();
    positionContextDiv(e, authorContextDiv);
  };

  const positionContextDiv = (e: MouseEvent, div: HTMLDivElement) => {
    if (div.clientHeight + e.clientY < window.innerHeight) {
      div.style.top = `${e.clientY}px`;
      div.style.bottom = `auto`;
    } else {
      div.style.bottom = `${window.innerHeight - e.clientY}px`;
      div.style.top = `auto`;
    }
    if (div.clientWidth + e.clientX < window.innerWidth) {
      div.style.left = `${e.clientX}px`;
      div.style.right = `auto`;
    } else {
      div.style.right = `${window.innerWidth - e.clientX}px`;
      div.style.left = `auto`;
    }
  };

  const showContextProfile = (e: CustomEvent<number>) => {
    showProfile(e.detail);
  };

  const closeContext = () => {
    authorContext = undefined;
  };

  const closeProfile = () => {
    currentProfile = undefined;
  };

  const messagesScroll = () => {
    if (messagesUList.scrollTop <= 200 && messageHistory.messages.length) {
      populateMessages(messageHistory.messages[0].id);
    }
  };
</script>

<svelte:window
  on:resize={autoScroll}
  on:keydown={windowKeyDown}
  on:touchstart={windowTouchStart}
  on:touchmove={windowTouchMove}
/>

<div id="message-channel">
  <div id="channel-view">
    <div id="message-channel-body" class={$userConfig.userList ? 'users-hidden' : ''}>
      <ul bind:this={messagesUList} on:scroll={messagesScroll} id="messages">
        {#if messageHistory.hasEveryMessage}
          <h2 id="channel-start-header">Welcome to {channel.name}!</h2>
          <hr id="channel-start-separator" />
        {/if}
        {#if messageHistory.messages.length}
          {#each messageHistory.messages as message (message.id)}
            <MessageComponent
              {message}
              on:reply={onReply}
              on:showProfile={showContextProfile}
              on:mention={onMention}
            />
          {/each}
        {:else}
          <div id="loading">
            <Thang animate={true} />
            <p id="loading-text">Loading messages...</p>
          </div>
        {/if}
      </ul>
      <MessageInput
        channel_id={channel?.id}
        bind:input
        bind:value
        bind:usernames
        bind:channel_names
        {sphere}
        {messagesUList}
      />
    </div>
    {#if !$userConfig.userList}
      <UsersBar
        {users}
        {channel}
        on:showProfile={showContextProfile}
        on:userContext={userContextFromEvent}
      />
    {/if}
    {#if authorContext}
      <UserContext
        user={authorContext}
        bind:contextDiv={authorContextDiv}
        on:close={closeContext}
        on:showProfile={showContextProfile}
        on:mention={onMention}
      />
    {/if}
  </div>
</div>

{#if currentProfile !== undefined}
  <UserProfile user={$state.users[currentProfile]} on:close={closeProfile} />
{/if}

<style>
  #message-channel {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  #channel-view {
    display: flex;
    flex-grow: 1;
    overflow-y: hidden;
  }

  #message-channel-body {
    display: flex;
    flex-direction: column;
    width: calc(100% - 320px);
  }

  #message-channel-body.users-hidden {
    width: 100%;
  }

  :global(#message-channel-body.users-hidden) {
    width: 100% !important;
  }

  #messages {
    flex-grow: 1;
    padding: 10px;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 0;
    margin-top: 0;
    margin-bottom: 0; /* where is react native marginVertical when you need it? */
  }

  #channel-start-header {
    margin: 20px;
  }

  #channel-start-separator {
    margin: 20px;
  }

  #loading {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }

  #loading-text {
    font-size: 42px;
    font-weight: 500;
    color: var(--gray-600);
  }

  @media only screen and (max-width: 1200px) {
    #message-channel-body {
      width: 100%;
      position: relative;
    }
  }
</style>
