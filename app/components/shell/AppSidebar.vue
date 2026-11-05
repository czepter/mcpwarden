<script setup lang="ts">
import { ChevronsUpDown, LogOut, PanelLeft } from '@lucide/vue'
import { navFor, NAV_SETTINGS, isActive } from '~/lib/nav'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '~/components/ui/dropdown-menu'
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem, SidebarSeparator, useSidebar } from '~/components/ui/sidebar'

const { user, logout } = useSessionUser()
const route = useRoute()
const { count, refresh } = useAttentionCount()
const groups = computed(() => navFor(user.value?.role))
const { state, toggleSidebar, isMobile, setOpenMobile } = useSidebar()
const refreshRate = ref(30)
onMounted(refresh)
usePolling(refresh, refreshRate)
watch(() => route.path, () => setOpenMobile(false))
const initials = computed(() => (user.value?.name ?? '?').split(/\s+/).map(s => s[0]).join('').slice(0, 2).toUpperCase())
</script>

<template>
  <Sidebar collapsible="icon" aria-label="Seitenleiste">
    <SidebarHeader>
      <div class="flex min-h-12 items-center gap-2.5 px-1.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
        <div class="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary text-base font-bold text-primary-foreground" aria-hidden="true">m</div>
        <span class="text-[15px] font-bold tracking-tight group-data-[collapsible=icon]:hidden">mcpwarden</span>
      </div>
    </SidebarHeader>
    <SidebarContent>
      <nav aria-label="Hauptnavigation" class="flex min-h-0 flex-1 flex-col">
        <SidebarGroup v-for="g in groups" :key="g.label ?? ''">
          <SidebarGroupLabel class="text-[11px] font-semibold tracking-[0.04em] text-muted-foreground uppercase group-data-[collapsible=icon]:hidden">{{ g.label }}</SidebarGroupLabel>
          <SidebarSeparator class="hidden group-data-[collapsible=icon]:block" />
          <SidebarMenu>
            <SidebarMenuItem v-for="item in g.items" :key="item.to">
              <SidebarMenuButton as-child :is-active="isActive(item, route.path)" :tooltip="item.label" class="data-[active=true]:bg-primary data-[active=true]:text-primary-foreground">
                <NuxtLink :to="item.to" :aria-label="item.label" :aria-current="isActive(item, route.path) ? 'page' : undefined">
                  <component :is="item.icon" aria-hidden="true" />
                  <span class="group-data-[collapsible=icon]:hidden">{{ item.label }}</span>
                  <template v-if="item.badge === 'attention' && count > 0">
                    <SidebarMenuBadge class="bg-nav-badge text-white text-[11px] font-semibold group-data-[collapsible=icon]:hidden" data-testid="nav-badge">{{ count }}</SidebarMenuBadge>
                    <span class="absolute top-2 right-2.5 hidden size-2 rounded-full bg-nav-badge group-data-[collapsible=icon]:block" aria-hidden="true" />
                    <span class="sr-only hidden group-data-[collapsible=icon]:inline">({{ count }} brauchen Aufmerksamkeit)</span>
                  </template>
                </NuxtLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
        <div class="flex-1" />
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton as-child :is-active="isActive(NAV_SETTINGS, route.path)" :tooltip="NAV_SETTINGS.label" class="data-[active=true]:bg-primary data-[active=true]:text-primary-foreground">
                <NuxtLink :to="NAV_SETTINGS.to" :aria-label="NAV_SETTINGS.label" :aria-current="isActive(NAV_SETTINGS, route.path) ? 'page' : undefined">
                  <component :is="NAV_SETTINGS.icon" aria-hidden="true" />
                  <span class="group-data-[collapsible=icon]:hidden">{{ NAV_SETTINGS.label }}</span>
                </NuxtLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </nav>
    </SidebarContent>
    <SidebarFooter>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <button type="button" class="flex min-h-[52px] w-full items-center gap-2.5 rounded-sm px-1.5 text-left hover:bg-sidebar-accent group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0" aria-label="Benutzermenü" data-testid="user-menu">
            <span class="flex size-8 shrink-0 items-center justify-center rounded-full bg-border text-xs font-semibold text-avatar-fg" aria-hidden="true">{{ initials }}</span>
            <span class="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
              <span class="block text-[13px] font-semibold">{{ user?.name }}</span>
              <span class="block truncate text-xs text-muted-foreground">{{ user?.email }}</span>
            </span>
            <ChevronsUpDown class="size-4 group-data-[collapsible=icon]:hidden" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" class="w-56">
          <DropdownMenuItem as-child><NuxtLink to="/settings">Einstellungen</NuxtLink></DropdownMenuItem>
          <DropdownMenuItem data-testid="logout" @select="logout"><LogOut class="size-4" aria-hidden="true" />Abmelden</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        v-if="!isMobile" type="button" class="flex min-h-11 w-full items-center gap-2.5 rounded-sm px-2.5 text-sm font-medium text-secondary-foreground hover:bg-sidebar-accent group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
        :aria-label="state === 'collapsed' ? 'Seitenleiste ausklappen' : 'Seitenleiste einklappen'" :title="state === 'collapsed' ? 'Seitenleiste ausklappen' : 'Seitenleiste einklappen'" data-testid="collapse" @click="toggleSidebar"
      >
        <PanelLeft class="size-5" aria-hidden="true" />
        <span class="group-data-[collapsible=icon]:hidden">Einklappen</span>
      </button>
    </SidebarFooter>
  </Sidebar>
</template>
