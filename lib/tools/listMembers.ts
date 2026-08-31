import { z } from 'zod'
import { listMembers, type MemberStatus } from '@/lib/members'

export const listMembersSchema = z.object({
  status: z
    .enum(['active', 'inactive', 'invited'])
    .optional()
    .describe('Filter members by status. Omit to return all members.'),
})

export type ListMembersInput = z.infer<typeof listMembersSchema>

export async function executeListMembers(params: ListMembersInput) {
  const members = listMembers(params.status as MemberStatus | undefined)
  return { members, count: members.length }
}
