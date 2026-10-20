import type { ComponentType } from 'svelte';
import { Bell, MessageSquare, Webhook } from 'lucide-svelte';
import { siDiscord, siNtfy, siTelegram } from 'simple-icons';
import type { NotificationProviderType } from '$shared/notifications/providers';

/** Either a simple-icons SVG path or a lucide component. */
export type ProviderIcon = { kind: 'svg'; path: string } | { kind: 'component'; component: ComponentType };

const providerIcons: Record<NotificationProviderType, ProviderIcon> = {
  discord: { kind: 'svg', path: siDiscord.path },
  webhook: { kind: 'component', component: Webhook },
  ntfy: { kind: 'svg', path: siNtfy.path },
  gotify: { kind: 'component', component: Bell },
  pushover: { kind: 'component', component: Bell },
  telegram: { kind: 'svg', path: siTelegram.path },
  slack: { kind: 'component', component: MessageSquare },
  apprise: { kind: 'component', component: Bell },
};

const fallbackIcon: ProviderIcon = { kind: 'component', component: Bell };

export function getProviderIcon(type: string): ProviderIcon {
  return (providerIcons as Record<string, ProviderIcon | undefined>)[type] ?? fallbackIcon;
}
