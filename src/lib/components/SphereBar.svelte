<script lang="ts">
  import { slide, type SlideParams } from 'svelte/transition';
  import { page } from '$app/stores';
  import state from '$lib/ws';
  import userConfig from '$lib/user_config';
  import userData from '$lib/user_data';
  import type { Sphere } from '$lib/types/sphere';
  import type { Category } from '$lib/types/category';
  import { SphereChannelType, type Channel } from '$lib/types/channel';

  let currentSphere: Sphere | null = null;
  let currentChannel: Channel | null = null;

  let spheres: Sphere[] = Object.values($state.spheres ?? []);
  $: {
    currentChannel = $state.channels[Number.parseInt($page.params.channel_id)];
    if (
      currentChannel &&
      (currentChannel.type == SphereChannelType.TEXT ||
        currentChannel.type == SphereChannelType.VOICE)
    ) {
      currentSphere = $state.spheres[currentChannel.sphere_id];
    } else {
      currentSphere = null;
    }
  }

  const sphereContext = (e: MouseEvent, sphere: Sphere) => {};

  // this gets a bit screwed up on pc so we just limit it and call it conforming to discord xd
  const phoneSlide = (node: HTMLElement, params?: SlideParams | undefined) => {
    if (window.screen.width > 1000) return { duration: 0 };
    return slide(node, params);
  };

  const toggleCategory = (e: Event, c: Category) => {
    if ((e as ToggleEvent).newState == 'closed') {
      if ($userConfig.hiddenCategories) {
        $userConfig.hiddenCategories?.push(c.id);
      } else {
        $userConfig.hiddenCategories = [c.id];
      }
    } else {
      let index = $userConfig.hiddenCategories?.indexOf(c.id) ?? -1;
      if (index >= 0) $userConfig.hiddenCategories!.splice(index, 1);
    }

    $userConfig = $userConfig;
  };
</script>

<div id="sphere-bar" style:width={currentSphere ? '300px' : 'auto'}>
  <ul id="spheres" transition:phoneSlide={{ axis: 'x' }}>
    {#each spheres as sphere (sphere.id)}
      <a
        href="/channels/{sphere.categories[0].channels[0].id}"
        class="sphere {currentSphere?.id == sphere.id ? 'current' : ''}"
      >
        <img
          class="sphere-icon"
          src={sphere.icon
            ? `${$userData?.instanceInfo.effis_url}/sphere-icons/${sphere.icon}`
            : ''}
          alt={sphere.slug}
        />
      </a>
    {/each}
  </ul>
  {#if currentSphere}
    <div id="sphere-channels">
      {#if currentSphere.banner}
        <img
          id="sphere-banner"
          src="{$userData?.instanceInfo.effis_url}/sphere-banners/{currentSphere.banner}"
          alt="{currentSphere.slug}'s banner"
        />
      {/if}
      <h3 id="sphere-name">{currentSphere.name ?? currentSphere.slug}</h3>
      <hr />
      <ul id="sphere-channel-list">
        {#each currentSphere.categories[0].channels as channel (channel.id)}
          <a
            href="/channels/{channel.id}"
            class={`channel${channel == currentChannel ? ' current' : ''}`}
          >
            # {channel.name}
          </a>
        {/each}
        {#each currentSphere.categories.slice(1) as category (category.id)}
          <details
            class="category"
            open={!$userConfig.hiddenCategories?.includes(category.id)}
            on:toggle={(e) => toggleCategory(e, category)}
          >
            <summary class="category-name">{category.name}</summary>
            {#if !category.collapsed}
              {#each category.channels as channel (channel.id)}
                <a
                  href="/channels/{channel.id}"
                  class={`channel${channel == currentChannel ? ' current' : ''}`}
                >
                  # {channel.name}
                </a>
              {/each}
            {/if}
          </details>
        {/each}
      </ul>
    </div>
  {/if}
</div>

<style>
  #sphere-bar {
    max-width: 300px;
    display: flex;
    flex-shrink: 0;
    margin: 0;
    background-color: var(--purple-200);
    overflow-y: auto;
  }

  hr {
    width: calc(100% - 5px);
  }

  #sphere-bar ul {
    display: flex;
    margin: 0;
    padding: 10px 10px;
    flex-direction: column;
  }

  #spheres {
    background-color: var(--purple-100);
  }

  .sphere {
    cursor: pointer;
    padding: 10px 0;
  }

  .sphere-icon {
    width: 50px;
    height: 50px;
    object-fit: cover;
    border-radius: 100%;
    transition: border-radius ease-in-out 125ms;
  }

  .current .sphere-icon,
  .sphere:hover .sphere-icon {
    border-radius: 25%;
  }

  #sphere-channels {
    flex-grow: 1;
  }

  #sphere-channel-list,
  #sphere-name {
    margin: 5px;
  }

  #sphere-channels h3 {
    margin-bottom: 0;
  }

  .category {
    margin: 10px 0;
    user-select: none;
    display: flex;
    flex-direction: column;
  }

  .category summary {
    margin: 0;
  }

  .category-name {
    color: var(--color-text);
    cursor: pointer;
    padding: 5px;
    border-radius: 5px;
  }

  .category-name:hover {
    background-color: var(--purple-300);
  }

  .channel {
    padding: 5px;
    margin: 2px;
    border-radius: 5px;
    text-decoration: none;
  }

  .channel:hover {
    color: var(--gray-600);
    background-color: var(--purple-300);
  }

  .channel.current {
    color: var(--gray-600);
    background-color: var(--purple-400);
  }

  #sphere-banner {
    width: 100%;
    height: 115px;
    object-fit: cover;
  }

  @media only screen and (max-width: 1200px) {
    #users {
      position: absolute;
      width: min(80%, 300px);
      right: 0;
      height: calc(100% - 60px);
      box-sizing: border-box;
    }
  }
</style>
