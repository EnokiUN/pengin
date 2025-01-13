<script lang="ts">
  import { afterUpdate, onMount, tick } from 'svelte';
  import state from '$lib/ws';
  import Markdown from '$lib/components/Markdown.svelte';
  import userData from '$lib/user_data';
  import userConfig from '$lib/user_config';
  import { request } from '$lib/request';
  import { emojiDictionary, toUrl, EMOJI_REGEX } from '$lib/emoji';
  import type { Sphere } from '$lib/types/sphere';
  import { SphereChannelType } from '$lib/types/channel';

  export let channel_id: number;
  export let sphere: Sphere;
  export let value = '';
  export let input: HTMLTextAreaElement;
  export let messagesUList: HTMLElement;
  export let usernames: { [key: string]: number };
  export let channel_names: { [key: string]: number };
  let mobile = false;
  let previewMessage = false;

  type AutocompleteItem = {
    name: string;
    value: string;
    image: string | null;
  };

  let activeAutocompleter: Autocompleter | null = null;
  let autocompleteWindow: HTMLDivElement | null = null;
  const MAX_SUGGESTIONS = 10;

  class Autocompleter {
    matcher: RegExp;
    delimiter: string;
    options: {
      name: string;
      value: string;
      image: string | null;
    }[];
    html_class: string;
    selectedIndex: number | null = null;
    selectedElement: HTMLButtonElement | null = null;
    optionProvider: (optionMatcher: RegExp) => AutocompleteItem[];

    constructor(
      matcher: RegExp,
      delimiter: string,
      html_class: string,
      optionProvider: (optionMatcher: RegExp) => AutocompleteItem[]
    ) {
      this.matcher = matcher;
      this.delimiter = delimiter;
      this.options = new Array();
      this.html_class = html_class;
      this.optionProvider = optionProvider;
    }

    async autocomplete(input: string): Promise<boolean> {
      let matches = input.match(this.matcher);

      if (matches) {
        activeAutocompleter = this;
        this.options = this.optionProvider(new RegExp(`^${matches[1]}`, 'i'));
        if (this.options.length > 0) {
          await tick(); // Wait for activeAutocompleter window to pop up.

          this.selectedIndex = 0;
          this.selectedElement = autocompleteWindow?.firstElementChild as HTMLButtonElement | null;
          return true;
        }
      }

      activeAutocompleter = null;
      return false;
    }
  }

  const emojiAutocompleter = new Autocompleter(
    /(?<=:)([a-zA-Z0-9_-]{2,})$/,
    ':',
    'emoji-autocomplete',
    (optionMatcher: RegExp) => {
      let options: AutocompleteItem[] = new Array();

      $userConfig.recentEmojis?.forEach((emoji) => {
        if (optionMatcher.test(emoji)) {
          options.push({
            name: emoji,
            value: emoji,
            image: toUrl(emoji)
          });
        }
      });

      for (let emojiName of Object.keys(emojiDictionary)) {
        if (options.find((e) => e.name == emojiName)) continue;

        if (optionMatcher.test(emojiName)) {
          options.push({
            name: emojiName,
            value: emojiName,
            image: toUrl(emojiName)
          });
        }

        if (options.length >= MAX_SUGGESTIONS) break;
      }

      return options;
    }
  );

  const memberAutocompleter = new Autocompleter(
    /(?<=@)([a-zA-Z0-9_-]*)$/,
    ' ',
    'member-autocomplete',
    (optionMatcher: RegExp) => {
      let options: AutocompleteItem[] = new Array();

      for (let member of sphere.members) {
        if (
          (member.nickname && optionMatcher.test(member.nickname)) ||
          (member.user.display_name && optionMatcher.test(member.user.display_name)) ||
          (member && optionMatcher.test(member.user.username))
        ) {
          options.push({
            name: `@${member.nickname ?? member.user.display_name ?? member.user.username}`,
            value: member.user.username,
            image: member.user.avatar
              ? `${$userData?.instanceInfo.effis_url}/avatars/${member.user.avatar}`
              : 'https://github.com/eludris/.github/blob/main/assets/thang-big.png?raw=true'
          });

          if (options.length >= MAX_SUGGESTIONS) break;
        }
      }

      return options;
    }
  );

  const channelAutocompleter = new Autocompleter(
    /(?<=#)([a-zA-Z0-9_-]*)$/,
    ' ',
    'channel-autocomplete',
    (optionMatcher: RegExp) => {
      let options: AutocompleteItem[] = new Array();

      for (let category of sphere.categories) {
        for (let channel of category.channels) {
          if (optionMatcher.test(channel.name)) {
            options.push({
              name: `#${channel.name}`,
              value: channel.name,
              image: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0Ij48cGF0aCBmaWxsPSJjdXJyZW50Q29sb3IiIGQ9Im01LjQxIDIxbC43MS00aC00bC4zNS0yaDRsMS4wNi02aC00bC4zNS0yaDRsLjcxLTRoMmwtLjcxIDRoNmwuNzEtNGgybC0uNzEgNGg0bC0uMzUgMmgtNGwtMS4wNiA2aDRsLS4zNSAyaC00bC0uNzEgNGgtMmwuNzEtNGgtNmwtLjcxIDR6TTkuNTMgOWwtMS4wNiA2aDZsMS4wNi02eiIvPjwvc3ZnPg=='
            });

            if (options.length >= MAX_SUGGESTIONS) return options;
          }
        }
      }

      return options;
    }
  );

  const preprocess = (message: string): string => {
    if (message.startsWith('/shrug')) {
      message = message.substring(7) + ' ¯\\\\\\_(ツ)_/¯';
    }

    return message
      .replace(/@([a-z0-9_-]+)/gm, (m, username) => {
        let id = usernames[username];
        if (id != undefined) {
          return `<@${id}>`;
        } else {
          return m;
        }
      })
      .replace(/#([a-z0-9_-]+)/gm, (m, channel) => {
        let id = channel_names[channel];
        if (id != undefined) {
          return `<#${id}>`;
        } else {
          return m;
        }
      });
  };

  const onSubmit = async () => {
    if (value.trim()) {
      value = preprocess(value);

      let headers = new Headers();
      headers.set('Authorization', $userData!.session.token);
      request('POST', `/channels/${channel_id}/messages`, { content: value }).then((_) =>
        messagesUList.scroll(0, messagesUList.scrollHeight)
      );
    }

    let usedEmojis = value.match(EMOJI_REGEX)?.map((m) => m.slice(1, -1)) ?? [];
    if ($userConfig.recentEmojis) {
      for (let i = 0; i < usedEmojis.length; i++) {
        let emoji = usedEmojis[i];
        $userConfig.recentEmojis = $userConfig.recentEmojis.filter((e) => e != emoji);
        $userConfig.recentEmojis.unshift(emoji);
        $userConfig.recentEmojis = $userConfig.recentEmojis;
      }
    } else {
      $userConfig.recentEmojis = usedEmojis;
    }

    value = '';
    previewMessage = false;
    activeAutocompleter = null;
    await tick();
    input?.focus(); // for mobiles
  };

  const submitFiles = async (files: DataTransferItemList) => {
    let fileDatas = [];
    for (let i = 0; i < files.length; i++) {
      if (files[i].kind == 'file') {
        const file = files[i].getAsFile()!;
        let formData = new FormData();
        formData.append('file', file, file.name);
        const data = await fetch($userData?.instanceInfo.effis_url!, {
          body: formData,
          method: 'POST'
        }).then((r) => r.json());
        fileDatas.push(data);
      }
    }
    let effisUrl = $userData?.instanceInfo.effis_url;
    if (!effisUrl?.endsWith('/')) {
      effisUrl += '/';
    }
    request('POST', `/channels/${channel_id}/messages`, {
      content: fileDatas.map((d) => `![${d.name}](${effisUrl}${d.id})`).join('\n')
    }).then((_) => messagesUList.scroll(0, messagesUList.scrollHeight));
    await tick();
    input?.focus(); // for mobiles
  };

  onMount(() => {
    if (
      /(android|bb\d+|meego).+mobile|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od)|iris|kindle|lge |maemo|midp|mmp|mobile.+firefox|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series(4|6)0|symbian|treo|up\.(browser|link)|vodafone|wap|windows ce|xda|xiino/i.test(
        navigator.userAgent
      ) ||
      /1207|6310|6590|3gso|4thp|50[1-6]i|770s|802s|a wa|abac|ac(er|oo|s-)|ai(ko|rn)|al(av|ca|co)|amoi|an(ex|ny|yw)|aptu|ar(ch|go)|as(te|us)|attw|au(di|-m|r |s )|avan|be(ck|ll|nq)|bi(lb|rd)|bl(ac|az)|br(e|v)w|bumb|bw-(n|u)|c55\/|capi|ccwa|cdm-|cell|chtm|cldc|cmd-|co(mp|nd)|craw|da(it|ll|ng)|dbte|dc-s|devi|dica|dmob|do(c|p)o|ds(12|-d)|el(49|ai)|em(l2|ul)|er(ic|k0)|esl8|ez([4-7]0|os|wa|ze)|fetc|fly(-|_)|g1 u|g560|gene|gf-5|g-mo|go(\.w|od)|gr(ad|un)|haie|hcit|hd-(m|p|t)|hei-|hi(pt|ta)|hp( i|ip)|hs-c|ht(c(-| |_|a|g|p|s|t)|tp)|hu(aw|tc)|i-(20|go|ma)|i230|iac( |-|\/)|ibro|idea|ig01|ikom|im1k|inno|ipaq|iris|ja(t|v)a|jbro|jemu|jigs|kddi|keji|kgt( |\/)|klon|kpt |kwc-|kyo(c|k)|le(no|xi)|lg( g|\/(k|l|u)|50|54|-[a-w])|libw|lynx|m1-w|m3ga|m50\/|ma(te|ui|xo)|mc(01|21|ca)|m-cr|me(rc|ri)|mi(o8|oa|ts)|mmef|mo(01|02|bi|de|do|t(-| |o|v)|zz)|mt(50|p1|v )|mwbp|mywa|n10[0-2]|n20[2-3]|n30(0|2)|n50(0|2|5)|n7(0(0|1)|10)|ne((c|m)-|on|tf|wf|wg|wt)|nok(6|i)|nzph|o2im|op(ti|wv)|oran|owg1|p800|pan(a|d|t)|pdxg|pg(13|-([1-8]|c))|phil|pire|pl(ay|uc)|pn-2|po(ck|rt|se)|prox|psio|pt-g|qa-a|qc(07|12|21|32|60|-[2-7]|i-)|qtek|r380|r600|raks|rim9|ro(ve|zo)|s55\/|sa(ge|ma|mm|ms|ny|va)|sc(01|h-|oo|p-)|sdk\/|se(c(-|0|1)|47|mc|nd|ri)|sgh-|shar|sie(-|m)|sk-0|sl(45|id)|sm(al|ar|b3|it|t5)|so(ft|ny)|sp(01|h-|v-|v )|sy(01|mb)|t2(18|50)|t6(00|10|18)|ta(gt|lk)|tcl-|tdg-|tel(i|m)|tim-|t-mo|to(pl|sh)|ts(70|m-|m3|m5)|tx-9|up(\.b|g1|si)|utst|v400|v750|veri|vi(rg|te)|vk(40|5[0-3]|-v)|vm40|voda|vulc|vx(52|53|60|61|70|80|81|83|85|98)|w3c(-| )|webc|whit|wi(g |nc|nw)|wmlb|wonu|x700|yas-|your|zeto|zte-/i.test(
        navigator.userAgent.substring(0, 4)
      )
    ) {
      mobile = true;
    }
  });

  afterUpdate(() => {
    if (messagesUList && !previewMessage) {
      let scroll =
        messagesUList.scrollHeight - messagesUList.offsetHeight - messagesUList.scrollTop <= 10;
      input.style.height = '1px'; // we do this to avoid it getting incrementally bigger with every press
      input.style.height = `${Math.min(
        Math.max(26, input.scrollHeight),
        window.innerHeight / 3
      )}px`;
      if (scroll) messagesUList.scroll(0, messagesUList.scrollHeight);
    }
  });

  const togglePreviewMessage = () => {
    previewMessage = !previewMessage;
  };

  const previewButtonKeyDown = (e: KeyboardEvent) => {
    if (e.key == 'Enter') {
      onSubmit();
    }
  };

  const onInputKeyPress = (e: KeyboardEvent) => {
    const preSelection = value.substring(0, input.selectionStart);

    if (
      e.key == 'Enter' &&
      !mobile &&
      !e.shiftKey &&
      (preSelection.split(/\n```\S?/gm).length + +preSelection.startsWith('```')) % 2 == 1 &&
      preSelection.split('$$').length % 2 == 1 &&
      value.trim().length > 0
    ) {
      onSubmit();
      e.preventDefault();
    }
  };

  const onInputKeyDown = async (e: KeyboardEvent) => {
    if (e.key == 'Tab' && value.substring(0, input.selectionStart).split('```').length % 2 == 0) {
      e.preventDefault();
      const start = input.selectionStart;
      const end = input.selectionEnd;

      value = value.substring(0, start) + '\t' + value.substring(end);
      await tick();
      input.selectionStart = input.selectionEnd = start + 1;
    }
    if ((e.key == 'ArrowDown' || e.key == 'ArrowUp') && activeAutocompleter) {
      e.preventDefault();
    }
  };

  const onWindowKeyDown = async (e: KeyboardEvent) => {
    if (e.key == 'p' && e.ctrlKey) {
      togglePreviewMessage();
      e.preventDefault();
      await tick();
      input?.focus();
    }
    if ((!e.ctrlKey || e.key == 'v') && !e.altKey && !e.metaKey) {
      if (e.key == 'Enter' && previewMessage) {
        onSubmit();
        e.preventDefault();
      }
      await tick();
      input?.focus();
    }
    if ((e.key == 'Tab' || e.key == 'Enter') && activeAutocompleter) {
      e.preventDefault();
      activeAutocompleter.selectedElement?.click();
      await tick();
      input?.focus();
    }
    if (e.key == 'ArrowDown' && activeAutocompleter) {
      if (activeAutocompleter.selectedElement?.nextElementSibling) {
        activeAutocompleter.selectedIndex!++;
        activeAutocompleter.selectedElement = activeAutocompleter.selectedElement
          .nextElementSibling as HTMLButtonElement | null;
      } else {
        activeAutocompleter.selectedIndex = 0;
        activeAutocompleter.selectedElement =
          autocompleteWindow?.firstElementChild as HTMLButtonElement | null;
      }
    }
    if (e.key == 'ArrowUp' && activeAutocompleter) {
      if (activeAutocompleter.selectedElement?.previousElementSibling) {
        activeAutocompleter.selectedIndex!--;
        activeAutocompleter.selectedElement = activeAutocompleter.selectedElement
          .previousElementSibling as HTMLButtonElement | null;
      } else {
        activeAutocompleter.selectedIndex = activeAutocompleter.options.length - 1;
        activeAutocompleter.selectedElement =
          autocompleteWindow?.lastElementChild as HTMLButtonElement | null;
      }
    }
  };

  const onPaste = (e: ClipboardEvent) => {
    if (e.clipboardData?.items.length) {
      for (let i = 0; i < e.clipboardData.items.length; i++) {
        if (e.clipboardData.items[i].kind == 'file') {
          submitFiles(e.clipboardData.items);
          e.preventDefault();
          break;
        }
      }
    }
  };

  const onSelectionChange = async () => {
    if (await emojiAutocompleter.autocomplete(value.slice(0, input.selectionStart))) {
      return;
    }
    if (await memberAutocompleter.autocomplete(value.slice(0, input.selectionStart))) {
      return;
    }
    if (await channelAutocompleter.autocomplete(value.slice(0, input.selectionStart))) {
      return;
    }
  };

  const autocomplete = async (itemName: string) => {
    if (activeAutocompleter === null) return;

    let cursorPos = input.selectionStart;
    let previewPart = value
      .slice(0, cursorPos)
      .replace(activeAutocompleter.matcher, `${itemName}${activeAutocompleter.delimiter}`);
    let remainder = value.slice(cursorPos);

    if (remainder && !/^\s+/.test(remainder)) {
      value = previewPart + ' ' + remainder;
    } else {
      value = previewPart + remainder;
    }

    activeAutocompleter = null;
    await tick(); // Wait for autocomplete window to disappear and input to update.

    input.selectionStart = input.selectionEnd = previewPart.length;
    input.focus();
  };

  const previewEntryHover = (i: number) => {
    if (activeAutocompleter === null) return;

    activeAutocompleter.selectedElement?.classList.remove('highlight');
    activeAutocompleter.selectedElement = autocompleteWindow?.children[i] as HTMLButtonElement;
    activeAutocompleter.selectedElement.classList.add('highlight');
    activeAutocompleter.selectedIndex = i;
  };
</script>

<svelte:window on:keydown={onWindowKeyDown} />

<form id="message-input-form" on:submit|preventDefault={onSubmit}>
  {#if previewMessage}
    <span id="markdown-wrapper">
      <Markdown content={preprocess(value)} />
    </span>
  {:else}
    <textarea
      bind:this={input}
      bind:value
      on:keypress={onInputKeyPress}
      on:keydown={onInputKeyDown}
      on:paste={onPaste}
      on:selectionchange={onSelectionChange}
      id="message-input"
      placeholder="Send a message to Eludris"
      autocomplete="off"
      spellcheck="true"
    />
  {/if}
  <button
    id="preview-button"
    class="input-button"
    class:toggled={previewMessage}
    on:click|preventDefault={togglePreviewMessage}
    on:keydown|preventDefault={previewButtonKeyDown}
  >
    <!--- https://icon-sets.iconify.design/mdi/eye/ --->
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"
      ><path
        fill="currentColor"
        d="M12 9a3 3 0 0 0-3 3a3 3 0 0 0 3 3a3 3 0 0 0 3-3a3 3 0 0 0-3-3m0 8a5 5 0 0 1-5-5a5 5 0 0 1 5-5a5 5 0 0 1 5 5a5 5 0 0 1-5 5m0-12.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5Z"
      /></svg
    >
  </button>
  <button id="send-button" class="input-button">
    <!--- https://icon-sets.iconify.design/mdi/send/ --->
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"
      ><path fill="currentColor" d="m2 21l21-9L2 3v7l15 2l-15 2v7Z" /></svg
    >
  </button>
  {#if activeAutocompleter?.options.length && activeAutocompleter?.options.length > 0}
    <div class="autocomplete-window" bind:this={autocompleteWindow}>
      {#each activeAutocompleter.options as item, i}
        <button
          class={`autocomplete-entry${activeAutocompleter?.selectedIndex == i ? ' highlight' : ''}`}
          type="button"
          on:click={() => autocomplete(item.value)}
          on:mouseenter={() => previewEntryHover(i)}
        >
          <img
            class="autocomplete-image {activeAutocompleter.html_class}"
            src={item.image}
            alt={item.name}
          />
          <div class="autocomplete-name {activeAutocompleter.html_class}">{item.name}</div>
          <div class="autocomplete-spacer {activeAutocompleter.html_class}" />
        </button>
      {/each}
    </div>
  {/if}
</form>

<style>
  .input-button {
    background: none;
    color: inherit;
    border: none;
    margin: 3px 5px 3px 0;
    font-size: inherit;
    transition: color ease-in-out 125ms;
    height: 32px;
    padding-top: 6px;
  }

  .input-button:hover {
    color: var(--gray-500);
  }

  #preview-button.toggled {
    color: var(--pink-400);
  }

  #preview-button.toggled:hover {
    color: var(--pink-600);
  }

  #message-input {
    flex-grow: 1;
    background: none;
    color: inherit;
    font-size: inherit;
    border: none;
    height: 26px;
    overflow-y: auto;
    margin: 10px 0 3px 5px;
    overflow-wrap: break-word;
    word-break: break-word;
    white-space: pre-wrap;
    user-select: text;
    outline: none;
    resize: none;
    font-family: inherit;
  }

  #message-input-form {
    width: calc(100% - 10px);
    display: flex;
    background-color: var(--gray-200);
    color: var(--gray-600);
    padding: 2px;
    margin: 0 5px 10px 5px;
    font-size: 18px;
    height: auto;
    border-radius: 10px;
    position: relative;
    box-sizing: border-box;
  }

  #markdown-wrapper {
    flex-grow: 1;
    overflow-y: auto;
    margin: 10px 0 3px 5px;
    max-height: 33vh;
    display: inline-block;
  }

  .autocomplete-window {
    position: absolute;
    display: flex;
    flex-direction: column;
    position: absolute;
    bottom: 100%;
    left: 0px;
    display: flex;
    align-items: center;
    justify-content: center;
    max-height: 800px;
    width: 100%;
    background-color: var(--gray-200);
    border-radius: 10px;
    margin-bottom: 10px;
    padding: 10px;
    box-sizing: border-box;
  }

  .autocomplete-entry {
    color: var(--gray-600);
    display: flex;
    flex-direction: row;
    height: 30px;
    width: 100%;
    background: none;
    border: none;
  }

  .autocomplete-entry.highlight {
    background-color: var(--purple-400);
    border-radius: 5px;
  }

  .autocomplete-image {
    display: flex;
    flex-direction: row;
    width: 30px;
    object-fit: contain;
    margin-right: 1em;
  }

  .autocomplete-image.member-autocomplete {
    border-radius: 100%;
  }

  .autocomplete-name {
    display: flex;
    align-items: center;
    font-size: 14px;
    white-space: nowrap;
  }

  .autocomplete-spacer {
    flex-grow: 1;
    width: 100%;
  }
</style>
