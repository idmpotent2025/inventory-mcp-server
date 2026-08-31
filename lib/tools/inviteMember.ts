import { z } from 'zod'
import { buildOpenFgaClient } from '@auth0/ai'
import { addMember } from '@/lib/members'
import type { MCPToolContext } from './types'

export const inviteMemberSchema = z.object({
  name: z.string().describe('Full name of the member to invite'),
  email: z.string().email().describe('Email address of the member to invite'),
  role: z.enum(['editor', 'viewer']).describe('Role to assign to the new member'),
})

export type InviteMemberInput = z.infer<typeof inviteMemberSchema>

/**
 * Executes the inviteMember MCP tool.
 *
 * Authorization:
 *   1. FGA — verifies `user:<sub> writer members:default`
 *   2. Core — creates the member invitation in the store
 */
export async function executeInviteMember(params: InviteMemberInput, ctx: MCPToolContext) {
  const fgaClient = buildOpenFgaClient()
  const { allowed } = await fgaClient.check({
    user: `user:${ctx.sub}`,
    relation: 'writer',
    object: 'members:default',
  })
  if (!allowed) {
    throw new Error('Forbidden: you do not have permission to invite members.')
  }

  const member = addMember(params.name, params.email, params.role)
  return { success: true, member }
}
