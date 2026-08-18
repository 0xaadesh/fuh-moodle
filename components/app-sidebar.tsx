"use client"

import * as React from "react"
import Image from "next/image"

import { ConnectionStatus, type ConnectionState } from "@/components/connection-status"
import { LogoutButton } from "@/components/logout-button"
import { MoodleConfigForm } from "@/components/moodle-config-form"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import type { Creds } from "@/lib/types"

/** Two-letter initials, as in the original sidebar avatar. */
function initials(username: string): string {
  const cleaned = username.trim()
  if (!cleaned) return "??"
  const parts = cleaned.split(/[\s._-]+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return cleaned.slice(0, 2).toUpperCase()
}

/** `https://moodle.example.edu/` -> `moodle.example.edu` */
function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url || "Not configured"
  }
}

export function AppSidebar({
  credentials,
  connection,
  onSave,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  credentials: Creds
  connection: ConnectionState
  onSave: (creds: Creds) => void
}) {
  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              className="data-[slot=sidebar-menu-button]:p-1.5!"
            >
              <Image
                src="/favicon-96x96.png"
                alt=""
                width={96}
                height={96}
                className="size-5! rounded-sm"
                priority
              />
              <span className="text-base font-semibold">fuh-moodle</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Connection</SidebarGroupLabel>
          <SidebarGroupContent className="flex flex-col gap-3 px-2">
            <ConnectionStatus state={connection} />
            <p className="truncate font-mono text-xs text-muted-foreground">
              {hostOf(credentials.moodleUrl)}
            </p>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Configuration</SidebarGroupLabel>
          <SidebarGroupContent className="px-2 py-2">
            <MoodleConfigForm credentials={credentials} onSave={onSave} />
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <LogoutButton />
        <Item size="sm" variant="muted">
          <ItemMedia>
            <Avatar className="size-8">
              <AvatarFallback>{initials(credentials.username)}</AvatarFallback>
            </Avatar>
          </ItemMedia>
          <ItemContent>
            <ItemTitle>{credentials.username || "No user"}</ItemTitle>
            <ItemDescription>Signed in via Moodle login form</ItemDescription>
          </ItemContent>
        </Item>
      </SidebarFooter>
    </Sidebar>
  )
}
